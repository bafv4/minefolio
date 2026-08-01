import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLoaderData, useFetcher, redirect, useParams, Link, type ShouldRevalidateFunctionArgs } from "react-router";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import type { Route } from "./+types/edit";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, socialLinks, profileVideos, authUsers, authSessions, authAccounts } from "@/lib/schema";
import { eq, and, asc } from "drizzle-orm";
import { getYouTubeVideoId, getYouTubeThumbnailUrl } from "@/lib/youtube-url";
import { isHttpUrl } from "@/lib/safe-url";
import { importFromLegacy } from "@/lib/legacy-import";
import { createId } from "@paralleldrive/cuid2";
import { fetchUuidFromMcid, MojangError } from "@/lib/mojang";
import { generateSlug } from "@/lib/slug";
import {
  isValidRtaStartedYearMonth,
  parseRtaStartedYearMonth,
  rtaCareerExactLabel,
  rtaCareerView,
  RTA_STARTED_MIN_YEAR,
} from "@/lib/rta-career";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { MinecraftFullBody } from "@/components/minecraft-fullbody";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Loader2,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Youtube,
  Twitch,
  Twitter,
  Share2,
  Video,
  Settings,
  AlertTriangle,
  Download,
  ImageIcon,
  Pin,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import { SkinUploader } from "@/components/skin-uploader";
import type { PoseName } from "@/components/minecraft-fullbody";
import { useT, useLocale } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meEdit.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  return false;
}

export async function loader({ request }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      socialLinks: {
        orderBy: [asc(socialLinks.displayOrder)],
      },
      profileVideos: {
        orderBy: [asc(profileVideos.displayOrder)],
      },
      keybindings: true,
      playerConfig: true,
      itemLayouts: true,
      searchCrafts: true,
      keyRemaps: true,
    },
  });

  if (!user) {
    throw new Response(t("meEdit.userNotFound"), { status: 404 });
  }

  // キー配置等のデータが存在するかチェック
  const hasExistingData =
    user.keybindings.length > 0 ||
    user.playerConfig !== null ||
    user.itemLayouts.length > 0 ||
    user.searchCrafts.length > 0 ||
    user.keyRemaps.length > 0;

  // レガシーAPIのURLのみ返す（チェックはクライアントサイドで行う）
  const legacyApiUrl = env.LEGACY_API_URL;

  return { user, links: user.socialLinks, videos: user.profileVideos, legacyApiUrl, hasExistingData };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  const t = useT();
  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          <div className="h-5 w-64 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-10 w-32 bg-muted rounded animate-pulse" />
      </div>

      {/* Avatar Card Skeleton */}
      <div className="border rounded-lg p-6 space-y-4">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 bg-muted rounded-full animate-pulse" />
          <div className="space-y-2">
            <div className="h-5 w-40 bg-muted rounded animate-pulse" />
            <div className="h-4 w-56 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Form Fields Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-6 space-y-4">
          <div className="h-6 w-24 bg-muted rounded animate-pulse" />
          <div className="space-y-3">
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
            <div className="h-24 w-full bg-muted rounded animate-pulse" />
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="border rounded-lg p-6 space-y-4">
          <div className="h-6 w-32 bg-muted rounded animate-pulse" />
          <div className="space-y-3">
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

export async function action({ request }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return { error: t("meEdit.userNotFound") };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  // レガシーインポート
  if (actionType === "import_legacy") {
    const legacyApiUrl = env.LEGACY_API_URL;
    if (!legacyApiUrl) {
      return { error: t("meEdit.legacyApiNotConfigured"), action: "import" };
    }

    if (!user.mcid) {
      return { error: t("meEdit.mcidNotSetForImport"), action: "import" };
    }

    const result = await importFromLegacy(t, db, user.id, legacyApiUrl, user.mcid);
    if (result.success) {
      return {
        success: true,
        action: "import",
        keybindingsImported: result.keybindingsImported,
        customKeysImported: result.customKeysImported,
        remapsImported: result.remapsImported,
        fingerAssignmentsImported: result.fingerAssignmentsImported,
        settingsImported: result.settingsImported,
      };
    } else {
      return { error: result.error ?? t("meEdit.importFailed"), action: "import" };
    }
  }

  // MCID設定/変更
  if (actionType === "set_mcid") {
    const mcid = (formData.get("mcid") as string)?.trim();

    if (!mcid) {
      return { error: t("meEdit.mcidRequired"), action: "mcid" };
    }

    if (mcid.length < 3 || mcid.length > 16) {
      return { error: t("meEdit.mcidLength"), action: "mcid" };
    }

    // 既に同じMCIDが登録されていないかチェック
    const existingUser = await db.query.users.findFirst({
      where: eq(users.mcid, mcid),
    });

    if (existingUser && existingUser.id !== user.id) {
      return { error: t("meEdit.mcidTaken"), action: "mcid" };
    }

    // Mojang APIで検証
    try {
      const uuid = await fetchUuidFromMcid(mcid);
      const newSlug = generateSlug(mcid, session.user.id);

      await db
        .update(users)
        .set({
          mcid,
          uuid,
          slug: newSlug,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return { success: true, action: "mcid", newSlug };
    } catch (error) {
      if (error instanceof MojangError) {
        if (error.code === "MCID_NOT_FOUND") {
          return { error: t("meEdit.mcidNotFound"), action: "mcid" };
        }
      }
      return { error: t("meEdit.mcidVerifyFailed"), action: "mcid" };
    }
  }

  // MCID削除
  if (actionType === "remove_mcid") {
    const newSlug = generateSlug(null, session.user.id);

    await db
      .update(users)
      .set({
        mcid: null,
        uuid: null,
        slug: newSlug,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { success: true, action: "mcid_removed", newSlug };
  }

  // ソーシャルリンクの操作
  if (actionType === "create_link" || actionType === "update_link") {
    const id = formData.get("id") as string | null;
    const platform = formData.get("platform") as "speedruncom" | "youtube" | "twitch" | "twitter" | "custom";
    const identifier = (formData.get("identifier") as string)?.trim();
    const customLabel = (formData.get("customLabel") as string)?.trim() || null;
    const customUrl = (formData.get("customUrl") as string)?.trim() || null;

    if (!platform || !identifier) {
      return { error: t("meEdit.platformAndIdRequired") };
    }

    // 長さチェック
    if (identifier.length > 100) {
      return { error: t("meEdit.idMaxLength") };
    }

    // IDの形式をバリデーション
    if (platform === "custom") {
      // カスタムSNSはラベルとURLが必須
      if (!customLabel) {
        return { error: t("meEdit.customLabelRequired") };
      }
      if (!customUrl) {
        return { error: t("meEdit.customUrlRequired") };
      }
      // URLの形式チェック
      try {
        new URL(customUrl);
      } catch {
        return { error: t("meEdit.customUrlInvalid") };
      }
      // javascript: / data: 等の実行可能スキームを拒否（stored XSS 対策。http/https のみ許可）
      if (!isHttpUrl(customUrl)) {
        return { error: t("meEdit.customUrlScheme") };
      }
    } else if (platform === "youtube") {
      // YouTubeハンドルは日本語などUnicode文字を許可
      // 空白、@、URL特殊文字は禁止
      if (/[\s@#$%^&*()+=\[\]{}|\\;:'",<>/?]/.test(identifier)) {
        return { error: t("meEdit.idInvalidChars") };
      }
    } else {
      // 英数字、ハイフン、アンダースコアのみ許可（@と.は除外）
      if (!/^[\w\-]+$/.test(identifier)) {
        return { error: t("meEdit.idAllowedChars") };
      }
    }

    try {
      if (actionType === "create_link") {
        // カスタム以外は同じプラットフォームの重複チェック
        if (platform !== "custom") {
          const existingPlatform = await db.query.socialLinks.findFirst({
            where: (links, { and, eq: eqOp }) => and(
              eqOp(links.userId, user.id),
              eqOp(links.platform, platform)
            ),
          });

          if (existingPlatform) {
            return { error: t("meEdit.platformLinkExistsForEdit", { platform }) };
          }
        }

        await db.insert(socialLinks).values({
          id: createId(),
          userId: user.id,
          platform,
          identifier,
          customLabel: platform === "custom" ? customLabel : null,
          customUrl: platform === "custom" ? customUrl : null,
        });

        // Speedrun.comの場合、speedruncomUsernameも自動設定
        if (platform === "speedruncom") {
          await db
            .update(users)
            .set({ speedruncomUsername: identifier, updatedAt: new Date() })
            .where(eq(users.id, user.id));
        }
      } else if (id) {
        // カスタム以外は更新時に別のプラットフォームに変更する場合、重複チェック
        if (platform !== "custom") {
          const existingPlatform = await db.query.socialLinks.findFirst({
            where: (links, { and, eq: eqOp, ne }) => and(
              eqOp(links.userId, user.id),
              eqOp(links.platform, platform),
              ne(links.id, id)
            ),
          });

          if (existingPlatform) {
            return { error: t("meEdit.platformLinkExistsSimple", { platform }) };
          }
        }

        // 更新前のリンク情報を取得（所有確認込み・IDOR 防止）
        const oldLink = await db.query.socialLinks.findFirst({
          where: and(eq(socialLinks.id, id), eq(socialLinks.userId, user.id)),
        });

        if (!oldLink) {
          return { error: t("meEdit.linkSaveFailed") };
        }

        await db
          .update(socialLinks)
          .set({
            platform,
            identifier,
            customLabel: platform === "custom" ? customLabel : null,
            customUrl: platform === "custom" ? customUrl : null,
            updatedAt: new Date(),
          })
          .where(and(eq(socialLinks.id, id), eq(socialLinks.userId, user.id)));

        // Speedrun.comの場合、speedruncomUsernameも自動更新
        if (platform === "speedruncom") {
          await db
            .update(users)
            .set({ speedruncomUsername: identifier, updatedAt: new Date() })
            .where(eq(users.id, user.id));
        } else if (oldLink?.platform === "speedruncom") {
          // Speedrun.comから別のプラットフォームに変更した場合、クリア
          await db
            .update(users)
            .set({ speedruncomUsername: null, updatedAt: new Date() })
            .where(eq(users.id, user.id));
        }
      }

      return { success: true, action: "link" };
    } catch (e) {
      console.error("Social link error:", e);
      if (e instanceof Error && e.message.includes("UNIQUE constraint")) {
        return { error: t("meEdit.platformLinkExists") };
      }
      return { error: t("meEdit.linkSaveFailed") };
    }
  }

  if (actionType === "delete_link") {
    const id = formData.get("id") as string;
    if (id) {
      // 削除前にリンク情報を取得（所有確認込み・IDOR 防止）
      const linkToDelete = await db.query.socialLinks.findFirst({
        where: and(eq(socialLinks.id, id), eq(socialLinks.userId, user.id)),
      });

      if (!linkToDelete) {
        return { success: true, action: "link" };
      }

      await db
        .delete(socialLinks)
        .where(and(eq(socialLinks.id, id), eq(socialLinks.userId, user.id)));

      // Speedrun.comリンクを削除した場合、speedruncomUsernameもクリア
      if (linkToDelete.platform === "speedruncom") {
        await db
          .update(users)
          .set({ speedruncomUsername: null, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      }
    }
    return { success: true, action: "link" };
  }

  // 動画欄の操作
  if (actionType === "create_video" || actionType === "update_video") {
    const id = formData.get("id") as string | null;
    const url = (formData.get("url") as string)?.trim();
    const title = (formData.get("title") as string)?.trim() || null;
    const isPinned = formData.get("isPinned") === "true";

    if (!url) {
      return { error: t("meEdit.videoUrlRequired") };
    }
    // 動画IDを解決できないURLは登録不可（埋め込み時の X-Frame-Options ブロック防止）
    if (!getYouTubeVideoId(url)) {
      return { error: t("meEdit.videoUrlInvalid") };
    }
    if (title && title.length > 100) {
      return { error: t("meEdit.videoTitleMaxLength") };
    }

    if (actionType === "create_video") {
      const existing = await db.query.profileVideos.findMany({
        where: eq(profileVideos.userId, user.id),
      });
      if (existing.length >= 10) {
        return { error: t("meEdit.videoMaxCount") };
      }
      const maxOrder = existing.reduce((max, v) => Math.max(max, v.displayOrder), 0);
      await db.insert(profileVideos).values({
        id: createId(),
        userId: user.id,
        url,
        title,
        isPinned,
        displayOrder: maxOrder + 1,
      });
    } else if (id) {
      await db
        .update(profileVideos)
        .set({ url, title, isPinned, updatedAt: new Date() })
        .where(and(eq(profileVideos.id, id), eq(profileVideos.userId, user.id)));
    }
    return { success: true, action: "video" };
  }

  if (actionType === "delete_video") {
    const id = formData.get("id") as string;
    if (id) {
      await db
        .delete(profileVideos)
        .where(and(eq(profileVideos.id, id), eq(profileVideos.userId, user.id)));
    }
    return { success: true, action: "video" };
  }

  if (actionType === "move_video") {
    const id = formData.get("id") as string;
    const direction = formData.get("direction") as string;
    const videos = await db.query.profileVideos.findMany({
      where: eq(profileVideos.userId, user.id),
      orderBy: [asc(profileVideos.displayOrder)],
    });
    const index = videos.findIndex((v) => v.id === id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index !== -1 && targetIndex >= 0 && targetIndex < videos.length) {
      const reordered = [...videos];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(targetIndex, 0, moved);
      // displayOrder の重複があっても正しく並ぶよう、インデックスで振り直す
      await Promise.all(
        reordered
          .map((video, i) => ({ video, i }))
          .filter(({ video, i }) => video.displayOrder !== i)
          .map(({ video, i }) =>
            db
              .update(profileVideos)
              .set({ displayOrder: i, updatedAt: new Date() })
              .where(and(eq(profileVideos.id, video.id), eq(profileVideos.userId, user.id)))
          )
      );
    }
    return { success: true, action: "video" };
  }

  // アカウント削除
  if (actionType === "delete_account") {
    const confirmText = (formData.get("confirmText") as string)?.trim();
    const expectedText = user.mcid || user.slug;

    if (confirmText !== expectedText) {
      return { error: t("meEdit.deleteConfirmMismatch"), action: "delete" };
    }

    // Delete user data (cascades to related tables)
    await db.delete(users).where(eq(users.id, user.id));

    // Delete auth data
    await db.delete(authSessions).where(eq(authSessions.userId, session.user.id));
    await db.delete(authAccounts).where(eq(authAccounts.userId, session.user.id));
    await db.delete(authUsers).where(eq(authUsers.id, session.user.id));

    // Redirect to home after deletion
    return redirect("/");
  }

  // プロフィール情報の更新
  const displayName = (formData.get("displayName") as string)?.trim() || null;
  const displayNameAlphabet = (formData.get("displayNameAlphabet") as string)?.trim() || null;
  const bio = (formData.get("bio") as string)?.trim() || null;
  const location = (formData.get("location") as string)?.trim() || null;
  const pronouns = (formData.get("pronouns") as string)?.trim() || null;
  const profileVisibility = formData.get("profileVisibility") as "public" | "unlisted" | "private";
  const profilePose = formData.get("profilePose") as "standing" | "walking" | "waving";
  const slimSkin = formData.get("slimSkin") === "true";
  const defaultProfileTab = formData.get("defaultProfileTab") as "profile" | "stats" | "playstyle" | "keybindings" | "devices" | "items" | "searchcraft";
  const mainPlatform = (formData.get("mainPlatform") as "pc_windows" | "pc_mac" | "pc_linux" | "switch" | "mobile" | "other") || null;
  const role = (formData.get("role") as "viewer" | "runner") || null;
  const shortBio = (formData.get("shortBio") as string)?.trim() || null;
  // RTA歴（"YYYY-MM"）。未回答は空文字で送られてくるので null に落とす
  const rtaStartedYearMonth = (formData.get("rtaStartedYearMonth") as string)?.trim() || null;
  const speedruncomUsername = (formData.get("speedruncomUsername") as string)?.trim() || null;
  const showPacemanOnHome = formData.get("showPacemanOnHome") === "true";
  const showTwitchOnHome = formData.get("showTwitchOnHome") === "true";
  const showYoutubeOnHome = formData.get("showYoutubeOnHome") === "true";
  const showRankedStats = formData.get("showRankedStats") === "true";
  const showPacemanStats = formData.get("showPacemanStats") === "true";

  // Validate
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

  if (speedruncomUsername && speedruncomUsername.length > 50) {
    return { error: t("meEdit.speedrunUsernameMax") };
  }

  if (rtaStartedYearMonth && !isValidRtaStartedYearMonth(rtaStartedYearMonth)) {
    return { error: t("meEdit.rtaStartedInvalid") };
  }

  await db
    .update(users)
    .set({
      displayName,
      displayNameAlphabet,
      bio,
      location,
      pronouns,
      profileVisibility,
      profilePose,
      slimSkin,
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
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return { success: true, action: "profile" };
}

// Radix Select は空文字を value にできないため、「未設定」項目用の番兵値を使う（状態上は "" に正規化する）
const RTA_STARTED_NONE = "none";

// 代名詞のプリセット選択肢（値=表示。ロケール非依存の英語表記のため翻訳キーは持たない）。
// Combobox の allowCustomValue により任意の自由記述も入力できる
const pronounOptions = [
  { value: "he/him", label: "he/him" },
  { value: "she/her", label: "she/her" },
  { value: "they/them", label: "they/them" },
  { value: "he/they", label: "he/they" },
  { value: "she/they", label: "she/they" },
  { value: "any/all", label: "any/all" },
];

const platformOptions = [
  { value: "speedruncom", label: "Speedrun.com", placeholder: "e.g. couriern3w", prefix: "speedrun.com/users/" },
  { value: "youtube", label: "YouTube", placeholder: "e.g. @couriern3w", prefix: "youtube.com/" },
  { value: "twitch", label: "Twitch", placeholder: "e.g. couriern3w", prefix: "twitch.tv/" },
  { value: "twitter", label: "Twitter/X", placeholder: "e.g. couriern3w", prefix: "x.com/" },
  { value: "custom", label: null, labelKey: "meEdit.customSns" as const, placeholder: "e.g. username", prefix: "" },
] as const;

function getPlatformIcon(platform: string) {
  switch (platform) {
    case "youtube":
      return <Youtube className="h-4 w-4" />;
    case "twitch":
      return <Twitch className="h-4 w-4" />;
    case "twitter":
      return <Twitter className="h-4 w-4" />;
    case "speedruncom":
      return <ExternalLink className="h-4 w-4" />;
    case "custom":
      return <Share2 className="h-4 w-4" />;
    default:
      return <ExternalLink className="h-4 w-4" />;
  }
}

function getPlatformUrl(platform: string, identifier: string, customUrlValue?: string | null): string {
  switch (platform) {
    case "speedruncom":
      return `https://www.speedrun.com/users/${identifier}`;
    case "youtube":
      // YouTubeハンドルには@が必要
      return `https://www.youtube.com/@${identifier}`;
    case "twitch":
      return `https://www.twitch.tv/${identifier}`;
    case "twitter":
      return `https://x.com/${identifier}`;
    case "custom":
      return customUrlValue || "#";
    default:
      return "#";
  }
}

// ソーシャルリンク編集ダイアログ
function SocialLinkDialog({
  editingLink,
  linkFetcher,
  isSubmitting,
}: {
  editingLink: { id: string; platform: string; identifier: string; customLabel: string | null; customUrl: string | null } | null;
  linkFetcher: ReturnType<typeof useFetcher<typeof action>>;
  isSubmitting: boolean;
}) {
  const t = useT();
  const [selectedPlatform, setSelectedPlatform] = useState(editingLink?.platform ?? "youtube");

  const currentOption = platformOptions.find((opt) => opt.value === selectedPlatform);
  const isCustom = selectedPlatform === "custom";

  return (
    <linkFetcher.Form method="post">
      <input type="hidden" name="_action" value={editingLink ? "update_link" : "create_link"} />
      {editingLink && <input type="hidden" name="id" value={editingLink.id} />}
      <DialogHeader>
        <DialogTitle>{editingLink ? t("meEdit.socialDialogEditTitle") : t("meEdit.socialDialogAddTitle")}</DialogTitle>
        <DialogDescription>
          {editingLink ? t("meEdit.socialDialogEditDesc") : t("meEdit.socialDialogAddDesc")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="platform">{t("meEdit.platform")}</Label>
          <Select
            name="platform"
            value={selectedPlatform}
            onValueChange={setSelectedPlatform}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {platformOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isCustom && (
          <>
            <div className="space-y-2">
              <Label htmlFor="custom-label">{t("meEdit.customLabelField")}</Label>
              <Input
                id="custom-label"
                name="customLabel"
                defaultValue={editingLink?.customLabel ?? ""}
                placeholder={t("meEdit.customLabelPlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-url">{t("meEdit.customUrlField")}</Label>
              <Input
                id="custom-url"
                name="customUrl"
                defaultValue={editingLink?.customUrl ?? ""}
                placeholder={t("meEdit.customUrlPlaceholder")}
                required
              />
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label htmlFor="link-identifier">{isCustom ? t("meEdit.userId") : t("meEdit.userId")}</Label>
          <div className="flex items-center">
            {!isCustom && (
              <span className="text-sm text-muted-foreground mr-2 shrink-0">
                {currentOption?.prefix}
              </span>
            )}
            <Input
              id="link-identifier"
              name="identifier"
              defaultValue={editingLink?.identifier ?? ""}
              placeholder={currentOption?.placeholder}
              required
              className="flex-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {isCustom ? t("meEdit.customIdentifierHint") : t("meEdit.socialIdHint")}
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {editingLink ? t("meEdit.updateLink") : t("meEdit.addLink")}
        </Button>
      </DialogFooter>
    </linkFetcher.Form>
  );
}

function VideoDialog({
  editingVideo,
  videoFetcher,
  isSubmitting,
  defaultUrl,
}: {
  editingVideo: { id: string; url: string; title: string | null; isPinned: boolean } | null;
  videoFetcher: ReturnType<typeof useFetcher<typeof action>>;
  isSubmitting: boolean;
  defaultUrl?: string;
}) {
  const t = useT();
  return (
    <videoFetcher.Form method="post">
      <input type="hidden" name="_action" value={editingVideo ? "update_video" : "create_video"} />
      {editingVideo && <input type="hidden" name="id" value={editingVideo.id} />}
      <DialogHeader>
        <DialogTitle>
          {editingVideo ? t("meEdit.videoDialogEditTitle") : t("meEdit.videoDialogAddTitle")}
        </DialogTitle>
        <DialogDescription>{t("meEdit.videoDialogDesc")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="video-url">YouTube URL</Label>
          <Input
            id="video-url"
            name="url"
            type="url"
            defaultValue={editingVideo?.url ?? defaultUrl ?? ""}
            placeholder="https://www.youtube.com/watch?v=..."
            required
          />
          <p className="text-xs text-muted-foreground">{t("meEdit.videoUrlHint")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="video-title">{t("meEdit.videoTitleField")}</Label>
          <Input
            id="video-title"
            name="title"
            defaultValue={editingVideo?.title ?? ""}
            placeholder={t("meEdit.videoTitlePlaceholder")}
            maxLength={100}
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Switch
              id="video-pinned"
              name="isPinned"
              value="true"
              defaultChecked={editingVideo?.isPinned ?? false}
            />
            <Label htmlFor="video-pinned">{t("meEdit.videoPinned")}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t("meEdit.videoPinnedHint")}</p>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {editingVideo ? t("meEdit.videoUpdate") : t("meEdit.videoAdd")}
        </Button>
      </DialogFooter>
    </videoFetcher.Form>
  );
}

export default function EditProfilePage() {
  const t = useT();
  const locale = useLocale();
  const { user, links, videos, legacyApiUrl, hasExistingData } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const linkFetcher = useFetcher<typeof action>();
  const videoFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();
  const mcidFetcher = useFetcher<typeof action>();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isVideoDialogOpen, setIsVideoDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isMcidDialogOpen, setIsMcidDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<typeof links[0] | null>(null);
  const [editingVideo, setEditingVideo] = useState<typeof videos[0] | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [newMcid, setNewMcid] = useState("");
  const [selectedPose, setSelectedPose] = useState<PoseName>(
    (user.profilePose as PoseName) ?? "waving"
  );
  const [importCompleted, setImportCompleted] = useState(false);

  // RTA歴（"YYYY-MM"）を年・月のセレクト値に分解する。未回答・不正値は両方 ""（未選択）
  const initialRtaStarted = parseRtaStartedYearMonth(user.rtaStartedYearMonth ?? "");
  const initialRtaStartedYear = initialRtaStarted ? String(initialRtaStarted.year) : "";
  const initialRtaStartedMonth = initialRtaStarted ? String(initialRtaStarted.month) : "";

  // 現在年月。未来の年月は保存できない（サーバー側でも弾く）ので、選択肢自体を出さない
  const { currentYear, currentMonth } = useMemo(() => {
    const today = new Date();
    return { currentYear: today.getFullYear(), currentMonth: today.getMonth() + 1 };
  }, []);

  // 開始年の選択肢（現在年 → 2009 の降順）
  const rtaStartedYearOptions = useMemo(
    () =>
      Array.from(
        { length: currentYear - RTA_STARTED_MIN_YEAR + 1 },
        (_, i) => currentYear - i,
      ),
    [currentYear],
  );

  // フォームの値をトラッキングして変更を検出
  const [formValues, setFormValues] = useState({
    displayName: user.displayName ?? "",
    displayNameAlphabet: user.displayNameAlphabet ?? "",
    bio: user.bio ?? "",
    location: user.location ?? "",
    pronouns: user.pronouns ?? "",
    profileVisibility: user.profileVisibility ?? "public",
    profilePose: (user.profilePose as PoseName) ?? "waving",
    slimSkin: user.slimSkin ?? false,
    defaultProfileTab: user.defaultProfileTab ?? "profile",
    mainPlatform: user.mainPlatform ?? "",
    role: user.role ?? "",
    shortBio: user.shortBio ?? "",
    rtaStartedYear: initialRtaStartedYear,
    rtaStartedMonth: initialRtaStartedMonth,
    speedruncomUsername: user.speedruncomUsername ?? "",
    showPacemanOnHome: user.showPacemanOnHome ?? true,
    showTwitchOnHome: user.showTwitchOnHome ?? true,
    showYoutubeOnHome: user.showYoutubeOnHome ?? true,
    showRankedStats: user.showRankedStats ?? true,
    showPacemanStats: user.showPacemanStats ?? true,
  });

  const initialFormValues = useRef({
    displayName: user.displayName ?? "",
    displayNameAlphabet: user.displayNameAlphabet ?? "",
    bio: user.bio ?? "",
    location: user.location ?? "",
    pronouns: user.pronouns ?? "",
    profileVisibility: user.profileVisibility ?? "public",
    profilePose: (user.profilePose as PoseName) ?? "waving",
    slimSkin: user.slimSkin ?? false,
    defaultProfileTab: user.defaultProfileTab ?? "profile",
    mainPlatform: user.mainPlatform ?? "",
    role: user.role ?? "",
    shortBio: user.shortBio ?? "",
    rtaStartedYear: initialRtaStartedYear,
    rtaStartedMonth: initialRtaStartedMonth,
    speedruncomUsername: user.speedruncomUsername ?? "",
    showPacemanOnHome: user.showPacemanOnHome ?? true,
    showTwitchOnHome: user.showTwitchOnHome ?? true,
    showYoutubeOnHome: user.showYoutubeOnHome ?? true,
    showRankedStats: user.showRankedStats ?? true,
    showPacemanStats: user.showPacemanStats ?? true,
  });

  // selectedPoseをformValuesに同期
  useEffect(() => {
    setFormValues((prev) => ({
      ...prev,
      profilePose: selectedPose,
    }));
  }, [selectedPose]);

  // 変更チェック
  const hasChanges = JSON.stringify(formValues) !== JSON.stringify(initialFormValues.current);

  // 入力変更ハンドラ
  const handleInputChange = useCallback((field: keyof typeof formValues, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  // 開始月の選択肢。現在年を選んでいる間は未来の月を出さない
  const rtaStartedMonthOptions = useMemo(() => {
    const lastMonth =
      formValues.rtaStartedYear === String(currentYear) ? currentMonth : 12;
    return Array.from({ length: lastMonth }, (_, i) => i + 1);
  }, [formValues.rtaStartedYear, currentYear, currentMonth]);

  // 年・月は「両方設定」か「両方未設定」のみ有効なので、
  // どちらかで「未設定」を選んだらもう片方も同時にクリアする
  const clearRtaStarted = useCallback(() => {
    setFormValues((prev) => ({ ...prev, rtaStartedYear: "", rtaStartedMonth: "" }));
  }, []);

  const handleRtaStartedYearChange = useCallback(
    (value: string) => {
      if (value === RTA_STARTED_NONE) {
        clearRtaStarted();
        return;
      }
      setFormValues((prev) => ({
        ...prev,
        rtaStartedYear: value,
        // 現在年に変えた結果、選択済みの月が未来になるならその月は選べない
        rtaStartedMonth:
          value === String(currentYear) && Number(prev.rtaStartedMonth) > currentMonth
            ? ""
            : prev.rtaStartedMonth,
      }));
    },
    [clearRtaStarted, currentYear, currentMonth],
  );

  const handleRtaStartedMonthChange = useCallback(
    (value: string) => {
      if (value === RTA_STARTED_NONE) {
        clearRtaStarted();
        return;
      }
      setFormValues((prev) => ({ ...prev, rtaStartedMonth: value }));
    },
    [clearRtaStarted],
  );

  // 片方だけ選択されている状態（保存できない）。セレクト直下にその場で出す
  const isRtaStartedIncomplete =
    Boolean(formValues.rtaStartedYear) !== Boolean(formValues.rtaStartedMonth);

  // 両方選択済みなら、プロフィールに出る文言をそのままプレビューする
  const { rtaStartedYear, rtaStartedMonth } = formValues;
  const rtaCareerPreview = useMemo(() => {
    if (!rtaStartedYear || !rtaStartedMonth) return null;
    const view = rtaCareerView(
      `${rtaStartedYear}-${rtaStartedMonth.padStart(2, "0")}`,
      locale,
    );
    return view ? rtaCareerExactLabel(t, view) : null;
  }, [rtaStartedYear, rtaStartedMonth, locale, t]);

  // フォームリセット
  const handleReset = useCallback(() => {
    setFormValues(initialFormValues.current);
    setSelectedPose((initialFormValues.current.profilePose as PoseName) ?? "waving");
  }, []);

  // 保存処理
  const handleSave = useCallback(() => {
    const { rtaStartedYear, rtaStartedMonth } = formValues;
    // RTA歴は年・月の両方を選ぶか、両方未選択（未回答）のみ有効
    if (isRtaStartedIncomplete) {
      toast.error(t("meEdit.rtaStartedBothOrNone"));
      return;
    }

    const formData = new FormData();
    formData.set("displayName", formValues.displayName);
    formData.set("displayNameAlphabet", formValues.displayNameAlphabet);
    formData.set("bio", formValues.bio);
    formData.set("location", formValues.location);
    formData.set("pronouns", formValues.pronouns);
    formData.set("profileVisibility", formValues.profileVisibility);
    formData.set("profilePose", formValues.profilePose);
    formData.set("slimSkin", String(formValues.slimSkin));
    formData.set("defaultProfileTab", formValues.defaultProfileTab);
    formData.set("mainPlatform", formValues.mainPlatform);
    formData.set("role", formValues.role);
    formData.set("shortBio", formValues.shortBio);
    formData.set(
      "rtaStartedYearMonth",
      rtaStartedYear && rtaStartedMonth
        ? `${rtaStartedYear}-${rtaStartedMonth.padStart(2, "0")}`
        : "",
    );
    formData.set("speedruncomUsername", formValues.speedruncomUsername);
    formData.set("showPacemanOnHome", String(formValues.showPacemanOnHome));
    formData.set("showTwitchOnHome", String(formValues.showTwitchOnHome));
    formData.set("showYoutubeOnHome", String(formValues.showYoutubeOnHome));
    formData.set("showRankedStats", String(formValues.showRankedStats));
    formData.set("showPacemanStats", String(formValues.showPacemanStats));
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, formValues, isRtaStartedIncomplete, t]);

  // ポーズ変更を同期
  useEffect(() => {
    setFormValues((prev) => ({ ...prev, profilePose: selectedPose }));
  }, [selectedPose]);

  const isSubmitting = fetcher.state === "submitting";
  const isLinkSubmitting = linkFetcher.state === "submitting";
  const isVideoSubmitting = videoFetcher.state === "submitting";
  const isDeleting = deleteFetcher.state === "submitting";
  const isImporting = importFetcher.state === "submitting";
  const isMcidSubmitting = mcidFetcher.state === "submitting";
  const data = fetcher.data;
  const linkData = linkFetcher.data;
  const videoData = videoFetcher.data;
  const deleteData = deleteFetcher.data;
  const importData = importFetcher.data;
  const mcidData = mcidFetcher.data;

  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const prevLinkDataRef = useRef<typeof linkFetcher.data>(undefined);
  const prevVideoDataRef = useRef<typeof videoFetcher.data>(undefined);
  const prevImportDataRef = useRef<typeof importFetcher.data>(undefined);
  const prevMcidDataRef = useRef<typeof mcidFetcher.data>(undefined);

  // 保存成功後に初期値を更新
  useEffect(() => {
    if (data && "success" in data && data.action === "profile") {
      initialFormValues.current = { ...formValues };
    }
  }, [data, formValues]);

  // プロフィール更新のトースト
  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.action === "profile") {
      toast.success(t("meEdit.profileUpdated"));
    } else if ("error" in data && !("action" in data)) {
      toast.error(data.error);
    }
  }, [data]);

  // ソーシャルリンク更新のトースト
  useEffect(() => {
    if (!linkData || linkData === prevLinkDataRef.current) return;
    prevLinkDataRef.current = linkData;

    if ("success" in linkData && linkData.action === "link") {
      toast.success(t("meEdit.socialUpdated"));
      setIsDialogOpen(false);
    } else if ("error" in linkData) {
      toast.error(linkData.error);
    }
  }, [linkData]);

  // 動画更新のトースト
  useEffect(() => {
    if (!videoData || videoData === prevVideoDataRef.current) return;
    prevVideoDataRef.current = videoData;

    if ("success" in videoData && videoData.action === "video") {
      toast.success(t("meEdit.videosUpdated"));
      setIsVideoDialogOpen(false);
    } else if ("error" in videoData) {
      toast.error(videoData.error);
    }
  }, [videoData]);

  // インポート結果のトースト
  useEffect(() => {
    if (!importData || importData === prevImportDataRef.current) return;
    prevImportDataRef.current = importData;

    if ("success" in importData && importData.action === "import") {
      const parts: string[] = [];
      if ("keybindingsImported" in importData && (importData.keybindingsImported ?? 0) > 0) {
        parts.push(t("meEdit.importedKeybindingsCount", { count: importData.keybindingsImported ?? 0 }));
      }
      if ("customKeysImported" in importData && (importData.customKeysImported ?? 0) > 0) {
        parts.push(t("meEdit.importedCustomKeysCount", { count: importData.customKeysImported ?? 0 }));
      }
      if ("remapsImported" in importData && (importData.remapsImported ?? 0) > 0) {
        parts.push(t("meEdit.importedRemapsCount", { count: importData.remapsImported ?? 0 }));
      }
      if ("fingerAssignmentsImported" in importData && importData.fingerAssignmentsImported) {
        parts.push(t("meEdit.importedFingerAssignments"));
      }
      if ("settingsImported" in importData && importData.settingsImported) {
        parts.push(t("meEdit.importedSettings"));
      }
      if (parts.length > 0) {
        toast.success(t("meEdit.importCompletedWithDetail", { detail: parts.join(t("common.listSeparatorComma")) }));
      } else {
        toast.success(t("meEdit.importCompletedNoData"));
      }
      setImportCompleted(true);
    } else if ("error" in importData && importData.action === "import") {
      toast.error(importData.error);
    }
  }, [importData]);

  // MCID変更結果のトースト
  useEffect(() => {
    if (!mcidData || mcidData === prevMcidDataRef.current) return;
    prevMcidDataRef.current = mcidData;

    if ("success" in mcidData && mcidData.action === "mcid") {
      toast.success(t("meEdit.mcidChanged"));
      setIsMcidDialogOpen(false);
      // ページをリロードして新しいデータを反映
      window.location.reload();
    } else if ("success" in mcidData && mcidData.action === "mcid_removed") {
      toast.success(t("meEdit.mcidRemoved"));
      window.location.reload();
    }
  }, [mcidData]);

  const handleOpenCreate = () => {
    setEditingLink(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (link: typeof links[0]) => {
    setEditingLink(link);
    setIsDialogOpen(true);
  };

  const handleOpenVideoCreate = () => {
    setEditingVideo(null);
    setIsVideoDialogOpen(true);
  };

  const handleOpenVideoEdit = (video: typeof videos[0]) => {
    setEditingVideo(video);
    setIsVideoDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("meEdit.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("meEdit.pageDescription")}
        </p>
      </div>

      {/* Legacy Import Card */}
      {legacyApiUrl && !importCompleted && !hasExistingData && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5" />
              {t("meEdit.importFromLegacyTitle")}
            </CardTitle>
            <CardDescription>
              {t("meEdit.importFromLegacyDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <importFetcher.Form method="post">
              <input type="hidden" name="_action" value="import_legacy" />
              <Button type="submit" disabled={isImporting}>
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("meEdit.importing")}
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    {t("meEdit.importData")}
                  </>
                )}
              </Button>
            </importFetcher.Form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {/* MCID & Skin Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t("meEdit.mcidSkinTitle")}</CardTitle>
            <CardDescription>
              {t("meEdit.mcidSkinDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* MCID設定 */}
            <div className="space-y-3">
              <Label>{t("meEdit.minecraftIdTitle")}</Label>
              {user.mcid ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden">
                      <MinecraftAvatar uuid={user.uuid} skinUrl={user.customSkinUrl} size={64} />
                    </div>
                    <div>
                      <p className="font-medium">@{user.mcid}</p>
                      <p className="text-xs text-muted-foreground">
                        UUID: {user.uuid}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Dialog open={isMcidDialogOpen} onOpenChange={(open) => {
                      setIsMcidDialogOpen(open);
                      if (!open) setNewMcid("");
                    }}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Pencil className="mr-2 h-4 w-4" />
                          {t("meEdit.change")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("meEdit.changeMcidTitle")}</DialogTitle>
                          <DialogDescription>
                            {t("meEdit.changeMcidDesc")}
                          </DialogDescription>
                        </DialogHeader>
                        <mcidFetcher.Form method="post">
                          <input type="hidden" name="_action" value="set_mcid" />
                          <div className="space-y-4 py-4">
                            <Alert>
                              <AlertCircle className="h-4 w-4" />
                              <AlertDescription>
                                {t("meEdit.mcidUrlChangeWarning")}
                              </AlertDescription>
                            </Alert>
                            <div className="space-y-2">
                              <Label htmlFor="new-mcid">{t("meEdit.newMcid")}</Label>
                              <Input
                                id="new-mcid"
                                name="mcid"
                                value={newMcid}
                                onChange={(e) => setNewMcid(e.target.value)}
                                placeholder={t("meEdit.mcidExample")}
                                minLength={3}
                                maxLength={16}
                              />
                            </div>
                            {mcidData && "error" in mcidData && mcidData.action === "mcid" && (
                              <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>{mcidData.error}</AlertDescription>
                              </Alert>
                            )}
                          </div>
                          <DialogFooter>
                            <Button type="submit" disabled={isMcidSubmitting || !newMcid}>
                              {isMcidSubmitting ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : null}
                              {t("meEdit.applyMcidChange")}
                            </Button>
                          </DialogFooter>
                        </mcidFetcher.Form>
                      </DialogContent>
                    </Dialog>
                    <mcidFetcher.Form method="post">
                      <input type="hidden" name="_action" value="remove_mcid" />
                      <Button variant="ghost" size="sm" type="submit" disabled={isMcidSubmitting}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t("meEdit.delete")}
                      </Button>
                    </mcidFetcher.Form>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                  <p className="text-sm text-muted-foreground">{t("meEdit.mcidNotConfigured")}</p>
                  <Dialog open={isMcidDialogOpen} onOpenChange={(open) => {
                    setIsMcidDialogOpen(open);
                    if (!open) setNewMcid("");
                  }}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="mr-2 h-4 w-4" />
                        {t("meEdit.setMcid")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("meEdit.setMcidTitle")}</DialogTitle>
                        <DialogDescription>
                          {t("meEdit.setMcidDesc")}
                        </DialogDescription>
                      </DialogHeader>
                      <mcidFetcher.Form method="post">
                        <input type="hidden" name="_action" value="set_mcid" />
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="new-mcid">{t("meEdit.minecraftIdTitle")}</Label>
                            <Input
                              id="new-mcid"
                              name="mcid"
                              value={newMcid}
                              onChange={(e) => setNewMcid(e.target.value)}
                              placeholder={t("meEdit.mcidExample")}
                              minLength={3}
                              maxLength={16}
                            />
                          </div>
                          {mcidData && "error" in mcidData && mcidData.action === "mcid" && (
                            <Alert variant="destructive">
                              <AlertCircle className="h-4 w-4" />
                              <AlertDescription>{mcidData.error}</AlertDescription>
                            </Alert>
                          )}
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={isMcidSubmitting || !newMcid}>
                            {isMcidSubmitting ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            {t("meEdit.setMcid")}
                          </Button>
                        </DialogFooter>
                      </mcidFetcher.Form>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </div>

            <Separator />

            {/* Custom Skin Upload */}
            <div className="space-y-3">
              <Label>{t("skinUploader.customSkinTitle")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("skinUploader.customSkinDesc")}
              </p>
              {user.customSkinUrl && (
                <Alert className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t("skinUploader.customSkinActive")}
                  </AlertDescription>
                </Alert>
              )}
              <SkinUploader
                userId={user.id}
                currentSkinUrl={user.customSkinUrl}
                onUploadComplete={() => {
                  window.location.reload();
                }}
                onDelete={() => {
                  window.location.reload();
                }}
              />
            </div>

            {/* Pose Selection - show when user has uuid OR custom skin */}
            {(user.uuid || user.customSkinUrl) && (
              <>
                <Separator />

                <div className="space-y-3">
                  <Label>{t("meEdit.poseLabel")}</Label>
                  <div className="grid grid-cols-3 gap-3">
                    {(["standing", "walking", "waving"] as const).map((pose) => (
                      <button
                        key={pose}
                        type="button"
                        onClick={() => setSelectedPose(pose)}
                        className={`relative flex flex-col items-center gap-2 p-2 rounded-lg border-2 transition-colors ${selectedPose === pose
                            ? "border-primary bg-primary/5"
                            : "border-muted hover:border-muted-foreground/30"
                          }`}
                      >
                        <div className="w-16 h-24">
                          <MinecraftFullBody
                            uuid={user.uuid ?? undefined}
                            skinUrl={user.customSkinUrl ?? undefined}
                            width={64}
                            height={96}
                            pose={pose}
                            angle={-35}
                            elevation={5}
                            zoom={0.9}
                            slim={formValues.slimSkin}
                            asImage
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {pose === "standing" && t("meEdit.poseStanding")}
                          {pose === "walking" && t("meEdit.poseWalking")}
                          {pose === "waving" && t("meEdit.poseWaving")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Skin Model Toggle - 常に表示 */}
            <div className="space-y-2">
              <Label>{t("meEdit.skinModelLabel")}</Label>
              <div className="flex rounded-lg border p-1 w-fit">
                <button
                  type="button"
                  onClick={() => setFormValues((prev) => ({ ...prev, slimSkin: false }))}
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${!formValues.slimSkin
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                    }`}
                >
                  {t("meEdit.skinModelDefault")}
                </button>
                <button
                  type="button"
                  onClick={() => setFormValues((prev) => ({ ...prev, slimSkin: true }))}
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${formValues.slimSkin
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                    }`}
                >
                  {t("meEdit.skinModelSlim")}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t("meEdit.basicInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">{t("meEdit.displayName")}</Label>
              <Input
                id="displayName"
                value={formValues.displayName}
                onChange={(e) => handleInputChange("displayName", e.target.value)}
                placeholder={user.mcid || user.slug}
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                {t("meEdit.fallbackToMcidOrSlug", { value: user.mcid ? "MCID" : "slug" })}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayNameAlphabet">{t("meEdit.displayNameAlphabet")}</Label>
              <Input
                id="displayNameAlphabet"
                value={formValues.displayNameAlphabet}
                onChange={(e) => handleInputChange("displayNameAlphabet", e.target.value)}
                placeholder={t("meEdit.displayNameAlphabetPlaceholder")}
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                {t("meEdit.displayNameAlphabetHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">{t("meEdit.bio")}</Label>
              <Textarea
                id="bio"
                value={formValues.bio}
                onChange={(e) => handleInputChange("bio", e.target.value)}
                placeholder={t("meEdit.bioPlaceholder")}
                maxLength={500}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location">{t("meEdit.location")}</Label>
                <Input
                  id="location"
                  value={formValues.location}
                  onChange={(e) => handleInputChange("location", e.target.value)}
                  placeholder={t("meEdit.locationExample")}
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pronouns">{t("meEdit.pronouns")}</Label>
                <Combobox
                  options={pronounOptions}
                  value={formValues.pronouns}
                  onValueChange={(value) => handleInputChange("pronouns", value.slice(0, 20))}
                  placeholder={t("meEdit.pronounsExample")}
                  allowCustomValue={true}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shortBio">{t("meEdit.shortBio")}</Label>
              <Input
                id="shortBio"
                value={formValues.shortBio}
                onChange={(e) => handleInputChange("shortBio", e.target.value)}
                placeholder={t("meEdit.shortBioExample")}
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                {t("meEdit.shortBioHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rtaStartedYear">{t("meEdit.rtaStarted")}</Label>
              <div className="flex items-center gap-2 sm:max-w-sm">
                <div className="grid flex-1 grid-cols-2 gap-2">
                  <Select
                    value={formValues.rtaStartedYear}
                    onValueChange={handleRtaStartedYearChange}
                  >
                    {/* Label は年セレクトに紐付くが、月と区別できるよう年側も明示する */}
                    <SelectTrigger
                      id="rtaStartedYear"
                      className="w-full"
                      aria-label={t("meEdit.rtaStartedYearAria")}
                      aria-invalid={isRtaStartedIncomplete && !formValues.rtaStartedYear}
                    >
                      <SelectValue placeholder={t("meEdit.rtaStartedYearPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={RTA_STARTED_NONE}>{t("meEdit.rtaStartedNone")}</SelectItem>
                      {rtaStartedYearOptions.map((year) => (
                        <SelectItem key={year} value={String(year)}>
                          {t("meEdit.rtaStartedYearOption", { year })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={formValues.rtaStartedMonth}
                    onValueChange={handleRtaStartedMonthChange}
                  >
                    <SelectTrigger
                      id="rtaStartedMonth"
                      className="w-full"
                      aria-label={t("meEdit.rtaStartedMonthAria")}
                      aria-invalid={isRtaStartedIncomplete && !formValues.rtaStartedMonth}
                    >
                      <SelectValue placeholder={t("meEdit.rtaStartedMonthPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={RTA_STARTED_NONE}>{t("meEdit.rtaStartedNone")}</SelectItem>
                      {rtaStartedMonthOptions.map((month) => (
                        <SelectItem key={month} value={String(month)}>
                          {t("meEdit.rtaStartedMonthOption", { month })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(formValues.rtaStartedYear || formValues.rtaStartedMonth) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground"
                    aria-label={t("meEdit.rtaStartedClear")}
                    onClick={clearRtaStarted}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {isRtaStartedIncomplete ? (
                <p className="text-xs text-destructive">
                  {t("meEdit.rtaStartedBothOrNone")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {rtaCareerPreview ?? t("meEdit.rtaStartedHint")}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mainPlatform">{t("meEdit.mainPlatform")}</Label>
                <Select
                  value={formValues.mainPlatform}
                  onValueChange={(value) => handleInputChange("mainPlatform", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("meEdit.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pc_windows">{t("playerProfile.platformPcWindows")}</SelectItem>
                    <SelectItem value="pc_mac">{t("playerProfile.platformPcMac")}</SelectItem>
                    <SelectItem value="pc_linux">{t("playerProfile.platformPcLinux")}</SelectItem>
                    <SelectItem value="switch">Switch</SelectItem>
                    <SelectItem value="mobile">{t("meEdit.mobile")}</SelectItem>
                    <SelectItem value="other">{t("meEdit.other")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">{t("meEdit.role")}</Label>
                <Select
                  value={formValues.role}
                  onValueChange={(value) => handleInputChange("role", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("meEdit.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="runner">{t("meEdit.roleRunner")}</SelectItem>
                    <SelectItem value="viewer">{t("meEdit.roleViewer")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              <Link to="/me/playstyle" className="underline underline-offset-2">
                {t("meEdit.movedToPlaystyle")}
              </Link>
            </p>
          </CardContent>
        </Card>

        {/* Speedrun.com連携 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ExternalLink className="h-5 w-5" />
              {t("meEdit.speedrunIntegration")}
            </CardTitle>
            <CardDescription>
              {t("meEdit.speedrunIntegrationDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="speedruncomUsername">{t("meEdit.speedrunUsername")}</Label>
              <div className="flex items-center">
                <span className="text-sm text-muted-foreground mr-2 shrink-0">
                  speedrun.com/users/
                </span>
                <Input
                  id="speedruncomUsername"
                  value={formValues.speedruncomUsername}
                  onChange={(e) => handleInputChange("speedruncomUsername", e.target.value)}
                  placeholder={t("meEdit.speedrunUsernameExample")}
                  maxLength={50}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("meEdit.speedrunUsernameHint")}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Videos（複数動画欄。旧「おすすめ動画」featuredVideoUrl の後継） */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Video className="h-5 w-5" />
                  {t("meEdit.videos")}
                </CardTitle>
                <CardDescription>
                  {t("meEdit.videosDesc")}
                </CardDescription>
              </div>
              <Dialog open={isVideoDialogOpen} onOpenChange={setIsVideoDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" onClick={handleOpenVideoCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("meEdit.add")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <VideoDialog
                    // 開くたびに再マウントし、非制御入力（defaultValue/defaultChecked）の
                    // 前回状態が持ち越されないようにする
                    key={`${isVideoDialogOpen}-${editingVideo?.id ?? "new"}`}
                    editingVideo={editingVideo}
                    videoFetcher={videoFetcher}
                    isSubmitting={isVideoSubmitting}
                    // 旧「おすすめ動画」からの移行を助けるため、初回追加時はレガシーURLをプリフィル
                    defaultUrl={videos.length === 0 ? user.featuredVideoUrl ?? "" : ""}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {videos.length > 0 ? (
              <div className="space-y-2">
                {videos.map((video, index) => {
                  const thumbnail = getYouTubeThumbnailUrl(video.url);
                  return (
                    <div key={video.id} className="flex items-center gap-3 p-3 border rounded-lg">
                      {thumbnail ? (
                        <img
                          src={thumbnail}
                          alt=""
                          className="w-24 h-14 object-cover rounded-md shrink-0"
                        />
                      ) : (
                        <div className="w-24 h-14 bg-muted rounded-md shrink-0 flex items-center justify-center">
                          <Video className="h-5 w-5 text-muted-foreground/50" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {video.isPinned && <Pin className="h-3.5 w-3.5 text-primary shrink-0" />}
                          <p className="font-medium text-sm truncate">
                            {video.title || t("meEdit.videoNoTitle")}
                          </p>
                        </div>
                        <a
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:underline truncate block"
                        >
                          {video.url}
                        </a>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <videoFetcher.Form method="post">
                          <input type="hidden" name="_action" value="move_video" />
                          <input type="hidden" name="id" value={video.id} />
                          <input type="hidden" name="direction" value="up" />
                          <Button variant="ghost" size="icon" type="submit" disabled={index === 0}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                        </videoFetcher.Form>
                        <videoFetcher.Form method="post">
                          <input type="hidden" name="_action" value="move_video" />
                          <input type="hidden" name="id" value={video.id} />
                          <input type="hidden" name="direction" value="down" />
                          <Button
                            variant="ghost"
                            size="icon"
                            type="submit"
                            disabled={index === videos.length - 1}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </videoFetcher.Form>
                        <Button variant="ghost" size="icon" onClick={() => handleOpenVideoEdit(video)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <videoFetcher.Form method="post">
                          <input type="hidden" name="_action" value="delete_video" />
                          <input type="hidden" name="id" value={video.id} />
                          <Button variant="ghost" size="icon" type="submit">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </videoFetcher.Form>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Video className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t("meEdit.noVideos")}</p>
                <p className="text-xs mt-1">
                  {user.featuredVideoUrl
                    ? t("meEdit.noVideosLegacyHint")
                    : t("meEdit.noVideosHint")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("meEdit.profileSettings")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profileVisibility">{t("meEdit.profileVisibility")}</Label>
              <Select
                value={formValues.profileVisibility}
                onValueChange={(value) => handleInputChange("profileVisibility", value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">
                    {t("meEdit.profilePublic")}
                  </SelectItem>
                  <SelectItem value="unlisted">
                    {t("meEdit.profileUnlisted")}
                  </SelectItem>
                  <SelectItem value="private">
                    {t("meEdit.profilePrivate")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="defaultProfileTab">{t("meEdit.defaultTab")}</Label>
              <Select
                value={formValues.defaultProfileTab}
                onValueChange={(value) => handleInputChange("defaultProfileTab", value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="profile">{t("meEdit.tabProfile")}</SelectItem>
                  <SelectItem value="stats">{t("meEdit.tabStats")}</SelectItem>
                  <SelectItem value="playstyle">{t("meEdit.tabPlaystyle")}</SelectItem>
                  <SelectItem value="keybindings">{t("meEdit.tabKeybindings")}</SelectItem>
                  <SelectItem value="devices">{t("meEdit.tabDevices")}</SelectItem>
                  <SelectItem value="items">{t("meEdit.tabItems")}</SelectItem>
                  <SelectItem value="searchcraft">{t("meEdit.tabSearchcraft")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("meEdit.defaultTabHint")}
              </p>
            </div>

            <Separator className="my-4" />

            <div className="space-y-3">
              <Label>{t("meEdit.displaySettings")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("meEdit.displaySettingsHint")}
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="showPacemanOnHome" className="text-sm font-normal cursor-pointer">
                    {t("meEdit.showPacemanOnHome")}
                  </Label>
                  <Switch
                    id="showPacemanOnHome"
                    checked={formValues.showPacemanOnHome}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({ ...prev, showPacemanOnHome: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="showTwitchOnHome" className="text-sm font-normal cursor-pointer">
                    {t("meEdit.showTwitchOnHome")}
                  </Label>
                  <Switch
                    id="showTwitchOnHome"
                    checked={formValues.showTwitchOnHome}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({ ...prev, showTwitchOnHome: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="showYoutubeOnHome" className="text-sm font-normal cursor-pointer">
                    {t("meEdit.showYoutubeOnHome")}
                  </Label>
                  <Switch
                    id="showYoutubeOnHome"
                    checked={formValues.showYoutubeOnHome}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({ ...prev, showYoutubeOnHome: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="showRankedStats" className="text-sm font-normal cursor-pointer">
                    {t("meEdit.showRankedStats")}
                  </Label>
                  <Switch
                    id="showRankedStats"
                    checked={formValues.showRankedStats}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({ ...prev, showRankedStats: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="showPacemanStats" className="text-sm font-normal cursor-pointer">
                    {t("meEdit.showPacemanStats")}
                  </Label>
                  <Switch
                    id="showPacemanStats"
                    checked={formValues.showPacemanStats}
                    onCheckedChange={(checked) =>
                      setFormValues((prev) => ({ ...prev, showPacemanStats: checked }))
                    }
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Floating Save Bar */}
        <FloatingSaveBar
          hasChanges={hasChanges}
          isSubmitting={isSubmitting}
          onSave={handleSave}
          onReset={handleReset}
        />
      </div>

      {/* Social Links Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                {t("meEdit.socialLinks")}
              </CardTitle>
              <CardDescription>
                {t("meEdit.socialLinksDesc")}
              </CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleOpenCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("meEdit.add")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <SocialLinkDialog
                  editingLink={editingLink}
                  linkFetcher={linkFetcher}
                  isSubmitting={isLinkSubmitting}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {links.length > 0 ? (
            <div className="space-y-2">
              {links.map((link) => {
                const platformLabel = link.platform === "custom" && link.customLabel
                  ? link.customLabel
                  : platformOptions.find((p) => p.value === link.platform)?.label ?? link.platform;
                const url = getPlatformUrl(link.platform, link.identifier, link.customUrl);
                return (
                  <div key={link.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {getPlatformIcon(link.platform)}
                      <div>
                        <p className="font-medium">
                          {platformLabel}
                        </p>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-muted-foreground hover:underline"
                        >
                          {link.identifier}
                        </a>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(link)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <linkFetcher.Form method="post">
                        <input type="hidden" name="_action" value="delete_link" />
                        <input type="hidden" name="id" value={link.id} />
                        <Button variant="ghost" size="icon" type="submit">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </linkFetcher.Form>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Share2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("meEdit.noSocialLinks")}</p>
              <p className="text-xs mt-1">{t("meEdit.noSocialLinksHint")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t("meEdit.dangerZone")}
          </CardTitle>
          <CardDescription>
            {t("meEdit.dangerZoneDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border border-destructive/30 rounded-lg bg-destructive/5">
            <div>
              <p className="font-medium">{t("meEdit.deleteAccount")}</p>
              <p className="text-sm text-muted-foreground">
                {t("meEdit.deleteAccountDesc")}
              </p>
            </div>
            <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => {
              setIsDeleteDialogOpen(open);
              if (!open) setConfirmText("");
            }}>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  {t("meEdit.deleteAccount")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    {t("meEdit.confirmDeleteTitle")}
                  </DialogTitle>
                  <DialogDescription>
                    {t("meEdit.confirmDeleteDesc")}
                  </DialogDescription>
                </DialogHeader>
                <deleteFetcher.Form method="post">
                  <input type="hidden" name="_action" value="delete_account" />
                  <div className="space-y-4 py-4">
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        {t("meEdit.cannotUndo")}
                      </AlertDescription>
                    </Alert>
                    <div className="space-y-2">
                      <Label htmlFor="confirmText">
                        {t("meEdit.confirmInput", { value: user.mcid || user.slug })}
                      </Label>
                      <Input
                        id="confirmText"
                        name="confirmText"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={user.mcid || user.slug}
                        autoComplete="off"
                      />
                    </div>
                    {deleteData && "error" in deleteData && deleteData.action === "delete" && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{deleteData.error}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsDeleteDialogOpen(false)}
                    >
                      {t("meEdit.cancel")}
                    </Button>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={confirmText !== (user.mcid || user.slug) || isDeleting}
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t("meEdit.deleting")}
                        </>
                      ) : (
                        t("meEdit.deletePermanently")
                      )}
                    </Button>
                  </DialogFooter>
                </deleteFetcher.Form>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary() {
  const t = useT();
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Card>
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <h2 className="text-2xl font-bold">{t("meEdit.errorTitle")}</h2>
            <p className="text-muted-foreground">
              {t("meEdit.errorDescription")}
            </p>
            <Button onClick={() => window.location.reload()}>
              {t("meEdit.reloadPage")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
