// /me/edit と /me/account の「保存バーでの一括保存」本体（プロフィール列・MCID・リンク・動画を1リクエスト・1トランザクションで保存する）。
// 仕様は docs/profiles.md「/me/edit の保存方式」。送られた項目だけを更新する（どのページがどの項目を送るかは profile-edit-scope.ts）。
//
// 流れ: ①検証（DB に触れない形式検証 → 既存データを読んだ最終状態の検証 → Mojang 照合）→
//       ②DB 書き込みを単一トランザクションで実施 → ③commit 後に外部キャッシュのキック（失敗しても保存は成功扱い）。
// ①で失敗したら DB は1行も変えない。外部 I/O（Mojang）は必ずトランザクションの外（①）で済ませる。
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { Translator } from "@/lib/messages";
import { isUniqueConstraintError, type Database } from "@/lib/db";
import { errorSummary } from "@/lib/error-summary";
import { caseById } from "@/lib/sql-case";
import { users, socialLinks, profileVideos } from "@/lib/schema";
import { applyMcidSlugChange, verifyMcidForUser } from "@/lib/mcid-change.server";
import type { CapeDisplay } from "@/lib/cape";
import { PROFILE_TAB_VALUES, type ProfileTabValue } from "@/lib/profile-tabs";
import { parseAgeGroup, type AgeGroup } from "@/lib/age-group";
import { isValidRtaStartedYearMonth } from "@/lib/rta-career";
import {
  runAfterResponse,
  refreshTwitchVodsForLogin,
  deleteTwitchVodsForLogin,
  refreshYoutubeForChannel,
  deleteYoutubeVideosForChannelIdentifier,
  updateYoutubeCacheMcid,
  refreshSrcRankingsForUser,
  type LinkOwner,
} from "@/lib/targeted-refresh.server";
import { removeUserBioTranslations, scheduleUserBioTranslation } from "@/lib/content-translation.server";
import {
  MAX_PROFILE_VIDEOS,
  MAX_SOCIAL_LINKS,
  NEW_VIDEO_ORDER_PREFIX,
  PROFILE_FIELD_LIMITS,
  linksTouchSpeedrun,
  validateBedrockMcidFormat,
  validateLinkInput,
  validateMcidFormat,
  validateProfileTextFields,
  validateVideoInput,
  type ProfileChanges,
  type ProfileFieldErrors,
} from "@/lib/profile-edit-validation";

type UserRow = typeof users.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// enum系フィールドのallowlist。手書き配列ではなく schema.ts の enum 定義（列の enumValues）から導出する
const VISIBILITIES = users.profileVisibility.enumValues;
const POSES = users.profilePose.enumValues;
const CAPE_DISPLAYS: readonly string[] = users.capeDisplay.enumValues;
const PLATFORMS = users.mainPlatform.enumValues;
const ROLES = users.role.enumValues;

// ============================================
// 外部キャッシュのキック（リンクの追加/変更/削除）
// ============================================

/**
 * ソーシャルリンクの追加/変更に応じて、外部キャッシュ（Twitch VOD / YouTube 動画 /
 * Speedrun.com・MCSR Rankedランキング）の即時リフレッシュ・削除を `runAfterResponse()` 経由でキックする。
 * action のレスポンスは待たせない・失敗させない（各関数は内部でエラーを握る）。
 * 変更が無ければ何もしない。作成時は oldPlatform/oldIdentifier を null で呼ぶ
 */
export function scheduleSocialLinkKicks({
  userId,
  mcid,
  ownerMcids,
  oldPlatform,
  oldIdentifier,
  newPlatform,
  newIdentifier,
}: {
  userId: string;
  mcid: string | null;
  /** リンクを外した本人の MCID（旧・新）。YouTube の削除で「自分の帰属行だけ」を消すのに使う */
  ownerMcids: LinkOwner["mcids"];
  oldPlatform: string | null;
  oldIdentifier: string | null;
  newPlatform: string;
  newIdentifier: string;
}) {
  const owner: LinkOwner = { userId, mcids: ownerMcids };
  const changed = oldPlatform !== newPlatform || oldIdentifier !== newIdentifier;
  if (!changed) return;

  // Twitch: 旧がtwitchで(削除またはtwitch以外へ変更/identifier変更)なら旧を削除。新がtwitchなら即時取得。
  // 旧新が同一チャンネルを指す変更（大文字小文字のみ等）で refresh 完了後に delete が走ると
  // 次のcronまでキャッシュが空になるため、両方行う場合は必ず削除→取得の順に直列化する
  const deleteOldTwitch =
    oldPlatform === "twitch" && oldIdentifier && (newPlatform !== "twitch" || newIdentifier !== oldIdentifier)
      ? () => deleteTwitchVodsForLogin(oldIdentifier, owner)
      : null;
  const refreshNewTwitch =
    newPlatform === "twitch" ? () => refreshTwitchVodsForLogin(newIdentifier) : null;
  if (deleteOldTwitch && refreshNewTwitch) {
    runAfterResponse(deleteOldTwitch().then(refreshNewTwitch));
  } else if (deleteOldTwitch) {
    runAfterResponse(deleteOldTwitch());
  } else if (refreshNewTwitch) {
    runAfterResponse(refreshNewTwitch());
  }

  // YouTube: 同上（@ハンドル↔UC-IDの変更も同一チャンネルでありうるため直列化。mcid未設定ユーザーは新規取得をスキップ）
  const deleteOldYoutube =
    oldPlatform === "youtube" && oldIdentifier && (newPlatform !== "youtube" || newIdentifier !== oldIdentifier)
      ? () => deleteYoutubeVideosForChannelIdentifier(oldIdentifier, owner)
      : null;
  const refreshNewYoutube =
    newPlatform === "youtube" && mcid ? () => refreshYoutubeForChannel(newIdentifier, mcid) : null;
  if (deleteOldYoutube && refreshNewYoutube) {
    runAfterResponse(deleteOldYoutube().then(refreshNewYoutube));
  } else if (deleteOldYoutube) {
    runAfterResponse(deleteOldYoutube());
  } else if (refreshNewYoutube) {
    runAfterResponse(refreshNewYoutube());
  }

  // Speedrun.com: リンクの追加/変更/削除いずれも speedruncomUsername の変更を伴うためランキングを更新
  if (newPlatform === "speedruncom" || oldPlatform === "speedruncom") {
    runAfterResponse(refreshSrcRankingsForUser(userId));
  }
}

/**
 * リンク削除時に、削除したプラットフォームの外部キャッシュを削除する。
 * 共有キャッシュのうち他の走者の登録分は消さない（`ownerMcids` は本人の MCID。判定は targeted-refresh.server.ts）
 */
export function scheduleSocialLinkDeleteKicks(
  userId: string,
  link: { platform: string; identifier: string },
  ownerMcids: LinkOwner["mcids"],
) {
  const owner: LinkOwner = { userId, mcids: ownerMcids };
  if (link.platform === "twitch") {
    runAfterResponse(deleteTwitchVodsForLogin(link.identifier, owner));
  } else if (link.platform === "youtube") {
    runAfterResponse(deleteYoutubeVideosForChannelIdentifier(link.identifier, owner));
  } else if (link.platform === "speedruncom") {
    runAfterResponse(refreshSrcRankingsForUser(userId));
  }
}

// ============================================
// プロフィール列のパース・検証
// ============================================

/**
 * フォームから読んだプロフィール列。**`undefined` は「送られていない（列を更新しない）」**。
 * /me/edit と /me/account が別の列だけを送るため（列の振り分けは app/lib/profile-edit-scope.ts）、
 * 送られていない列を null や false で上書きしてはいけない。null は「空にする」（送られた空欄）
 */
type ProfileFields = {
  displayName?: string | null;
  displayNameAlphabet?: string | null;
  bio?: string | null;
  location?: string | null;
  pronouns?: string | null;
  ageGroup?: AgeGroup | null;
  ageGroupPublic?: boolean;
  profileVisibility?: "public" | "unlisted" | "private";
  profilePose?: "standing" | "walking" | "waving";
  slimSkin?: boolean;
  capeDisplay?: CapeDisplay;
  defaultProfileTab?: ProfileTabValue;
  mainPlatform?: "pc_windows" | "pc_mac" | "pc_linux" | "switch" | "mobile" | "other" | null;
  role?: "viewer" | "runner" | null;
  shortBio?: string | null;
  rtaStartedYearMonth?: string | null;
  speedruncomUsername?: string | null;
  showPacemanOnHome?: boolean;
  showTwitchOnHome?: boolean;
  showYoutubeOnHome?: boolean;
  showRankedStats?: boolean;
  showPacemanStats?: boolean;
  allowAutoTranslation?: boolean;
};

function parseProfileFields(formData: FormData, t: Translator): { error: string } | { fields: ProfileFields } {
  const has = (name: string) => formData.has(name);
  // 文字列欄: 送られていれば trim・空→null、送られていなければ undefined
  const text = (name: string): string | null | undefined =>
    has(name) ? (String(formData.get(name) ?? "").trim() || null) : undefined;
  // 真偽の欄は "true" / "false" だけを受け付ける。ほかの値は不正値（invalid に集める。false にはしない）
  const invalidFlags: string[] = [];
  const flag = (name: string): boolean | undefined => {
    if (!has(name)) return undefined;
    const raw = formData.get(name);
    if (raw === "true") return true;
    if (raw === "false") return false;
    invalidFlags.push(name);
    return undefined;
  };

  const displayName = text("displayName");
  const displayNameAlphabet = text("displayNameAlphabet");
  const bio = text("bio");
  const location = text("location");
  const pronouns = text("pronouns");
  // 年代。空文字は未設定（null）、未知の値は保存を拒否する（null で上書きしない）
  const ageGroupRaw = has("ageGroup") ? String(formData.get("ageGroup") ?? "") : undefined;
  const ageGroup = ageGroupRaw === undefined ? undefined : ageGroupRaw === "" ? null : parseAgeGroup(ageGroupRaw);
  const ageGroupPublic = flag("ageGroupPublic");
  const shortBio = text("shortBio");
  // RTA歴（"YYYY-MM"）。未回答は空文字で送られてくるので null に落とす
  const rtaStartedYearMonth = text("rtaStartedYearMonth");
  const speedruncomUsername = text("speedruncomUsername");

  const profileVisibility = has("profileVisibility")
    ? (formData.get("profileVisibility") as "public" | "unlisted" | "private")
    : undefined;
  const profilePose = has("profilePose")
    ? (formData.get("profilePose") as "standing" | "walking" | "waving")
    : undefined;
  const slimSkin = flag("slimSkin");
  // マント表示。不正値は保存を拒否する（空文字も不正値）
  const capeDisplayRaw = has("capeDisplay") ? formData.get("capeDisplay") : undefined;
  const capeDisplay =
    typeof capeDisplayRaw === "string" && CAPE_DISPLAYS.includes(capeDisplayRaw)
      ? (capeDisplayRaw as CapeDisplay)
      : undefined;
  // 値の集合は app/lib/profile-tabs.ts の PROFILE_TAB_VALUES（単一情報源）。フォームは保存済みの値を
  // そのまま送り返すので、選択肢（SELECTABLE_PROFILE_TABS）ではなく enum 全体（廃止値 "settings" を含む）で検証する
  const defaultProfileTabRaw = has("defaultProfileTab") ? formData.get("defaultProfileTab") : undefined;
  const defaultProfileTab =
    typeof defaultProfileTabRaw === "string" && (PROFILE_TAB_VALUES as readonly string[]).includes(defaultProfileTabRaw)
      ? (defaultProfileTabRaw as ProfileTabValue)
      : undefined;
  // 空文字は「未設定にする」（null）
  const mainPlatform = has("mainPlatform")
    ? ((formData.get("mainPlatform") as ProfileFields["mainPlatform"]) || null)
    : undefined;
  const role = has("role") ? ((formData.get("role") as "viewer" | "runner") || null) : undefined;
  const showPacemanOnHome = flag("showPacemanOnHome");
  const showTwitchOnHome = flag("showTwitchOnHome");
  const showYoutubeOnHome = flag("showYoutubeOnHome");
  const showRankedStats = flag("showRankedStats");
  const showPacemanStats = flag("showPacemanStats");
  // 自己紹介の自動翻訳の許可。不正値は保存を拒否する
  const allowAutoTranslationRaw = has("allowAutoTranslation") ? formData.get("allowAutoTranslation") : undefined;
  const allowAutoTranslation =
    allowAutoTranslationRaw === "true" ? true : allowAutoTranslationRaw === "false" ? false : undefined;

  const textError = validateProfileTextFields({
    displayName: displayName ?? null,
    displayNameAlphabet: displayNameAlphabet ?? null,
    bio: bio ?? null,
    location: location ?? null,
    shortBio: shortBio ?? null,
    pronouns: pronouns ?? null,
  });
  if (textError) return { error: t(textError) };
  if (profileVisibility !== undefined && !VISIBILITIES.includes(profileVisibility)) {
    return { error: t("meEdit.invalidOption") };
  }
  if (profilePose !== undefined && !POSES.includes(profilePose)) return { error: t("meEdit.invalidOption") };
  if (capeDisplayRaw !== undefined && capeDisplay === undefined) return { error: t("meEdit.invalidOption") };
  if (defaultProfileTabRaw !== undefined && defaultProfileTab === undefined) return { error: t("meEdit.invalidOption") };
  if (ageGroupRaw !== undefined && ageGroup === undefined) return { error: t("meEdit.invalidOption") };
  if (invalidFlags.length > 0) return { error: t("meEdit.invalidOption") };
  if (allowAutoTranslationRaw !== undefined && allowAutoTranslation === undefined) {
    return { error: t("meEdit.invalidOption") };
  }
  if (mainPlatform && !PLATFORMS.includes(mainPlatform)) return { error: t("meEdit.invalidOption") };
  if (role && !ROLES.includes(role)) return { error: t("meEdit.invalidOption") };
  if (speedruncomUsername && speedruncomUsername.length > PROFILE_FIELD_LIMITS.speedruncomUsername) {
    return { error: t("meEdit.speedrunUsernameMax") };
  }
  // ソーシャルリンク欄の speedruncom identifier と同じ形式（英数字・ハイフン・アンダースコアのみ）を要求する
  if (speedruncomUsername && !/^[\w\-]+$/.test(speedruncomUsername)) {
    return { error: t("meEdit.speedrunUsernameInvalid") };
  }
  if (rtaStartedYearMonth && !isValidRtaStartedYearMonth(rtaStartedYearMonth)) {
    return { error: t("meEdit.rtaStartedInvalid") };
  }

  return {
    fields: {
      displayName,
      displayNameAlphabet,
      bio,
      location,
      pronouns,
      ageGroup,
      ageGroupPublic,
      profileVisibility,
      profilePose,
      slimSkin,
      capeDisplay,
      defaultProfileTab,
      mainPlatform,
      role,
      shortBio,
      rtaStartedYearMonth,
      speedruncomUsername,
      showPacemanOnHome,
      showTwitchOnHome,
      showYoutubeOnHome,
      showRankedStats,
      showPacemanStats,
      allowAutoTranslation,
    },
  };
}

// ============================================
// 差分（changes）のスキーマ
// ============================================

const nullableTrimmed = z.string().nullable().optional();
const linkPayload = {
  platform: z.string().max(40),
  identifier: z.string().max(500),
  customLabel: nullableTrimmed,
  customUrl: nullableTrimmed,
};
const videoPayload = {
  url: z.string().max(2000),
  title: z.string().max(500).nullable().optional(),
  isPinned: z.boolean().optional(),
};
const mcidOp = z.union([
  z.object({ op: z.literal("set"), value: z.string().max(200) }),
  z.object({ op: z.literal("remove") }),
]);

const profileChangesSchema = z.object({
  mcid: mcidOp.optional(),
  bedrockMcid: mcidOp.optional(),
  links: z
    .object({
      create: z.array(z.object({ key: z.string().max(100), ...linkPayload })).max(50).optional(),
      update: z.array(z.object({ id: z.string().max(100), ...linkPayload })).max(50).optional(),
      delete: z.array(z.string().max(100)).max(50).optional(),
    })
    .optional(),
  videos: z
    .object({
      create: z.array(z.object({ key: z.string().max(100), ...videoPayload })).max(50).optional(),
      update: z.array(z.object({ id: z.string().max(100), ...videoPayload })).max(50).optional(),
      delete: z.array(z.string().max(100)).max(50).optional(),
      order: z.array(z.string().max(120)).max(100).optional(),
    })
    .optional(),
});

function normalizeLink(input: { platform: string; identifier: string; customLabel?: string | null; customUrl?: string | null }) {
  const platform = input.platform;
  const identifier = input.identifier.trim();
  const customLabel = input.customLabel?.trim() || null;
  const customUrl = input.customUrl?.trim() || null;
  return { platform, identifier, customLabel, customUrl };
}

function normalizeVideo(input: { url: string; title?: string | null; isPinned?: boolean }) {
  return { url: input.url.trim(), title: input.title?.trim() || null, isPinned: input.isPinned === true };
}

// ============================================
// 一括保存本体
// ============================================

export type SaveProfileResult =
  | { success: true; action: "profile"; newSlug?: string; error?: undefined; fieldErrors?: undefined }
  | { error: string; fieldErrors?: ProfileFieldErrors; action?: undefined; success?: undefined };

/**
 * 今回の保存で作成・更新するリンクのうち、カスタム以外のプラットフォームが最終状態で重複するものがあるか。
 * 検査するのは touchedKeys のリンクだけ（過去データの重複は無関係な保存を妨げない）。
 */
function hasTouchedPlatformDuplicate(
  finalLinks: { key: string; platform: string }[],
  touchedKeys: ReadonlySet<string>,
): boolean {
  const counts = new Map<string, number>();
  for (const l of finalLinks) {
    if (l.platform !== "custom") counts.set(l.platform, (counts.get(l.platform) ?? 0) + 1);
  }
  return finalLinks.some((l) => l.platform !== "custom" && touchedKeys.has(l.key) && (counts.get(l.platform) ?? 0) > 1);
}

/** トランザクション内の再確認でプラットフォーム重複を見つけたときに投げる（catch で platformLinkExists にする） */
class PlatformLinkConflictError extends Error {}

export async function saveProfileBatch({
  db,
  t,
  user,
  formData,
}: {
  db: Database;
  t: Translator;
  user: UserRow;
  formData: FormData;
}): Promise<SaveProfileResult> {
  // ---- ① 検証（DB に触れない） ----
  const parsed = parseProfileFields(formData, t);
  if ("error" in parsed) return { error: parsed.error };
  const fields = parsed.fields;

  let changes: ProfileChanges = {};
  const rawChanges = formData.get("changes");
  if (typeof rawChanges === "string" && rawChanges) {
    let json: unknown;
    try {
      json = JSON.parse(rawChanges);
    } catch {
      return { error: t("meEdit.invalidOption") };
    }
    const result = profileChangesSchema.safeParse(json);
    if (!result.success) return { error: t("meEdit.invalidOption") };
    changes = result.data as ProfileChanges;
  }

  const fieldErrors: ProfileFieldErrors = {};
  const addLinkError = (key: string, message: string) => {
    fieldErrors.links = { ...fieldErrors.links, [key]: message };
  };
  const addVideoError = (key: string, message: string) => {
    fieldErrors.videos = { ...fieldErrors.videos, [key]: message };
  };

  // MCID（Java）。現在値と同じ set は何もしない扱い
  let mcidSet: string | null = null;
  const mcidRemove = changes.mcid?.op === "remove" && user.mcid !== null;
  if (changes.mcid?.op === "set") {
    const value = changes.mcid.value.trim();
    const key = validateMcidFormat(value);
    if (key) fieldErrors.mcid = t(key);
    else if (value !== user.mcid) mcidSet = value;
  }

  // Bedrock 版 MCID（自己申告）
  let bedrockSet: string | null = null;
  let bedrockRemove = false;
  if (changes.bedrockMcid?.op === "set") {
    const value = changes.bedrockMcid.value.trim();
    const key = validateBedrockMcidFormat(value);
    if (key) fieldErrors.bedrockMcid = t(key);
    else bedrockSet = value;
  } else if (changes.bedrockMcid?.op === "remove") {
    bedrockRemove = true;
  }

  const linkCreates = (changes.links?.create ?? []).map((l) => ({ key: l.key, ...normalizeLink(l) }));
  const linkUpdates = (changes.links?.update ?? []).map((l) => ({ id: l.id, ...normalizeLink(l) }));
  for (const l of linkCreates) {
    const key = validateLinkInput(l);
    if (key) addLinkError(l.key, t(key));
  }
  for (const l of linkUpdates) {
    const key = validateLinkInput(l);
    if (key) addLinkError(l.id, t(key));
  }

  const videoCreates = (changes.videos?.create ?? []).map((v) => ({ key: v.key, ...normalizeVideo(v) }));
  const videoUpdates = (changes.videos?.update ?? []).map((v) => ({ id: v.id, ...normalizeVideo(v) }));
  for (const v of videoCreates) {
    const key = validateVideoInput(v);
    if (key) addVideoError(v.key, t(key));
  }
  for (const v of videoUpdates) {
    const key = validateVideoInput(v);
    if (key) addVideoError(v.id, t(key));
  }

  const failWithFieldErrors = (message?: string): SaveProfileResult => ({
    error:
      message ??
      fieldErrors.mcid ??
      fieldErrors.bedrockMcid ??
      Object.values(fieldErrors.links ?? {})[0] ??
      Object.values(fieldErrors.videos ?? {})[0] ??
      t("meEdit.invalidOption"),
    fieldErrors,
  });
  const hasFieldErrors = () =>
    Boolean(fieldErrors.mcid || fieldErrors.bedrockMcid || fieldErrors.links || fieldErrors.videos);

  if (hasFieldErrors()) return failWithFieldErrors();

  // ---- ① 検証（既存データを読んで「最終状態」を検証） ----
  const existingLinks = await db.query.socialLinks.findMany({
    where: eq(socialLinks.userId, user.id),
  });
  const existingVideos = await db.query.profileVideos.findMany({
    where: eq(profileVideos.userId, user.id),
    orderBy: [asc(profileVideos.displayOrder)],
  });
  const linkById = new Map(existingLinks.map((l) => [l.id, l]));
  const videoById = new Map(existingVideos.map((v) => [v.id, v]));

  // 所有確認（IDOR 防止）。他人・存在しない id の更新はエラー、削除は無視する
  const linkDeletes = [...new Set(changes.links?.delete ?? [])].filter((id) => linkById.has(id));
  for (const l of linkUpdates) {
    if (!linkById.has(l.id)) addLinkError(l.id, t("meEdit.linkSaveFailed"));
  }
  // 同じ id を重複して送られても件数計算・削除が二重にならないよう Set で重複除去する
  const videoDeletes = [...new Set(changes.videos?.delete ?? [])].filter((id) => videoById.has(id));
  const validVideoUpdates = videoUpdates.filter((v) => videoById.has(v.id) && !videoDeletes.includes(v.id));
  const validLinkUpdates = linkUpdates.filter((l) => linkById.has(l.id) && !linkDeletes.includes(l.id));
  if (hasFieldErrors()) return failWithFieldErrors();

  // リンクの最終状態（削除・更新を反映した集合）で、カスタム以外のプラットフォーム重複を検出する
  const finalLinks = [
    ...existingLinks
      .filter((l) => !linkDeletes.includes(l.id))
      .map((l) => {
        const upd = validLinkUpdates.find((u) => u.id === l.id);
        return { key: l.id, platform: upd?.platform ?? l.platform, identifier: upd?.identifier ?? l.identifier };
      }),
    ...linkCreates.map((l) => ({ key: l.key, platform: l.platform, identifier: l.identifier })),
  ];
  // 検査するのは今回の保存で作成・更新するリンクのプラットフォームだけ。過去データに重複が残っていても、
  // 無関係な項目（表示名など）の保存は妨げない
  const touchedKeys = new Set([...linkCreates.map((l) => l.key), ...validLinkUpdates.map((l) => l.id)]);
  const platformCounts = new Map<string, number>();
  for (const l of finalLinks) {
    if (l.platform !== "custom") platformCounts.set(l.platform, (platformCounts.get(l.platform) ?? 0) + 1);
  }
  for (const l of finalLinks) {
    if (l.platform !== "custom" && touchedKeys.has(l.key) && (platformCounts.get(l.platform) ?? 0) > 1) {
      addLinkError(l.key, t("meEdit.platformLinkExists"));
    }
  }
  // Speedrun.com リンクから決まる speedruncomUsername は列の上限（50文字）に収める（リンクの identifier 上限は100）
  for (const l of finalLinks) {
    if (l.platform === "speedruncom" && touchedKeys.has(l.key) && l.identifier.length > PROFILE_FIELD_LIMITS.speedruncomUsername) {
      addLinkError(l.key, t("meEdit.speedrunUsernameMax"));
    }
  }
  if (hasFieldErrors()) return failWithFieldErrors();

  // リンクの件数上限（既存 − 削除 + 新規）。動画と同じく、件数が増える保存だけ検査する
  if (finalLinks.length > MAX_SOCIAL_LINKS && finalLinks.length > existingLinks.length) {
    return { error: t("meEdit.linkMaxCount") };
  }

  // 動画の件数上限（既存 − 削除 + 新規）。件数が増える保存だけ検査する（過去データが上限超でも他の保存は妨げない）
  const finalVideoCount = existingVideos.length - videoDeletes.length + videoCreates.length;
  if (finalVideoCount > MAX_PROFILE_VIDEOS && finalVideoCount > existingVideos.length) {
    return { error: t("meEdit.videoMaxCount") };
  }

  // MCID 重複・Mojang 照合（トランザクションの外。失敗したら DB は何も変えない）
  let mcidUuid: string | null = null;
  if (mcidSet) {
    const verified = await verifyMcidForUser(db, user, mcidSet);
    if ("errorKey" in verified) {
      fieldErrors.mcid = t(verified.errorKey);
      return failWithFieldErrors();
    }
    mcidUuid = verified.uuid;
  }

  // ---- speedruncomUsername の決定 ----
  // 同じ保存に speedrun.com リンクの追加/変更/削除が含まれる場合は「リンクの変更を優先」し、
  // 列の値は最終状態の speedrun.com リンクの identifier から決める（現行の即時保存と同じ挙動）。
  // speedrun.com に関わるリンク変更が無いときだけフォームの値を使い、social_links へ逆方向同期する
  // フォームの speedruncomUsername が送られていない（/me/account の保存など）かつリンクの変更も無いときは、
  // 列・social_links・ランキングのいずれにも触れない（undefined = 未送信）
  const srLinkChanged = linksTouchSpeedrun(
    { create: linkCreates, update: validLinkUpdates, delete: linkDeletes },
    (id) => linkById.get(id)?.platform,
  );
  const finalSrLink = finalLinks.find((l) => l.platform === "speedruncom");
  const speedruncomUsername: string | null | undefined = srLinkChanged
    ? (finalSrLink?.identifier ?? null)
    : fields.speedruncomUsername;
  const srTouched = speedruncomUsername !== undefined;

  // ---- 動画の最終並び（id の配列）。新規は先に id を採番して order の `new:<key>` を解決する ----
  const newVideoIds = new Map(videoCreates.map((v) => [v.key, createId()]));
  const orderedIds: string[] = [];
  const pushId = (id: string | undefined) => {
    if (id && !orderedIds.includes(id) && !videoDeletes.includes(id)) orderedIds.push(id);
  };
  for (const entry of changes.videos?.order ?? []) {
    if (entry.startsWith(NEW_VIDEO_ORDER_PREFIX)) {
      pushId(newVideoIds.get(entry.slice(NEW_VIDEO_ORDER_PREFIX.length)));
    } else if (videoById.has(entry)) {
      pushId(entry);
    }
  }
  for (const v of existingVideos) pushId(v.id); // order に無い既存は元の順で後ろへ
  for (const id of newVideoIds.values()) pushId(id); // order に無い新規は末尾

  // ---- 「プロフィール内容の変化」判定（updatedAt を進めるかどうか） ----
  // 表示・公開範囲系の列（profileVisibility / show* / allowAutoTranslation）だけの変更は、露出を減らす操作でも
  // ホームの「最近の更新」等に出てしまうため updatedAt を進めない。それ以外の列・リンク・動画の変化は内容の変化。
  // 判定は送信値ではなく既存値との差分で行う
  const nn = <T,>(v: T | null | undefined) => v ?? null;
  // 送られていない列（undefined）は変化なし
  const differs = <T,>(next: T | null | undefined, current: T | null | undefined) =>
    next !== undefined && nn(next) !== nn(current);
  const userContentChanged =
    mcidSet !== null ||
    mcidRemove ||
    bedrockSet !== null ||
    bedrockRemove ||
    differs(fields.displayName, user.displayName) ||
    differs(fields.displayNameAlphabet, user.displayNameAlphabet) ||
    differs(fields.bio, user.bio) ||
    differs(fields.location, user.location) ||
    differs(fields.pronouns, user.pronouns) ||
    differs(fields.ageGroup, user.ageGroup) ||
    differs(fields.profilePose, user.profilePose) ||
    differs(fields.slimSkin, user.slimSkin) ||
    differs(fields.capeDisplay, user.capeDisplay) ||
    differs(fields.defaultProfileTab, user.defaultProfileTab) ||
    differs(fields.mainPlatform, user.mainPlatform) ||
    differs(fields.role, user.role) ||
    differs(fields.shortBio, user.shortBio) ||
    differs(fields.rtaStartedYearMonth, user.rtaStartedYearMonth) ||
    differs(speedruncomUsername, user.speedruncomUsername);
  const linksChanged =
    linkCreates.length > 0 ||
    linkDeletes.length > 0 ||
    validLinkUpdates.some((l) => {
      const old = linkById.get(l.id)!;
      return (
        old.platform !== l.platform ||
        old.identifier !== l.identifier ||
        nn(old.customLabel) !== (l.platform === "custom" ? nn(l.customLabel) : null) ||
        nn(old.customUrl) !== (l.platform === "custom" ? nn(l.customUrl) : null)
      );
    }) ||
    // speedrun.com 列 → リンクの逆方向同期で social_links が変わる場合
    (!srLinkChanged &&
      srTouched &&
      (speedruncomUsername
        ? existingLinks.find((l) => l.platform === "speedruncom")?.identifier !== speedruncomUsername
        : existingLinks.some((l) => l.platform === "speedruncom")));
  const videosChanged =
    videoCreates.length > 0 ||
    videoDeletes.length > 0 ||
    validVideoUpdates.some((v) => {
      const old = videoById.get(v.id)!;
      return old.url !== v.url || nn(old.title) !== nn(v.title) || Boolean(old.isPinned) !== v.isPinned;
    }) ||
    orderedIds.some((id, index) => {
      const existing = videoById.get(id);
      return existing !== undefined && existing.displayOrder !== index;
    });
  const contentChanged = userContentChanged || linksChanged || videosChanged;

  const nextAgeGroup = fields.ageGroup !== undefined ? fields.ageGroup : user.ageGroup;

  // ---- ② DB 書き込み（単一トランザクション） ----
  const now = new Date();
  let newSlug: string | undefined;
  try {
    await db.transaction(async (tx: Tx) => {
      const userSet: Partial<typeof users.$inferInsert> = {};

      // MCID（Java）: slug 再生成・旧slug履歴・お気に入り追従まで同じトランザクションで原子化
      if (mcidSet && mcidUuid) {
        newSlug = await applyMcidSlugChange(tx, user, mcidSet);
        userSet.mcid = mcidSet;
        userSet.uuid = mcidUuid;
        userSet.slug = newSlug;
      } else if (mcidRemove) {
        newSlug = await applyMcidSlugChange(tx, user, null);
        userSet.mcid = null;
        userSet.uuid = null;
        userSet.slug = newSlug;
      }

      if (bedrockSet) userSet.bedrockMcid = bedrockSet;
      else if (bedrockRemove) userSet.bedrockMcid = null;

      // リンクは書き込みトランザクションの中で読み直す。drizzle の db.transaction() は libsql の既定（"write" = BEGIN IMMEDIATE）で
      // 書き込みロックを開始時に取るため、並行する保存はここで直列化され、先行の commit 済みの内容がこの読み取りに見える。
      // ①の重複検査は読み取りから書き込みまでの間に他のリクエストが入りうる（social_links に (userId, platform) の一意制約が無い）ので、最終状態をここで再検査する
      const freshLinks = await tx.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) });
      if (linkCreates.length > 0 || validLinkUpdates.length > 0) {
        const freshFinal = [
          ...freshLinks
            .filter((l) => !linkDeletes.includes(l.id))
            .map((l) => ({ key: l.id, platform: validLinkUpdates.find((u) => u.id === l.id)?.platform ?? l.platform })),
          ...linkCreates.map((l) => ({ key: l.key, platform: l.platform })),
        ];
        if (hasTouchedPlatformDuplicate(freshFinal, touchedKeys)) throw new PlatformLinkConflictError();
      }

      // リンク: 削除 → 更新 → 作成（削除を先に行い、同一プラットフォームの入れ替えを通す）
      if (linkDeletes.length > 0) {
        await tx.delete(socialLinks).where(and(inArray(socialLinks.id, linkDeletes), eq(socialLinks.userId, user.id)));
      }
      // 行ごとの UPDATE（Turso では 1 件 = 1 HTTP 往復）を、CASE 式の単一 UPDATE にまとめる（同一 id は後勝ち）
      if (validLinkUpdates.length > 0) {
        const byId = new Map(validLinkUpdates.map((l) => [l.id, l]));
        const rows = [...byId.values()];
        await tx
          .update(socialLinks)
          .set({
            platform: caseById(socialLinks.id, rows.map((l) => [l.id, l.platform])),
            identifier: caseById(socialLinks.id, rows.map((l) => [l.id, l.identifier])),
            customLabel: caseById(socialLinks.id, rows.map((l) => [l.id, l.platform === "custom" ? l.customLabel : null])),
            customUrl: caseById(socialLinks.id, rows.map((l) => [l.id, l.platform === "custom" ? l.customUrl : null])),
            updatedAt: now,
          })
          .where(and(inArray(socialLinks.id, [...byId.keys()]), eq(socialLinks.userId, user.id)));
      }
      for (const l of linkCreates) {
        await tx.insert(socialLinks).values({
          id: createId(),
          userId: user.id,
          platform: l.platform as typeof socialLinks.$inferInsert.platform,
          identifier: l.identifier,
          customLabel: l.platform === "custom" ? l.customLabel : null,
          customUrl: l.platform === "custom" ? l.customUrl : null,
        });
      }

      // speedrun.com: リンクの変更があれば列をリンクから決める。無ければフォーム値を social_links へ逆方向同期
      if (srLinkChanged) {
        // 解決済みIDを残すと cron/即時更新が旧アカウントを見続けるため、値が変わったらリセットする
        if (speedruncomUsername !== user.speedruncomUsername) userSet.speedruncomId = null;
      } else if (srTouched) {
        const existingSr = freshLinks.find((l) => l.platform === "speedruncom");
        if (speedruncomUsername) {
          if (!existingSr) {
            await tx.insert(socialLinks).values({
              id: createId(),
              userId: user.id,
              platform: "speedruncom",
              identifier: speedruncomUsername,
            });
          } else if (existingSr.identifier !== speedruncomUsername) {
            await tx
              .update(socialLinks)
              .set({ identifier: speedruncomUsername, updatedAt: now })
              .where(eq(socialLinks.id, existingSr.id));
          }
        } else if (existingSr) {
          await tx.delete(socialLinks).where(eq(socialLinks.id, existingSr.id));
        }
        if (speedruncomUsername !== user.speedruncomUsername) userSet.speedruncomId = null;
      }

      // 動画: 削除 → 更新 → 作成 → 並び（displayOrder をインデックスで振り直す）
      if (videoDeletes.length > 0) {
        await tx
          .delete(profileVideos)
          .where(and(inArray(profileVideos.id, videoDeletes), eq(profileVideos.userId, user.id)));
      }
      if (validVideoUpdates.length > 0) {
        const byId = new Map(validVideoUpdates.map((v) => [v.id, v]));
        const rows = [...byId.values()];
        await tx
          .update(profileVideos)
          .set({
            url: caseById(profileVideos.id, rows.map((v) => [v.id, v.url])),
            title: caseById(profileVideos.id, rows.map((v) => [v.id, v.title])),
            isPinned: caseById(profileVideos.id, rows.map((v) => [v.id, v.isPinned ? 1 : 0])),
            updatedAt: now,
          })
          .where(and(inArray(profileVideos.id, [...byId.keys()]), eq(profileVideos.userId, user.id)));
      }
      for (const v of videoCreates) {
        await tx.insert(profileVideos).values({
          id: newVideoIds.get(v.key)!,
          userId: user.id,
          url: v.url,
          title: v.title,
          isPinned: v.isPinned,
          displayOrder: orderedIds.indexOf(newVideoIds.get(v.key)!),
        });
      }
      const reordered: [string, number][] = [];
      for (const [index, id] of orderedIds.entries()) {
        const existing = videoById.get(id);
        if (existing && existing.displayOrder !== index) reordered.push([id, index]);
      }
      if (reordered.length > 0) {
        await tx
          .update(profileVideos)
          .set({ displayOrder: caseById(profileVideos.id, reordered), updatedAt: now })
          .where(and(inArray(profileVideos.id, reordered.map(([id]) => id)), eq(profileVideos.userId, user.id)));
      }

      // プロフィール列。送られていない列（undefined）は更新対象に含めない
      const columns: Partial<typeof users.$inferInsert> = {
        displayName: fields.displayName,
        displayNameAlphabet: fields.displayNameAlphabet,
        bio: fields.bio,
        location: fields.location,
        pronouns: fields.pronouns,
        ageGroup: fields.ageGroup,
        // 年代が未設定のときは公開フラグも false に戻す（未設定の年代を公開する状態を残さない）
        ageGroupPublic: nextAgeGroup === null ? false : fields.ageGroupPublic,
        profileVisibility: fields.profileVisibility,
        profilePose: fields.profilePose,
        slimSkin: fields.slimSkin,
        capeDisplay: fields.capeDisplay,
        defaultProfileTab: fields.defaultProfileTab,
        mainPlatform: fields.mainPlatform,
        role: fields.role,
        shortBio: fields.shortBio,
        rtaStartedYearMonth: fields.rtaStartedYearMonth,
        speedruncomUsername,
        showPacemanOnHome: fields.showPacemanOnHome,
        showTwitchOnHome: fields.showTwitchOnHome,
        showYoutubeOnHome: fields.showYoutubeOnHome,
        showRankedStats: fields.showRankedStats,
        showPacemanStats: fields.showPacemanStats,
        allowAutoTranslation: fields.allowAutoTranslation,
      };
      const set: Partial<typeof users.$inferInsert> = {
        ...Object.fromEntries(Object.entries(columns).filter(([, v]) => v !== undefined)),
        ...userSet,
        ...(contentChanged ? { updatedAt: now } : {}),
      };
      if (Object.keys(set).length > 0) {
        await tx.update(users).set(set).where(eq(users.id, user.id));
      }
    });
  } catch (e) {
    if (e instanceof PlatformLinkConflictError) return { error: t("meEdit.platformLinkExists") };
    console.error("Profile save error:", errorSummary(e));
    if (isUniqueConstraintError(e)) {
      // MCID の変更を含む保存での UNIQUE 違反は、競合（直前に他ユーザーが取得）として MCID のエラーにする
      if (mcidSet) {
        fieldErrors.mcid = t("meEdit.mcidTaken");
        return failWithFieldErrors();
      }
      return { error: t("meEdit.platformLinkExists") };
    }
    return { error: t("meEdit.profileSaveFailed") };
  }

  // ---- ③ commit 後の副作用（失敗しても保存は成功扱い） ----
  const effectiveMcid = mcidSet ?? (mcidRemove ? null : user.mcid);
  // キャッシュ行は MCID に帰属する。同じ保存で MCID を変える／外すときは updateYoutubeCacheMcid と並行になるので、旧・新の両方を渡す
  const ownerMcids = [user.mcid, effectiveMcid];

  // 自己紹介の自動翻訳（docs/translation.md）。オフにした／非公開にしたら既存の訳文を確実に消す（機能無効でも消す）。
  // それ以外は毎回 schedule してよい（基盤側が原文ハッシュで upToDate を判定して API を呼ばない）
  const effectiveVisibility = fields.profileVisibility ?? user.profileVisibility;
  if ((fields.allowAutoTranslation ?? user.allowAutoTranslation) === false || effectiveVisibility === "private") {
    await removeUserBioTranslations(db, user.id);
  } else {
    scheduleUserBioTranslation(db, user.id);
  }

  // MCID変更に伴う外部キャッシュの紐付け追従（YouTube動画キャッシュのMCID列を新値へ）。
  // YouTube連携があれば新MCIDで即時取得もキックする（連携有無の検索もレスポンスを遅らせないようbackground側で行う）
  if (mcidSet) {
    const oldMcid = user.mcid;
    const newMcid = mcidSet;
    // 同じ保存で YouTube リンクを作成/変更した場合は、そのキック（新MCIDで取得）が取得を担うため、ここでは重複させない
    const youtubeKicked =
      linkCreates.some((l) => l.platform === "youtube") ||
      validLinkUpdates.some((l) => {
        const old = linkById.get(l.id)!;
        return l.platform === "youtube" && (old.platform !== "youtube" || old.identifier !== l.identifier);
      });
    runAfterResponse(
      (async () => {
        if (oldMcid) {
          await updateYoutubeCacheMcid(oldMcid, newMcid);
        }
        const youtubeLink = await db.query.socialLinks.findFirst({
          where: and(eq(socialLinks.userId, user.id), eq(socialLinks.platform, "youtube")),
        });
        if (youtubeLink && !youtubeKicked) {
          await refreshYoutubeForChannel(youtubeLink.identifier, newMcid);
        }
      })(),
    );
  }

  for (const l of linkCreates) {
    scheduleSocialLinkKicks({
      userId: user.id,
      mcid: effectiveMcid,
      ownerMcids,
      oldPlatform: null,
      oldIdentifier: null,
      newPlatform: l.platform,
      newIdentifier: l.identifier,
    });
  }
  for (const l of validLinkUpdates) {
    const old = linkById.get(l.id)!;
    scheduleSocialLinkKicks({
      userId: user.id,
      mcid: effectiveMcid,
      ownerMcids,
      oldPlatform: old.platform,
      oldIdentifier: old.identifier,
      newPlatform: l.platform,
      newIdentifier: l.identifier,
    });
  }
  for (const id of linkDeletes) {
    const deleted = linkById.get(id)!;
    // 同じ保存で同じ platform + identifier を作り直した（最終状態に残る）場合、削除キックは省く。
    // 削除と refresh が並行すると、キャッシュが次の cron まで空になる（Twitch/YouTube は大文字小文字を区別しない）
    const recreated = finalLinks.some(
      (f) => f.platform === deleted.platform && f.identifier.toLowerCase() === deleted.identifier.toLowerCase(),
    );
    if (!recreated) scheduleSocialLinkDeleteKicks(user.id, deleted, ownerMcids);
  }

  // speedrun.com リンク経由でない speedruncomUsername の変更（基本情報フォーム側）もランキングを即時更新する
  if (!srLinkChanged && srTouched && speedruncomUsername !== user.speedruncomUsername) {
    runAfterResponse(refreshSrcRankingsForUser(user.id));
  }

  // 非公開→公開への切り替え時は、非公開中はcron対象外で取りこぼしていたTwitch/YouTubeキャッシュを追いつかせる
  // （連携有無の検索もレスポンスを遅らせないようbackground側で行う）
  if (user.profileVisibility !== "public" && effectiveVisibility === "public") {
    const mcidAtSave = effectiveMcid;
    runAfterResponse(
      (async () => {
        const externalLinksOnPublish = await db.query.socialLinks.findMany({
          where: and(eq(socialLinks.userId, user.id), inArray(socialLinks.platform, ["twitch", "youtube"])),
        });
        for (const link of externalLinksOnPublish) {
          if (link.platform === "twitch") {
            await refreshTwitchVodsForLogin(link.identifier);
          } else if (link.platform === "youtube" && mcidAtSave) {
            await refreshYoutubeForChannel(link.identifier, mcidAtSave);
          }
        }
        // SRC/MCSR Rankedランキングも非公開中はcron対象外のため追いつかせる
        await refreshSrcRankingsForUser(user.id);
      })(),
    );
  }

  return { success: true, action: "profile", ...(newSlug ? { newSlug } : {}) };
}
