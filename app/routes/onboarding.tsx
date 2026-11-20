import { useEffect, useRef, useState } from "react";
import {
  Link,
  redirect,
  useFetcher,
  useLoaderData,
  useRevalidator,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import type { Route } from "./+types/onboarding";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createTranslator, type Translator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession, isRegistered } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, socialLinks } from "@/lib/schema";
import { createDefaultsForNewUser } from "@/lib/defaults";
import { generateSlug, getLocalizedDisplayName } from "@/lib/slug";
import { sanitizeReturnTo } from "@/lib/return-to";
import { claimSlug } from "@/lib/slug-history.server";
import { applyMcidSlugChange, verifyMcidForUser } from "@/lib/mcid-change.server";
import { removeUserBioTranslations, scheduleUserBioTranslation } from "@/lib/content-translation.server";
import {
  PRINTABLE_ASCII_RE,
  PROFILE_FIELD_LIMITS,
  validateBedrockMcidFormat,
  validateLinkInput,
  validateMcidFormat,
  validateProfileTextFields,
} from "@/lib/profile-edit-validation";
import {
  runAfterResponse,
  refreshTwitchVodsForLogin,
  refreshYoutubeForChannel,
  refreshSrcRankingsForUser,
} from "@/lib/targeted-refresh.server";
import { cn } from "@/lib/utils";
import { resolveCapeProps } from "@/lib/cape";
import { estimateOnboardingResumeStep, ONBOARDING_TOTAL_STEPS } from "@/lib/onboarding-progress";
import { useLocale, useT } from "@/hooks/use-locale";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { MinecraftFullBody } from "@/components/minecraft-fullbody";
import { SkinUploader } from "@/components/skin-uploader";
import {
  OnboardingStepError,
  OnboardingStepFooter,
  OnboardingStepHeader,
  useFocusOnMount,
} from "@/components/onboarding/onboarding-step";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Info,
  Loader2,
  UserRound,
} from "lucide-react";
import { Youtube, Twitch, Twitter } from "@/components/brand-icons";

// enum系フィールドのallowlist。手書き配列ではなく schema.ts の enum 定義（列の enumValues）から導出する
const VISIBILITIES = users.profileVisibility.enumValues;
type ProfileVisibility = (typeof VISIBILITIES)[number];

/** ウィザードのステップ数（ようこそ画面・完了画面は数えない） */
const TOTAL_STEPS = ONBOARDING_TOTAL_STEPS;

// 連携ステップで扱うプラットフォーム（custom は扱わない）。
// label / prefix は /me/edit のリンク欄（platformOptions）に倣う。プレースホルダは翻訳キー（onboarding.linkPlaceholder）に example を差し込む
const LINK_PLATFORMS = [
  { value: "youtube", label: "YouTube", prefix: "youtube.com/@", example: "yourchannel", icon: Youtube },
  { value: "twitch", label: "Twitch", prefix: "twitch.tv/", example: "your_name", icon: Twitch },
  { value: "twitter", label: "Twitter/X", prefix: "x.com/", example: "your_handle", icon: Twitter },
  {
    value: "speedruncom",
    label: "Speedrun.com",
    prefix: "speedrun.com/users/",
    example: "YourName",
    icon: ExternalLink,
  },
] as const;
type LinkPlatform = (typeof LINK_PLATFORMS)[number]["value"];
const LINK_PLATFORM_VALUES = LINK_PLATFORMS.map((p) => p.value);

/** プラットフォームごとの ID（未設定は空文字）の初期値 */
function emptyLinks(): Record<LinkPlatform, string> {
  return { youtube: "", twitch: "", twitter: "", speedruncom: "" };
}

// 代名詞のプリセット選択肢（edit.tsx の pronounOptions と同じ。値=表示、ロケール非依存）
const pronounOptions = [
  { value: "he/him", label: "he/him" },
  { value: "she/her", label: "she/her" },
  { value: "they/them", label: "they/them" },
  { value: "he/they", label: "he/they" },
  { value: "she/they", label: "she/they" },
  { value: "any/all", label: "any/all" },
];

// 公開範囲の選択肢（ラベルは edit.tsx の既存キーを流用）
const VISIBILITY_OPTIONS = [
  { value: "public", labelKey: "meEdit.profilePublic" },
  { value: "unlisted", labelKey: "meEdit.profileUnlisted" },
  { value: "private", labelKey: "meEdit.profilePrivate" },
] as const satisfies readonly { value: ProfileVisibility; labelKey: string }[];

// その他の公開範囲トグル（ラベルは edit.tsx の既存キーを流用）
const DISPLAY_TOGGLES = [
  { name: "showRankedStats", labelKey: "meEdit.showRankedStats" },
  { name: "showPacemanStats", labelKey: "meEdit.showPacemanStats" },
  { name: "showPacemanOnHome", labelKey: "meEdit.showPacemanOnHome" },
  { name: "showTwitchOnHome", labelKey: "meEdit.showTwitchOnHome" },
  { name: "showYoutubeOnHome", labelKey: "meEdit.showYoutubeOnHome" },
] as const;

/**
 * Discord 表示名を「アルファベット表記の表示名」の既定値に使えるなら返す。
 * edit.tsx の基本情報フォームと同じ規則（印字可能 ASCII のみ・50 文字以内）を満たすときだけ採用し、
 * そうでなければ null（日本語名などは英語ロケールで displayName にフォールバックさせる）。
 * ウィザード開始時（start）と、ステップ1で未入力のとき（save_profile）の両方で使う。
 */
function discordNameAsAlphabet(name: string | null | undefined): string | null {
  const value = name?.trim();
  if (!value || value.length > PROFILE_FIELD_LIMITS.displayNameAlphabet || !PRINTABLE_ASCII_RE.test(value)) {
    return null;
  }
  return value;
}

/**
 * ソーシャルリンク ID の形式検証。/me/edit（app/lib/profile-edit.server.ts）が使う validateLinkInput と同じ規則
 * （100 文字以内、YouTube は禁止文字方式、それ以外は英数字・ハイフン・アンダースコアのみ）。
 * 問題なければ null を返す。
 */
function validateLinkIdentifier(t: Translator, platform: LinkPlatform, identifier: string): string | null {
  const key = validateLinkInput({ platform, identifier, customLabel: null, customUrl: null });
  return key ? t(key) : null;
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("onboarding.title");
  const description = t("onboarding.description");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

// 完了（save_visibility）直後に loader を再実行すると「完了済み → リダイレクト」になり、
// 完了画面を表示する前にページを離れてしまうため、その再検証だけ抑止する
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (
    actionResult &&
    typeof actionResult === "object" &&
    "action" in actionResult &&
    actionResult.action === "complete"
  ) {
    return false;
  }
  return defaultShouldRevalidate;
}

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // Must be logged in
  const session = await getSession(request, auth);

  const returnTo = sanitizeReturnTo(new URL(request.url).searchParams.get("returnTo"));

  const existingUser = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      socialLinks: {
        orderBy: [asc(socialLinks.displayOrder)],
      },
    },
  });

  if (isRegistered(existingUser)) {
    // 登録済み — ログイン前にいたページ（returnTo）があればそこへ、なければプロフィールへ
    return redirect(returnTo || `/player/${existingUser.slug}`);
  }

  // 連携ステップの初期値（プラットフォームごとに先頭の1件）
  const links = emptyLinks();
  for (const link of existingUser?.socialLinks ?? []) {
    const platform = LINK_PLATFORM_VALUES.find((p) => p === link.platform);
    if (platform && !links[platform]) {
      links[platform] = link.identifier;
    }
  }

  return {
    discordUser: {
      name: session.user.name,
      image: session.user.image,
    },
    // 行が無ければ null（ようこそ画面から）。行があり未完了ならステップ1から再開し、保存済みの値を初期値に使う
    user: existingUser
      ? {
          id: existingUser.id,
          slug: existingUser.slug,
          mcid: existingUser.mcid,
          uuid: existingUser.uuid,
          bedrockMcid: existingUser.bedrockMcid,
          displayName: existingUser.displayName,
          displayNameAlphabet: existingUser.displayNameAlphabet,
          shortBio: existingUser.shortBio,
          bio: existingUser.bio,
          location: existingUser.location,
          pronouns: existingUser.pronouns,
          customSkinUrl: existingUser.customSkinUrl,
          slimSkin: existingUser.slimSkin,
          customCapeUrl: existingUser.customCapeUrl,
          capeDisplay: existingUser.capeDisplay,
          showRankedStats: existingUser.showRankedStats,
          showPacemanStats: existingUser.showPacemanStats,
          showPacemanOnHome: existingUser.showPacemanOnHome,
          showTwitchOnHome: existingUser.showTwitchOnHome,
          showYoutubeOnHome: existingUser.showYoutubeOnHome,
        }
      : null,
    links,
    // 途中離脱からの再開位置（保存済みの内容からの推定。行が無ければ使わない）
    resumeStep: existingUser
      ? estimateOnboardingResumeStep(
          {
            ...existingUser,
            linkPlatforms: existingUser.socialLinks.map((link) => link.platform),
          },
          session.user.name,
        )
      : 1,
    appUrl: env.APP_URL || "https://minefolio.app",
    returnTo,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  // ステップ0「はじめる」: users 行を作成する（ウィザード完了までは非公開・未完了）
  if (actionType === "start") {
    // 既に行がある（途中離脱からの再開など）なら何もせず成功扱い
    if (user) {
      return { success: true, action: "start" };
    }

    const userId = createId();
    const slug = generateSlug(null, session.user.id);

    try {
      await db.insert(users).values({
        id: userId,
        discordId: session.user.id,
        mcid: null,
        uuid: null,
        slug,
        displayName: session.user.name || null,
        displayNameAlphabet: discordNameAsAlphabet(session.user.name),
        discordAvatar: session.user.image,
        hasImported: false,
        // ウィザード完了までは検索・一覧に出さない。公開範囲は最終ステップで必ず本人が選ぶ
        profileVisibility: "private",
        // DB 既定は true（列追加前の既存ユーザーを完了済みとして扱うため）。ここだけ明示的に false を入れる
        onboardingCompleted: false,
      });
    } catch {
      // discordId / slug などの UNIQUE 制約違反（二重登録・競合）
      return { error: t("onboarding.errorAlreadyRegistered") };
    }

    // このslugが過去に別ユーザーの旧slugとして記録されていれば掃除する（挿入成功時のみ）
    await claimSlug(db, slug);

    await createDefaultsForNewUser(db, userId);

    return { success: true, action: "start" };
  }

  // 以降のステップは start で行が作られている前提
  if (!user) {
    return { error: t("onboarding.errorInvalidRequest") };
  }

  // ステップ1: プロフィール
  if (actionType === "save_profile") {
    const displayName = (formData.get("displayName") as string)?.trim() || null;
    const displayNameAlphabet = (formData.get("displayNameAlphabet") as string)?.trim() || null;
    const shortBio = (formData.get("shortBio") as string)?.trim() || null;
    const bio = (formData.get("bio") as string)?.trim() || null;
    const location = (formData.get("location") as string)?.trim() || null;
    const pronouns = (formData.get("pronouns") as string)?.trim() || null;

    // /me/edit の基本情報と同じ検証（profile-edit-validation.ts が単一情報源）
    const textError = validateProfileTextFields({
      displayName,
      displayNameAlphabet,
      bio,
      location,
      shortBio,
      pronouns,
    });
    if (textError) {
      return { error: t(textError) };
    }

    await db
      .update(users)
      .set({
        // 未入力なら Discord 表示名を保存する（アルファベット表記は印字可能 ASCII のときだけ）
        displayName: displayName ?? (session.user.name || null),
        displayNameAlphabet: displayNameAlphabet ?? discordNameAsAlphabet(session.user.name),
        shortBio,
        bio,
        location,
        pronouns,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // bio / shortBio の自動翻訳をレスポンス後に走らせる（機能無効なら何もしない。失敗しても保存には影響しない）
    scheduleUserBioTranslation(db, user.id);

    return { success: true, action: "profile" };
  }

  // ステップ2: Minecraft（Java版 MCID / Bedrock版 MCID）
  if (actionType === "save_minecraft") {
    const mcid = (formData.get("mcid") as string)?.trim() || "";
    const bedrockMcidInput = (formData.get("bedrockMcid") as string)?.trim() || "";

    // Bedrock版MCID: /me/edit の一括保存（save_all → app/lib/profile-edit.server.ts）と同じ規則。空欄なら null（解除）。
    // 自己申告の表示用テキストのためMojang検証はせず、uuid・スキン・slug には関与させない
    if (bedrockMcidInput) {
      const bedrockError = validateBedrockMcidFormat(bedrockMcidInput);
      if (bedrockError) {
        return { error: t(bedrockError), field: "bedrockMcid" as const };
      }
    }
    const bedrockMcid = bedrockMcidInput || null;

    // Java版MCIDが変わるか（入力があり現在値と異なる＝設定/変更、空欄で現在値がある＝解除）
    const mcidChanged = mcid ? mcid !== user.mcid : !!user.mcid;

    if (mcidChanged) {
      // 設定/変更・解除とも /me/edit と同じ処理（mcid-change.server.ts）
      // 設定時は形式・重複・Mojang 照合（uuid はフォームの値を信用せず導出）。解除時は両方 null
      let next: { mcid: string | null; uuid: string | null };
      if (mcid) {
        const formatError = validateMcidFormat(mcid);
        if (formatError) {
          return { error: t(formatError), field: "mcid" as const };
        }
        const verified = await verifyMcidForUser(db, user, mcid);
        if ("errorKey" in verified) {
          return { error: t(verified.errorKey), field: "mcid" as const };
        }
        next = { mcid, uuid: verified.uuid };
      } else {
        next = { mcid: null, uuid: null };
      }

      await db.transaction(async (tx) => {
        const newSlug = await applyMcidSlugChange(tx, user, next.mcid);
        await tx
          .update(users)
          .set({
            mcid: next.mcid,
            uuid: next.uuid,
            slug: newSlug,
            bedrockMcid,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
      });
      // /me/edit の一括保存（save_all → mcid-change.server.ts の verifyMcidForUser / applyMcidSlugChange）が行う YouTube 動画キャッシュの追従（updateYoutubeCacheMcid / 即時取得）は
      // ここでは行わない。ウィザード中は常に非公開（cron 対象外）でキャッシュが存在せず、
      // 公開へ切り替えた時点で save_visibility が最新の MCID で追いつかせるため
    } else if (bedrockMcid !== user.bedrockMcid) {
      // Java版MCIDは変わらず、Bedrock版MCIDだけ変わった
      await db
        .update(users)
        .set({ bedrockMcid, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    return { success: true, action: "minecraft" };
  }

  // ステップ4: 連携（social_links へのプラットフォーム単位の upsert）
  if (actionType === "save_links") {
    const values = emptyLinks();
    for (const platform of LINK_PLATFORMS) {
      const identifier = (formData.get(platform.value) as string)?.trim() || "";
      if (!identifier) continue;
      const message = validateLinkIdentifier(t, platform.value, identifier);
      if (message) {
        return { error: t("onboarding.linkFieldError", { platform: platform.label, message }) };
      }
      values[platform.value] = identifier;
    }

    const existingLinks = await db.query.socialLinks.findMany({
      where: and(eq(socialLinks.userId, user.id), inArray(socialLinks.platform, LINK_PLATFORM_VALUES)),
    });

    // Speedrun.com は users.speedruncomUsername へも同期する（edit.tsx の基本情報フォームの双方向同期と同じ）。
    // ユーザー名が変わったら解決済みIDもリセットする（残すと cron/即時更新が旧アカウントを見続ける）
    const speedruncomUsername = values.speedruncom || null;
    const speedruncomChanged = speedruncomUsername !== user.speedruncomUsername;

    try {
      await db.transaction(async (tx) => {
        for (const platform of LINK_PLATFORM_VALUES) {
          const identifier = values[platform];
          const current = existingLinks.find((link) => link.platform === platform);
          if (identifier) {
            if (!current) {
              await tx.insert(socialLinks).values({
                id: createId(),
                userId: user.id,
                platform,
                identifier,
              });
            } else if (current.identifier !== identifier) {
              await tx
                .update(socialLinks)
                .set({ identifier, updatedAt: new Date() })
                .where(and(eq(socialLinks.id, current.id), eq(socialLinks.userId, user.id)));
            }
          } else if (current) {
            await tx
              .delete(socialLinks)
              .where(and(eq(socialLinks.userId, user.id), eq(socialLinks.platform, platform)));
          }
        }

        if (speedruncomChanged) {
          await tx
            .update(users)
            .set({ speedruncomUsername, speedruncomId: null, updatedAt: new Date() })
            .where(eq(users.id, user.id));
        }
      });
    } catch (e) {
      console.error("Onboarding social link error:", e);
      return { error: t("meEdit.linkSaveFailed") };
    }

    // SRC ランキング・Twitch VOD・YouTube 動画キャッシュの取得はここでは行わない（非公開中は cron 対象外。
    // 公開範囲を選ぶ save_visibility で追いつかせる。ここでも SRC を取得すると標準経路で2回走る）

    return { success: true, action: "links" };
  }

  // ステップ5: 公開設定（ウィザード完了）
  if (actionType === "save_visibility") {
    const profileVisibility = formData.get("profileVisibility") as ProfileVisibility;

    if (!VISIBILITIES.includes(profileVisibility)) {
      return { error: t("meEdit.invalidOption") };
    }

    const showRankedStats = formData.get("showRankedStats") === "true";
    const showPacemanStats = formData.get("showPacemanStats") === "true";
    const showPacemanOnHome = formData.get("showPacemanOnHome") === "true";
    const showTwitchOnHome = formData.get("showTwitchOnHome") === "true";
    const showYoutubeOnHome = formData.get("showYoutubeOnHome") === "true";

    await db
      .update(users)
      .set({
        profileVisibility,
        showRankedStats,
        showPacemanStats,
        showPacemanOnHome,
        showTwitchOnHome,
        showYoutubeOnHome,
        onboardingCompleted: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // bio の自動翻訳（docs/translation.md）。非公開プロフィールの bio は翻訳しないので、プロフィール保存時
    // （step 1）には訳されていない。非公開→公開／限定公開になったここで翻訳を走らせる。
    // 逆に非公開へ変えたときは既存の訳文を消す（機能無効でも消す）
    if (profileVisibility === "private") {
      if (user.profileVisibility !== "private") await removeUserBioTranslations(db, user.id);
    } else if (user.profileVisibility === "private") {
      scheduleUserBioTranslation(db, user.id);
    }

    // 非公開→公開への切り替え時は、非公開中はcron対象外で取りこぼしていたTwitch/YouTubeキャッシュを追いつかせる
    // （edit.tsx の基本情報フォームと同じ処理。連携有無の検索もレスポンスを遅らせないようbackground側で行う）
    if (user.profileVisibility !== "public" && profileVisibility === "public") {
      const mcidAtSave = user.mcid;
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
        })()
      );
    } else if (profileVisibility === "unlisted") {
      // 限定公開もプロフィールは見られるが、SRC/MCSR Ranked ランキングの cron は public のみが対象で追いつかない。
      // 連携ステップ（save_links）では取得しないため、ここで SRC だけ即時に取得する
      // （/me/edit のリンク保存でも限定公開で即時取得される挙動に揃える）
      runAfterResponse(refreshSrcRankingsForUser(user.id));
    }

    // リダイレクトせず完了画面を出す（遷移先と表示名はクライアントが loader の値から組む）
    return { success: true, action: "complete" };
  }

  return { error: t("onboarding.errorInvalidAction") };
}

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;
type DiscordUser = LoaderData["discordUser"];
type OnboardingUser = NonNullable<LoaderData["user"]>;

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

type Completion = { redirectTo: string; name: string };

/**
 * ステップごとの保存用 fetcher。action が `{ success }` を返し、続く loader の再検証まで
 * 終わった（state が idle に戻った）時点で onSuccess を呼ぶ。失敗時は error を返す。
 */
function useStepSubmit(onSuccess: () => void, onBack?: () => void) {
  const fetcher = useFetcher<typeof action>();
  const onSuccessRef = useRef(onSuccess);
  const onBackRef = useRef(onBack);
  // 「戻る」で保存を送ったときだけ true。成功したら onSuccess（次へ）ではなく onBack（前へ）へ進む
  const backAfterSaveRef = useRef(false);
  const [savingForBack, setSavingForBack] = useState(false);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onBackRef.current = onBack;
  });

  const { state, data } = fetcher;
  useEffect(() => {
    if (state !== "idle") return;
    const goBack = backAfterSaveRef.current;
    backAfterSaveRef.current = false;
    setSavingForBack(false);
    if (data && "success" in data && data.success) {
      if (goBack && onBackRef.current) onBackRef.current();
      else onSuccessRef.current();
    }
  }, [state, data]);

  /** 入力途中の「戻る」: 今の入力を保存してから前へ戻る。保存に失敗したらその手順に残り、エラーを見せる */
  const saveThenBack = (form: HTMLFormElement | null) => {
    if (!form) return;
    if (!form.reportValidity()) return;
    backAfterSaveRef.current = true;
    setSavingForBack(true);
    void fetcher.submit(new FormData(form), { method: "post" });
  };

  const error = state === "idle" && data && "error" in data ? data.error : null;
  // 欄に結ぶエラー（save_minecraft の mcid / bedrockMcid）。欄の無いエラーは null
  const errorField = state === "idle" && data && "field" in data ? data.field : null;
  return { fetcher, isSubmitting: state !== "idle", savingForBack, saveThenBack, error, errorField };
}

/**
 * 非制御フォームの「保存済みの値から変わったか」。form の onInput に渡す。
 * 値は FormData から読み、`initial` の各キーと（前後の空白を除いて）比べる。
 * 保存済みの値（途中から再開したときの初期値）はスキップしても消えないので、変わっていなければ未入力と同じ扱い
 */
function useFormDirty(initial: Record<string, string>) {
  const [dirty, setDirty] = useState(false);
  const onInput = (event: React.FormEvent<HTMLFormElement>) => {
    const formData = new FormData(event.currentTarget);
    setDirty(
      Object.entries(initial).some(
        ([name, value]) => ((formData.get(name) as string | null) ?? "").trim() !== value.trim(),
      ),
    );
  };
  return { dirty, onInput };
}

export default function OnboardingPage() {
  const { discordUser, user, links, resumeStep, returnTo } = useLoaderData<typeof loader>();
  // 行があり未完了（途中離脱からの再開）ならようこそ画面を飛ばし、保存済みの内容から推定した手順から
  const [step, setStep] = useState<WizardStep>(() => (user ? resumeStep : 0));
  const [completion, setCompletion] = useState<Completion | null>(null);
  // 手順を自分で切り替えた後だけ、新しい手順のタイトルへフォーカスを移す（ページを開いた直後は動かさない）
  const [moved, setMoved] = useState(false);

  // 画面を切り替えたらページ先頭へ（長いステップの下端から次へ進んだときに途中から表示されないように）
  const goTo = (next: WizardStep) => {
    setStep(next);
    setMoved(true);
    window.scrollTo({ top: 0 });
  };
  const complete = (result: Completion) => {
    setCompletion(result);
    setMoved(true);
    window.scrollTo({ top: 0 });
  };

  let content;
  if (completion) {
    content = <CompleteScreen completion={completion} focusTitle={moved} />;
  } else if (step === 0 || !user) {
    content = <WelcomeStep discordUser={discordUser} onStarted={() => goTo(1)} />;
  } else if (step === 1) {
    content = (
      <ProfileStep user={user} discordName={discordUser.name} focusTitle={moved} onNext={() => goTo(2)} />
    );
  } else if (step === 2) {
    content = <MinecraftStep user={user} focusTitle={moved} onBack={() => goTo(1)} onNext={() => goTo(3)} />;
  } else if (step === 3) {
    content = <SkinStep user={user} focusTitle={moved} onBack={() => goTo(2)} onNext={() => goTo(4)} />;
  } else if (step === 4) {
    content = <LinksStep links={links} focusTitle={moved} onBack={() => goTo(3)} onNext={() => goTo(5)} />;
  } else {
    content = (
      <VisibilityStep
        user={user}
        returnTo={returnTo}
        focusTitle={moved}
        onBack={() => goTo(4)}
        onComplete={complete}
      />
    );
  }

  return (
    // モバイルはカードの外側・内側の余白を詰める（375 幅で本文の幅を確保する）
    <div className="flex-1 flex items-center justify-center py-2 sm:px-4 sm:py-8">
      <Card className="w-full max-w-xl gap-3 py-4 sm:py-5">{content}</Card>
    </div>
  );
}

// ステップ0: ようこそ
function WelcomeStep({ discordUser, onStarted }: { discordUser: DiscordUser; onStarted: () => void }) {
  const t = useT();
  const { fetcher, isSubmitting, error } = useStepSubmit(onStarted);

  return (
    <>
      <CardHeader className="justify-items-center gap-3 px-4 text-center sm:px-5">
        <Avatar className="size-20">
          <AvatarImage
            src={discordUser.image ?? undefined}
            alt={discordUser.name ?? ""}
            className="rounded-full border border-border/70"
          />
          <AvatarFallback className="bg-secondary/50">
            <UserRound className="h-10 w-10 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
        <h1 data-slot="card-title" className="text-2xl font-bold leading-snug">
          {t("onboarding.welcomeTitle", { name: discordUser.name ?? "" })}
        </h1>
        <CardDescription>{t("onboarding.welcomeDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-5">
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="_action" value="start" />
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-success" />
            {t("onboarding.connectedViaDiscord")}
          </p>
          <OnboardingStepError error={error} />
          <Button type="submit" size="lg" className="w-full min-h-11" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("onboarding.getStarted")}
          </Button>
        </fetcher.Form>
      </CardContent>
    </>
  );
}

// ステップ1: プロフィール
function ProfileStep({
  user,
  discordName,
  focusTitle,
  onNext,
}: {
  user: OnboardingUser;
  discordName: string | null | undefined;
  focusTitle: boolean;
  onNext: () => void;
}) {
  const t = useT();
  const { fetcher, isSubmitting, error } = useStepSubmit(onNext);
  // Combobox は controlled のみのため、値は state で持って hidden input で送る
  const [pronouns, setPronouns] = useState(user.pronouns ?? "");
  // 代名詞は hidden input なので onInput では拾えず、state の値で別に比べる
  const { dirty: textDirty, onInput } = useFormDirty({
    displayName: user.displayName ?? "",
    displayNameAlphabet: user.displayNameAlphabet ?? "",
    shortBio: user.shortBio ?? "",
    bio: user.bio ?? "",
    location: user.location ?? "",
  });
  const dirty = textDirty || pronouns.trim() !== (user.pronouns ?? "").trim();

  return (
    <>
      <OnboardingStepHeader
        step={1}
        total={TOTAL_STEPS}
        title={t("onboarding.profileTitle")}
        description={t("onboarding.profileDescription")}
        focusTitle={focusTitle}
      />
      <CardContent className="px-4 sm:px-5">
        <fetcher.Form method="post" className="space-y-4" onInput={onInput}>
          <input type="hidden" name="_action" value="save_profile" />

          <div className="space-y-2">
            <Label htmlFor="displayName">{t("meEdit.displayName")}</Label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={user.displayName ?? ""}
              placeholder={discordName ?? ""}
              maxLength={PROFILE_FIELD_LIMITS.displayName}
            />
            <p className="text-xs text-muted-foreground">
              {t("onboarding.displayNameHint", { name: discordName ?? "" })}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayNameAlphabet">{t("meEdit.displayNameAlphabet")}</Label>
            <Input
              id="displayNameAlphabet"
              name="displayNameAlphabet"
              defaultValue={user.displayNameAlphabet ?? ""}
              placeholder={t("meEdit.displayNameAlphabetPlaceholder")}
              maxLength={PROFILE_FIELD_LIMITS.displayNameAlphabet}
            />
            <p className="text-xs text-muted-foreground">{t("meEdit.displayNameAlphabetHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortBio">{t("meEdit.shortBio")}</Label>
            <Input
              id="shortBio"
              name="shortBio"
              defaultValue={user.shortBio ?? ""}
              placeholder={t("meEdit.shortBioExample")}
              maxLength={PROFILE_FIELD_LIMITS.shortBio}
            />
            <p className="text-xs text-muted-foreground">{t("meEdit.shortBioHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">{t("meEdit.bio")}</Label>
            <Textarea
              id="bio"
              name="bio"
              defaultValue={user.bio ?? ""}
              placeholder={t("meEdit.bioPlaceholder")}
              maxLength={PROFILE_FIELD_LIMITS.bio}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="location">{t("meEdit.location")}</Label>
              <Input
                id="location"
                name="location"
                defaultValue={user.location ?? ""}
                placeholder={t("meEdit.locationExample")}
                maxLength={PROFILE_FIELD_LIMITS.location}
              />
            </div>

            <div className="space-y-2">
              {/* trigger ボタン（role="combobox"）に名前を付ける */}
              <Label htmlFor="pronouns">{t("meEdit.pronouns")}</Label>
              <Combobox
                id="pronouns"
                options={pronounOptions}
                value={pronouns}
                onValueChange={(value) => setPronouns(value.slice(0, PROFILE_FIELD_LIMITS.pronouns))}
                placeholder={t("meEdit.pronounsExample")}
                allowCustomValue={true}
              />
              <input type="hidden" name="pronouns" value={pronouns} />
            </div>
          </div>

          <OnboardingStepError error={error} />
          {/* 入力があるときはスキップを出さない（黙って入力を捨てない。「次へ」で保存して進む） */}
          <OnboardingStepFooter
            onSkip={dirty ? undefined : onNext}
            nextLabel={t("onboarding.next")}
            isSubmitting={isSubmitting}
          />
        </fetcher.Form>
      </CardContent>
    </>
  );
}

// ステップ2: Minecraft
function MinecraftStep({
  user,
  focusTitle,
  onBack,
  onNext,
}: {
  user: OnboardingUser;
  focusTitle: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const { fetcher, isSubmitting, savingForBack, saveThenBack, error, errorField } = useStepSubmit(onNext, onBack);
  const formRef = useRef<HTMLFormElement>(null);
  const { dirty, onInput } = useFormDirty({
    mcid: user.mcid ?? "",
    bedrockMcid: user.bedrockMcid ?? "",
  });
  // 欄を離れたときの形式チェック（空欄は任意なので検証しない）。サーバーの照合結果は送信後に欄へ結ぶ
  const [blurErrors, setBlurErrors] = useState<{ mcid: string | null; bedrockMcid: string | null }>({
    mcid: null,
    bedrockMcid: null,
  });
  const validateOnBlur = (field: "mcid" | "bedrockMcid", raw: string) => {
    const value = raw.trim();
    const key = !value ? null : field === "mcid" ? validateMcidFormat(value) : validateBedrockMcidFormat(value);
    setBlurErrors((prev) => ({ ...prev, [field]: key ? t(key) : null }));
  };
  // サーバーのエラー（Mojang の照合・重複など）は、その欄を書き直すまで出しておく。送信のたびに戻す
  const [editedSinceSubmit, setEditedSinceSubmit] = useState({ mcid: false, bedrockMcid: false });
  useEffect(() => {
    if (fetcher.state === "submitting") setEditedSinceSubmit({ mcid: false, bedrockMcid: false });
  }, [fetcher.state]);
  const fieldError = (field: "mcid" | "bedrockMcid"): string | null =>
    blurErrors[field] ?? (!editedSinceSubmit[field] && errorField === field ? (error ?? null) : null);
  const mcidError = fieldError("mcid");
  const bedrockError = fieldError("bedrockMcid");

  return (
    <>
      <OnboardingStepHeader
        step={2}
        total={TOTAL_STEPS}
        title={t("onboarding.minecraftTitle")}
        description={t("onboarding.minecraftDescription")}
        focusTitle={focusTitle}
      />
      <CardContent className="px-4 sm:px-5">
        <fetcher.Form ref={formRef} method="post" className="space-y-4" onInput={onInput}>
          <input type="hidden" name="_action" value="save_minecraft" />

          <div className="space-y-2">
            <Label htmlFor="mcid">{t("onboarding.mcidLabel")}</Label>
            <Input
              id="mcid"
              name="mcid"
              defaultValue={user.mcid ?? ""}
              placeholder={t("onboarding.mcidPlaceholder")}
              minLength={PROFILE_FIELD_LIMITS.mcidMin}
              maxLength={PROFILE_FIELD_LIMITS.mcidMax}
              autoComplete="off"
              aria-invalid={mcidError ? true : undefined}
              aria-describedby={mcidError ? "mcid-error mcid-hint" : "mcid-hint"}
              onChange={() => setEditedSinceSubmit((prev) => ({ ...prev, mcid: true }))}
              onBlur={(e) => validateOnBlur("mcid", e.currentTarget.value)}
            />
            <FieldError id="mcid-error" message={mcidError} />
            <p id="mcid-hint" className="text-xs text-muted-foreground">
              <Info className="mr-1 inline h-3 w-3" aria-hidden />
              {t("onboarding.mcidHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bedrockMcid">{t("meEdit.bedrockMcidTitle")}</Label>
            <Input
              id="bedrockMcid"
              name="bedrockMcid"
              defaultValue={user.bedrockMcid ?? ""}
              placeholder={t("meEdit.bedrockMcidExample")}
              minLength={PROFILE_FIELD_LIMITS.bedrockMcidMin}
              maxLength={PROFILE_FIELD_LIMITS.bedrockMcidMax}
              autoComplete="off"
              aria-invalid={bedrockError ? true : undefined}
              aria-describedby={bedrockError ? "bedrockMcid-error bedrockMcid-hint" : "bedrockMcid-hint"}
              onChange={() => setEditedSinceSubmit((prev) => ({ ...prev, bedrockMcid: true }))}
              onBlur={(e) => validateOnBlur("bedrockMcid", e.currentTarget.value)}
            />
            <FieldError id="bedrockMcid-error" message={bedrockError} />
            <p id="bedrockMcid-hint" className="text-xs text-muted-foreground">{t("meEdit.bedrockMcidDesc")}</p>
          </div>

          {/* 欄に結んだエラーは下に重ねて出さない */}
          <OnboardingStepError error={errorField ? null : error} />
          <OnboardingStepFooter
            onBack={dirty ? () => saveThenBack(formRef.current) : onBack}
            backSaving={savingForBack}
            onSkip={dirty ? undefined : onNext}
            nextLabel={t("onboarding.next")}
            isSubmitting={isSubmitting}
          />
        </fetcher.Form>
      </CardContent>
    </>
  );
}

/** 欄の直下に出すエラー（Input の aria-describedby から id で結ぶ） */
function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-1 text-xs text-destructive">
      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

// ステップ3: スキン（アップロード/削除は既存 API /api/me/skin を使うため、このステップ専用の action は無い）
function SkinStep({
  user,
  focusTitle,
  onBack,
  onNext,
}: {
  user: OnboardingUser;
  focusTitle: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const revalidator = useRevalidator();
  // アップロード/削除の完了後に loader を再取得してプレビューを更新する
  const refresh = () => {
    void revalidator.revalidate();
  };

  return (
    <>
      <OnboardingStepHeader
        step={3}
        total={TOTAL_STEPS}
        title={t("onboarding.skinTitle")}
        description={t("onboarding.skinDescription")}
        focusTitle={focusTitle}
      />
      <CardContent className="space-y-4 px-4 sm:px-5">
        {/* プレビュー（uuid も customSkinUrl も無ければ各コンポーネントのプレースホルダ表示に任せる） */}
        <div className="flex items-center justify-center gap-6 rounded-lg border border-border/60 bg-secondary/50 p-4">
          <div className="h-36 w-24 shrink-0">
            <MinecraftFullBody
              uuid={user.uuid ?? undefined}
              skinUrl={user.customSkinUrl ?? undefined}
              mcid={user.mcid ?? undefined}
              width={96}
              height={144}
              pose="waving"
              angle={-35}
              elevation={5}
              zoom={0.9}
              slim={user.slimSkin ?? false}
              {...resolveCapeProps({
                uuid: user.uuid,
                customCapeUrl: user.customCapeUrl,
                capeDisplay: user.capeDisplay,
              })}
              asImage
            />
          </div>
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl">
            <MinecraftAvatar uuid={user.uuid} skinUrl={user.customSkinUrl} mcid={user.mcid} size={64} />
          </div>
        </div>

        {/* カスタムスキン（edit.tsx の「カスタムスキン」欄と同じ配線） */}
        <div className="space-y-3">
          <Label>{t("skinUploader.customSkinTitle")}</Label>
          <p className="text-sm text-muted-foreground">{t("skinUploader.customSkinDesc")}</p>
          {user.customSkinUrl && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t("skinUploader.customSkinActive")}</AlertDescription>
            </Alert>
          )}
          <SkinUploader
            userId={user.id}
            currentSkinUrl={user.customSkinUrl}
            onUploadComplete={refresh}
            onDelete={refresh}
          />
        </div>

        <OnboardingStepFooter
          onBack={onBack}
          onNext={onNext}
          nextLabel={t("onboarding.next")}
          isSubmitting={revalidator.state === "loading"}
        />
      </CardContent>
    </>
  );
}

// ステップ4: 連携
function LinksStep({
  links,
  focusTitle,
  onBack,
  onNext,
}: {
  links: LoaderData["links"];
  focusTitle: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const { fetcher, isSubmitting, savingForBack, saveThenBack, error } = useStepSubmit(onNext, onBack);
  const formRef = useRef<HTMLFormElement>(null);
  const { dirty, onInput } = useFormDirty(links);

  return (
    <>
      <OnboardingStepHeader
        step={4}
        total={TOTAL_STEPS}
        title={t("onboarding.linksTitle")}
        description={t("onboarding.linksDescription")}
        focusTitle={focusTitle}
      />
      <CardContent className="px-4 sm:px-5">
        <fetcher.Form ref={formRef} method="post" className="space-y-4" onInput={onInput}>
          <input type="hidden" name="_action" value="save_links" />

          {LINK_PLATFORMS.map((platform) => (
            <div key={platform.value} className="space-y-2">
              <Label htmlFor={`link-${platform.value}`}>
                <platform.icon className="h-4 w-4" />
                {platform.label}
              </Label>
              {/* 接頭辞は sm 以上で一番長い物（speedrun.com/users/）の幅にそろえ、入力欄の左端を縦に合わせる。
                  モバイルは欄の上に置き、入力欄を全幅にする */}
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <span className="shrink-0 text-sm text-muted-foreground sm:w-[9.5rem]">{platform.prefix}</span>
                <Input
                  id={`link-${platform.value}`}
                  name={platform.value}
                  defaultValue={links[platform.value]}
                  placeholder={t("onboarding.linkPlaceholder", { example: platform.example })}
                  maxLength={PROFILE_FIELD_LIMITS.linkIdentifier}
                  autoComplete="off"
                  className="min-w-0 flex-1"
                />
              </div>
            </div>
          ))}

          <OnboardingStepError error={error} />
          <OnboardingStepFooter
            onBack={dirty ? () => saveThenBack(formRef.current) : onBack}
            backSaving={savingForBack}
            onSkip={dirty ? undefined : onNext}
            nextLabel={t("onboarding.next")}
            isSubmitting={isSubmitting}
          />
        </fetcher.Form>
      </CardContent>
    </>
  );
}

// ステップ5: 公開設定（スキップ不可）
function VisibilityStep({
  user,
  returnTo,
  focusTitle,
  onBack,
  onComplete,
}: {
  user: OnboardingUser;
  returnTo: string | null;
  focusTitle: boolean;
  onBack: () => void;
  onComplete: (completion: Completion) => void;
}) {
  const t = useT();
  const locale = useLocale();
  // 完了画面の遷移先と表示名は loader の値から組む（各ステップの保存後に loader を再検証済みのため、
  // slug・表示名は保存後の値になっている）
  const { fetcher, isSubmitting, error } = useStepSubmit(() => {
    onComplete({
      redirectTo: returnTo || `/player/${user.slug}`,
      name: getLocalizedDisplayName(user, locale),
    });
  });
  // 既定選択なし（本人が必ず選ぶ）。選ぶまで完了ボタンは押せない
  const [visibility, setVisibility] = useState<ProfileVisibility | "">("");
  // 表示設定のトグル。畳んだ要約に今の状態を出すため controlled にする（既定値は従来どおり保存済みの値、無ければオン）
  const [toggles, setToggles] = useState<Record<(typeof DISPLAY_TOGGLES)[number]["name"], boolean>>(() => ({
    showRankedStats: user.showRankedStats ?? true,
    showPacemanStats: user.showPacemanStats ?? true,
    showPacemanOnHome: user.showPacemanOnHome ?? true,
    showTwitchOnHome: user.showTwitchOnHome ?? true,
    showYoutubeOnHome: user.showYoutubeOnHome ?? true,
  }));
  const onCount = DISPLAY_TOGGLES.filter((toggle) => toggles[toggle.name]).length;
  const toggleSummary =
    onCount === DISPLAY_TOGGLES.length
      ? t("onboarding.displaySummaryAllOn")
      : onCount === 0
        ? t("onboarding.displaySummaryAllOff")
        : t("onboarding.displaySummarySome", { count: onCount, total: DISPLAY_TOGGLES.length });

  return (
    <>
      <OnboardingStepHeader
        step={5}
        total={TOTAL_STEPS}
        title={t("onboarding.visibilityTitle")}
        description={t("onboarding.visibilityDescription")}
        focusTitle={focusTitle}
      />
      <CardContent className="px-4 sm:px-5">
        <fetcher.Form method="post" className="space-y-5">
          <input type="hidden" name="_action" value="save_visibility" />
          <input type="hidden" name="profileVisibility" value={visibility} />

          <div className="space-y-3">
            <Label id="visibility-label">{t("onboarding.visibilityChoiceLabel")}</Label>
            <RadioGroup
              value={visibility}
              onValueChange={(value) => setVisibility(value as ProfileVisibility)}
              aria-labelledby="visibility-label"
              aria-required
              className="gap-2"
            >
              {VISIBILITY_OPTIONS.map((option) => (
                <Label
                  key={option.value}
                  htmlFor={`visibility-${option.value}`}
                  className={cn(
                    "cursor-pointer rounded-lg border border-border/70 px-3 py-3 font-normal leading-snug transition-colors",
                    // 選択中は brand（ui.md 1 章「brand＝選択中・進行」）
                    visibility === option.value && "border-brand/60 bg-brand/10",
                  )}
                >
                  <RadioGroupItem id={`visibility-${option.value}`} value={option.value} />
                  {t(option.labelKey)}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* 表示設定は畳み、要約の1行だけを出す（既定値は変えない）。畳んでいても中の Switch はフォームに含まれ、
              オンのときだけ name=value("true") が送信される（edit.tsx の Switch と同じ） */}
          <details className="group border-t border-border/60 pt-4">
            <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
                aria-hidden
              />
              <span className="font-medium">{t("meEdit.displaySettings")}</span>
              <span className="text-muted-foreground">{toggleSummary}</span>
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">{t("meEdit.displaySettingsHint")}</p>
              {DISPLAY_TOGGLES.map((toggle) => (
                <div key={toggle.name} className="flex items-center justify-between gap-3">
                  <Label htmlFor={toggle.name} className="cursor-pointer text-sm font-normal leading-snug">
                    {t(toggle.labelKey)}
                  </Label>
                  <Switch
                    id={toggle.name}
                    name={toggle.name}
                    value="true"
                    checked={toggles[toggle.name]}
                    onCheckedChange={(checked) => setToggles((prev) => ({ ...prev, [toggle.name]: checked }))}
                  />
                </div>
              ))}
            </div>
          </details>

          <OnboardingStepError error={error} />
          <OnboardingStepFooter
            onBack={onBack}
            nextLabel={t("onboarding.finish")}
            nextDisabled={!visibility}
            isSubmitting={isSubmitting}
            hint={visibility ? undefined : t("onboarding.visibilityChoiceHint")}
          />
        </fetcher.Form>
      </CardContent>
    </>
  );
}

// 完了画面
function CompleteScreen({ completion, focusTitle }: { completion: Completion; focusTitle: boolean }) {
  const t = useT();
  const titleRef = useFocusOnMount<HTMLHeadingElement>(focusTitle);

  return (
    <>
      <CardHeader className="justify-items-center gap-3 px-4 text-center sm:px-5">
        <CheckCircle2 className="mb-1 h-8 w-8 text-success" aria-hidden />
        <p className="text-sm font-medium text-success">{t("onboarding.completeTitle")}</p>
        <h1
          ref={titleRef}
          tabIndex={-1}
          data-slot="card-title"
          className="text-2xl font-bold leading-snug focus-visible:outline-none"
        >
          {t("onboarding.completeWelcome", { name: completion.name })}
        </h1>
        <CardDescription>{t("onboarding.completeDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-5">
        {/* 主操作は「キー配置を登録する」1つ（製品の核へつなぐため）。副次の2つは2段目に並べる */}
        <div className="flex flex-col gap-2 sm:items-center">
          <Button asChild size="lg" className="min-h-11">
            <Link to="/me/keybindings">{t("onboarding.registerKeybindings")}</Link>
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
            <Button asChild size="lg" variant="outline" className="min-h-11">
              <Link to={completion.redirectTo}>{t("onboarding.viewProfile")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="min-h-11">
              <Link to="/me/edit">{t("onboarding.moreSettings")}</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </>
  );
}
