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
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, socialLinks } from "@/lib/schema";
import { fetchUuidFromMcid, MojangError } from "@/lib/mojang";
import { createDefaultsForNewUser } from "@/lib/defaults";
import { generateSlug, getLocalizedDisplayName } from "@/lib/slug";
import { sanitizeReturnTo } from "@/lib/return-to";
import { claimSlug, recordSlugChange } from "@/lib/slug-history.server";
import { retargetFavoritesOnSlugChange } from "@/lib/favorites";
import {
  runAfterResponse,
  refreshTwitchVodsForLogin,
  refreshYoutubeForChannel,
  refreshSrcRankingsForUser,
} from "@/lib/targeted-refresh.server";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/hooks/use-locale";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/components/onboarding/onboarding-step";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Twitch,
  Twitter,
  UserRound,
  Youtube,
} from "lucide-react";

// enum系フィールドのallowlist。手書き配列ではなく schema.ts の enum 定義（列の enumValues）から導出する
const VISIBILITIES = users.profileVisibility.enumValues;
type ProfileVisibility = (typeof VISIBILITIES)[number];

/** ウィザードのステップ数（ようこそ画面・完了画面は数えない） */
const TOTAL_STEPS = 5;

// 連携ステップで扱うプラットフォーム（custom は扱わない）。
// label / placeholder / prefix は edit.tsx の platformOptions に倣う
const LINK_PLATFORMS = [
  { value: "youtube", label: "YouTube", placeholder: "e.g. couriern3w", prefix: "youtube.com/@" },
  { value: "twitch", label: "Twitch", placeholder: "e.g. couriern3w", prefix: "twitch.tv/" },
  { value: "twitter", label: "Twitter/X", placeholder: "e.g. couriern3w", prefix: "x.com/" },
  { value: "speedruncom", label: "Speedrun.com", placeholder: "e.g. couriern3w", prefix: "speedrun.com/users/" },
] as const;
type LinkPlatform = (typeof LINK_PLATFORMS)[number]["value"];
const LINK_PLATFORM_VALUES = LINK_PLATFORMS.map((p) => p.value);

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
type DisplayToggleName = (typeof DISPLAY_TOGGLES)[number]["name"];

/**
 * Discord 表示名を「アルファベット表記の表示名」の既定値に使えるなら返す。
 * edit.tsx の基本情報フォームと同じ規則（印字可能 ASCII のみ・50 文字以内）を満たすときだけ採用し、
 * そうでなければ null（日本語名などは英語ロケールで displayName にフォールバックさせる）。
 * ウィザード開始時（start）と、ステップ1で未入力のとき（save_profile）の両方で使う。
 */
function discordNameAsAlphabet(name: string | null | undefined): string | null {
  const value = name?.trim();
  if (!value || value.length > 50 || !/^[\x20-\x7E]+$/.test(value)) {
    return null;
  }
  return value;
}

/**
 * ソーシャルリンク ID の形式検証。edit.tsx の create_link と同じ規則
 * （100 文字以内、YouTube は禁止文字方式、それ以外は英数字・ハイフン・アンダースコアのみ）。
 * 問題なければ null を返す。
 */
function validateLinkIdentifier(t: Translator, platform: LinkPlatform, identifier: string): string | null {
  if (identifier.length > 100) {
    return t("meEdit.idMaxLength");
  }
  if (platform === "youtube") {
    // YouTubeハンドルは日本語などUnicode文字を許可。空白、@、URL特殊文字は禁止
    if (/[\s@#$%^&*()+=\[\]{}|\\;:'",<>/?]/.test(identifier)) {
      return t("meEdit.idInvalidChars");
    }
  } else if (!/^[\w\-]+$/.test(identifier)) {
    // 英数字、ハイフン、アンダースコアのみ許可（@と.は除外）
    return t("meEdit.idAllowedChars");
  }
  return null;
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

  if (existingUser && existingUser.onboardingCompleted) {
    // 登録済み — ログイン前にいたページ（returnTo）があればそこへ、なければプロフィールへ
    return redirect(returnTo || `/player/${existingUser.slug}`);
  }

  // 連携ステップの初期値（プラットフォームごとに先頭の1件）
  const links: Record<LinkPlatform, string> = { youtube: "", twitch: "", twitter: "", speedruncom: "" };
  for (const link of existingUser?.socialLinks ?? []) {
    const platform = LINK_PLATFORM_VALUES.find((p) => p === link.platform);
    if (platform && !links[platform]) {
      links[platform] = link.identifier;
    }
  }

  return {
    discordUser: {
      id: session.user.id,
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
          showRankedStats: existingUser.showRankedStats,
          showPacemanStats: existingUser.showPacemanStats,
          showPacemanOnHome: existingUser.showPacemanOnHome,
          showTwitchOnHome: existingUser.showTwitchOnHome,
          showYoutubeOnHome: existingUser.showYoutubeOnHome,
        }
      : null,
    links,
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

    // 以下の検証は edit.tsx の基本情報フォームと同じ規則
    if (displayName && displayName.length > 50) {
      return { error: t("meEdit.displayNameMax") };
    }

    if (displayNameAlphabet && displayNameAlphabet.length > 50) {
      return { error: t("meEdit.displayNameAlphabetMax") };
    }

    // アルファベット表記は印字可能な ASCII のみ（英数字・空白・基本記号）
    if (displayNameAlphabet && !/^[\x20-\x7E]+$/.test(displayNameAlphabet)) {
      return { error: t("meEdit.displayNameAlphabetInvalid") };
    }

    if (bio && bio.length > 500) {
      return { error: t("meEdit.bioMax") };
    }

    if (location && location.length > 100) {
      return { error: t("meEdit.locationMax") };
    }

    if (shortBio && shortBio.length > 50) {
      return { error: t("meEdit.shortBioMax") };
    }

    if (pronouns && pronouns.length > 20) {
      return { error: t("meEdit.pronounsMax") };
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

    return { success: true, action: "profile" };
  }

  // ステップ2: Minecraft（Java版 MCID / Bedrock版 MCID）
  if (actionType === "save_minecraft") {
    const mcid = (formData.get("mcid") as string)?.trim() || "";
    const bedrockMcidInput = (formData.get("bedrockMcid") as string)?.trim() || "";

    // Bedrock版MCID: edit.tsx の set_bedrock_mcid と同じ規則。空欄なら null（解除）。
    // 自己申告の表示用テキストのためMojang検証はせず、uuid・スキン・slug には関与させない
    if (bedrockMcidInput) {
      // Xboxゲーマータグは最大12文字だが、新形式の `#1234` サフィックスまで許容する
      if (bedrockMcidInput.length < 3 || bedrockMcidInput.length > 24) {
        return { error: t("meEdit.bedrockMcidLength") };
      }
      // 制御文字（改行・タブ等）のみ拒否し、それ以外の文字種は制限しない
      if (/[\u0000-\u001f\u007f]/.test(bedrockMcidInput)) {
        return { error: t("meEdit.bedrockMcidInvalid") };
      }
    }
    const bedrockMcid = bedrockMcidInput || null;

    if (mcid && mcid !== user.mcid) {
      // Java版MCIDの設定/変更: edit.tsx の set_mcid と同じ処理
      if (mcid.length < 3 || mcid.length > 16) {
        return { error: t("meEdit.mcidLength") };
      }

      // 既に同じMCIDが登録されていないかチェック
      const existingUser = await db.query.users.findFirst({
        where: eq(users.mcid, mcid),
      });

      if (existingUser && existingUser.id !== user.id) {
        return { error: t("meEdit.mcidTaken") };
      }

      // Mojang APIで検証
      try {
        const uuid = await fetchUuidFromMcid(mcid);
        const newSlug = generateSlug(mcid, session.user.id);

        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({
              mcid,
              uuid,
              slug: newSlug,
              bedrockMcid,
              updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

          await recordSlugChange(tx, { userId: user.id, oldSlug: user.slug, newSlug });
          await retargetFavoritesOnSlugChange(tx, { oldSlug: user.slug, newSlug });
        });
        // edit.tsx の set_mcid が行う YouTube 動画キャッシュの追従（updateYoutubeCacheMcid / 即時取得）は
        // ここでは行わない。ウィザード中は常に非公開（cron 対象外）でキャッシュが存在せず、
        // 公開へ切り替えた時点で save_visibility が最新の MCID で追いつかせるため
      } catch (error) {
        if (error instanceof MojangError) {
          if (error.code === "MCID_NOT_FOUND") {
            return { error: t("meEdit.mcidNotFound") };
          }
        }
        return { error: t("meEdit.mcidVerifyFailed") };
      }
    } else if (!mcid && user.mcid) {
      // 空欄で現在 MCID があれば解除: edit.tsx の remove_mcid と同じ処理
      const newSlug = generateSlug(null, session.user.id);

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            mcid: null,
            uuid: null,
            slug: newSlug,
            bedrockMcid,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        await recordSlugChange(tx, { userId: user.id, oldSlug: user.slug, newSlug });
        await retargetFavoritesOnSlugChange(tx, { oldSlug: user.slug, newSlug });
      });
    } else if (bedrockMcid !== user.bedrockMcid) {
      await db
        .update(users)
        .set({ bedrockMcid, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    return { success: true, action: "minecraft" };
  }

  // ステップ4: 連携（social_links へのプラットフォーム単位の upsert）
  if (actionType === "save_links") {
    const values: Record<LinkPlatform, string> = { youtube: "", twitch: "", twitter: "", speedruncom: "" };
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

    if (speedruncomChanged) {
      runAfterResponse(refreshSrcRankingsForUser(user.id));
    }
    // Twitch VOD / YouTube 動画キャッシュの取得はここでは行わない（非公開中は cron 対象外。
    // 公開へ切り替えたときに save_visibility で追いつかせる）

    return { success: true, action: "links" };
  }

  // ステップ5: 公開設定（ウィザード完了）
  if (actionType === "save_visibility") {
    const profileVisibility = formData.get("profileVisibility") as ProfileVisibility;
    const returnTo = sanitizeReturnTo(formData.get("returnTo"));

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
    }

    // リダイレクトせず完了画面を出す（遷移先はクライアントの CTA が使う）
    return {
      success: true,
      action: "complete",
      slug: user.slug,
      redirectTo: returnTo || `/player/${user.slug}`,
      mcid: user.mcid,
      displayName: user.displayName,
      displayNameAlphabet: user.displayNameAlphabet,
    };
  }

  return { error: t("onboarding.errorInvalidAction") };
}

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;
type DiscordUser = LoaderData["discordUser"];
type OnboardingUser = NonNullable<LoaderData["user"]>;
type ActionData = NonNullable<ReturnType<typeof useFetcher<typeof action>>["data"]>;

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

type Completion = { redirectTo: string; name: string };

/**
 * ステップごとの保存用 fetcher。action が `{ success }` を返し、続く loader の再検証まで
 * 終わった（state が idle に戻った）時点で onSuccess を呼ぶ。失敗時は error を返す。
 */
function useStepSubmit(onSuccess: (data: ActionData) => void) {
  const fetcher = useFetcher<typeof action>();
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  const { state, data } = fetcher;
  useEffect(() => {
    if (state === "idle" && data && "success" in data && data.success) {
      onSuccessRef.current(data);
    }
  }, [state, data]);

  const error = state === "idle" && data && "error" in data ? data.error : null;
  return { fetcher, isSubmitting: state !== "idle", error };
}

export default function OnboardingPage() {
  const { discordUser, user, links, returnTo } = useLoaderData<typeof loader>();
  // 行があり未完了（途中離脱からの再開）ならようこそ画面を飛ばしてステップ1から
  const [step, setStep] = useState<WizardStep>(() => (user ? 1 : 0));
  const [completion, setCompletion] = useState<Completion | null>(null);

  // ステップが変わったらページ先頭へ（長いステップの下端から次へ進んだときに途中から表示されないように）
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [step, completion]);

  let content;
  if (completion) {
    content = <CompleteScreen completion={completion} />;
  } else if (step === 0 || !user) {
    content = <WelcomeStep discordUser={discordUser} onStarted={() => setStep(1)} />;
  } else if (step === 1) {
    content = <ProfileStep key="profile" user={user} discordName={discordUser.name} onNext={() => setStep(2)} />;
  } else if (step === 2) {
    content = (
      <MinecraftStep key="minecraft" user={user} onBack={() => setStep(1)} onNext={() => setStep(3)} />
    );
  } else if (step === 3) {
    content = <SkinStep key="skin" user={user} onBack={() => setStep(2)} onNext={() => setStep(4)} />;
  } else if (step === 4) {
    content = (
      <LinksStep key="links" links={links} onBack={() => setStep(3)} onNext={() => setStep(5)} />
    );
  } else {
    content = (
      <VisibilityStep
        key="visibility"
        user={user}
        returnTo={returnTo}
        onBack={() => setStep(4)}
        onComplete={setCompletion}
      />
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <Card className="w-full max-w-xl gap-3 py-5">{content}</Card>
    </div>
  );
}

// ステップ0: ようこそ
function WelcomeStep({ discordUser, onStarted }: { discordUser: DiscordUser; onStarted: () => void }) {
  const t = useT();
  const { fetcher, isSubmitting, error } = useStepSubmit(onStarted);

  return (
    <>
      <CardHeader className="justify-items-center gap-3 px-5 text-center">
        {discordUser.image ? (
          <img
            src={discordUser.image}
            alt={discordUser.name ?? ""}
            className="h-20 w-20 rounded-full border border-border/70"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary/50">
            <UserRound className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
        <CardTitle className="text-2xl font-bold leading-tight">
          {t("onboarding.welcomeTitle", { name: discordUser.name ?? "" })}
        </CardTitle>
        <CardDescription>{t("onboarding.welcomeDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="_action" value="start" />
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-success" />
            {t("onboarding.connectedViaDiscord")}
          </p>
          <OnboardingStepError error={error} />
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
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
  onNext,
}: {
  user: OnboardingUser;
  discordName: string | null | undefined;
  onNext: () => void;
}) {
  const t = useT();
  const { fetcher, isSubmitting, error } = useStepSubmit(onNext);
  // Combobox は controlled のみのため、値は state で持って hidden input で送る
  const [pronouns, setPronouns] = useState(user.pronouns ?? "");

  return (
    <>
      <OnboardingStepHeader
        step={1}
        total={TOTAL_STEPS}
        title={t("onboarding.profileTitle")}
        description={t("onboarding.profileDescription")}
      />
      <CardContent className="px-5">
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="_action" value="save_profile" />

          <div className="space-y-2">
            <Label htmlFor="displayName">{t("meEdit.displayName")}</Label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={user.displayName ?? ""}
              placeholder={discordName ?? ""}
              maxLength={50}
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
              maxLength={50}
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
              maxLength={50}
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
              maxLength={500}
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
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("meEdit.pronouns")}</Label>
              <Combobox
                options={pronounOptions}
                value={pronouns}
                onValueChange={(value) => setPronouns(value.slice(0, 20))}
                placeholder={t("meEdit.pronounsExample")}
                allowCustomValue={true}
              />
              <input type="hidden" name="pronouns" value={pronouns} />
            </div>
          </div>

          <OnboardingStepError error={error} />
          <OnboardingStepFooter
            onSkip={onNext}
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
  onBack,
  onNext,
}: {
  user: OnboardingUser;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const { fetcher, isSubmitting, error } = useStepSubmit(onNext);

  return (
    <>
      <OnboardingStepHeader
        step={2}
        total={TOTAL_STEPS}
        title={t("onboarding.minecraftTitle")}
        description={t("onboarding.minecraftDescription")}
      />
      <CardContent className="px-5">
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="_action" value="save_minecraft" />

          <div className="space-y-2">
            <Label htmlFor="mcid">{t("onboarding.mcidLabel")}</Label>
            <Input
              id="mcid"
              name="mcid"
              defaultValue={user.mcid ?? ""}
              placeholder={t("onboarding.mcidPlaceholder")}
              minLength={3}
              maxLength={16}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              <Info className="mr-1 inline h-3 w-3" />
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
              minLength={3}
              maxLength={24}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t("meEdit.bedrockMcidDesc")}</p>
          </div>

          <OnboardingStepError error={error} />
          <OnboardingStepFooter
            onBack={onBack}
            onSkip={onNext}
            nextLabel={t("onboarding.next")}
            isSubmitting={isSubmitting}
          />
        </fetcher.Form>
      </CardContent>
    </>
  );
}

// ステップ3: スキン（アップロード/削除は既存 API /api/me/skin を使うため、このステップ専用の action は無い）
function SkinStep({
  user,
  onBack,
  onNext,
}: {
  user: OnboardingUser;
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
      />
      <CardContent className="space-y-4 px-5">
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

function LinkPlatformIcon({ platform }: { platform: LinkPlatform }) {
  switch (platform) {
    case "youtube":
      return <Youtube className="h-4 w-4" />;
    case "twitch":
      return <Twitch className="h-4 w-4" />;
    case "twitter":
      return <Twitter className="h-4 w-4" />;
    default:
      return <ExternalLink className="h-4 w-4" />;
  }
}

// ステップ4: 連携
function LinksStep({
  links,
  onBack,
  onNext,
}: {
  links: LoaderData["links"];
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const { fetcher, isSubmitting, error } = useStepSubmit(onNext);

  return (
    <>
      <OnboardingStepHeader
        step={4}
        total={TOTAL_STEPS}
        title={t("onboarding.linksTitle")}
        description={t("onboarding.linksDescription")}
      />
      <CardContent className="px-5">
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="_action" value="save_links" />

          {LINK_PLATFORMS.map((platform) => (
            <div key={platform.value} className="space-y-2">
              <Label htmlFor={`link-${platform.value}`}>
                <LinkPlatformIcon platform={platform.value} />
                {platform.label}
              </Label>
              <div className="flex items-center">
                <span className="mr-2 shrink-0 text-sm text-muted-foreground">{platform.prefix}</span>
                <Input
                  id={`link-${platform.value}`}
                  name={platform.value}
                  defaultValue={links[platform.value]}
                  placeholder={platform.placeholder}
                  maxLength={100}
                  autoComplete="off"
                  className="flex-1"
                />
              </div>
            </div>
          ))}

          <OnboardingStepError error={error} />
          <OnboardingStepFooter
            onBack={onBack}
            onSkip={onNext}
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
  onBack,
  onComplete,
}: {
  user: OnboardingUser;
  returnTo: string | null;
  onBack: () => void;
  onComplete: (completion: Completion) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { fetcher, isSubmitting, error } = useStepSubmit((data) => {
    // action の戻り値は各分岐の和が1つのオブジェクト型に正規化される（complete 固有の項目は optional）ため、
    // 完了分岐の項目が揃っていることを実行時に確かめてから使う
    if (!("redirectTo" in data) || !data.redirectTo || !data.slug) return;
    onComplete({
      redirectTo: data.redirectTo,
      name: getLocalizedDisplayName(
        {
          displayName: data.displayName ?? null,
          displayNameAlphabet: data.displayNameAlphabet ?? null,
          mcid: data.mcid ?? null,
          slug: data.slug,
        },
        locale,
      ),
    });
  });
  // 既定選択なし（本人が必ず選ぶ）。選ぶまで完了ボタンは押せない
  const [visibility, setVisibility] = useState<ProfileVisibility | "">("");
  const [toggles, setToggles] = useState<Record<DisplayToggleName, boolean>>(() => ({
    showRankedStats: user.showRankedStats ?? true,
    showPacemanStats: user.showPacemanStats ?? true,
    showPacemanOnHome: user.showPacemanOnHome ?? true,
    showTwitchOnHome: user.showTwitchOnHome ?? true,
    showYoutubeOnHome: user.showYoutubeOnHome ?? true,
  }));

  return (
    <>
      <OnboardingStepHeader
        step={5}
        total={TOTAL_STEPS}
        title={t("onboarding.visibilityTitle")}
        description={t("onboarding.visibilityDescription")}
      />
      <CardContent className="px-5">
        <fetcher.Form method="post" className="space-y-5">
          <input type="hidden" name="_action" value="save_visibility" />
          <input type="hidden" name="profileVisibility" value={visibility} />
          {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
          {DISPLAY_TOGGLES.map((toggle) => (
            <input key={toggle.name} type="hidden" name={toggle.name} value={String(toggles[toggle.name])} />
          ))}

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
                    visibility === option.value && "border-primary/60 bg-primary/10",
                  )}
                >
                  <RadioGroupItem id={`visibility-${option.value}`} value={option.value} />
                  {t(option.labelKey)}
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-3 border-t border-border/60 pt-4">
            <div className="space-y-1">
              <Label>{t("meEdit.displaySettings")}</Label>
              <p className="text-xs text-muted-foreground">{t("meEdit.displaySettingsHint")}</p>
            </div>
            {DISPLAY_TOGGLES.map((toggle) => (
              <div key={toggle.name} className="flex items-center justify-between gap-3">
                <Label htmlFor={toggle.name} className="cursor-pointer text-sm font-normal leading-snug">
                  {t(toggle.labelKey)}
                </Label>
                <Switch
                  id={toggle.name}
                  checked={toggles[toggle.name]}
                  onCheckedChange={(checked) => setToggles((prev) => ({ ...prev, [toggle.name]: checked }))}
                />
              </div>
            ))}
          </div>

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
function CompleteScreen({ completion }: { completion: Completion }) {
  const t = useT();

  return (
    <>
      <CardHeader className="justify-items-center gap-3 px-5 text-center">
        <div className="rounded-full bg-success/10 p-3">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <p className="text-sm font-medium text-success">{t("onboarding.completeTitle")}</p>
        <CardTitle className="text-2xl font-bold leading-tight">
          {t("onboarding.completeWelcome", { name: completion.name })}
        </CardTitle>
        <CardDescription>{t("onboarding.completeDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <Link to={completion.redirectTo}>{t("onboarding.viewProfile")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/me/edit">{t("onboarding.moreSettings")}</Link>
          </Button>
        </div>
      </CardContent>
    </>
  );
}
