import { createTranslator, type MessageKey } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLoaderData, useFetcher, redirect, Link, type ShouldRevalidateFunctionArgs } from "react-router";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import type { Route } from "./+types/edit";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { isTranslationEnabled } from "@/lib/translate.server";
import {
  users,
  socialLinks,
  profileVideos,
  keybindings,
  playerConfigs,
  itemLayouts,
  searchCrafts,
  keyRemaps,
} from "@/lib/schema";
import { SELECTABLE_PROFILE_TABS, type SelectableProfileTabValue } from "@/lib/profile-tabs";
import { eq, asc, sql } from "drizzle-orm";
import { safeExternalHref } from "@/lib/safe-url";
import { getYouTubeThumbnailUrl } from "@/lib/youtube-url";
import { importFromLegacy } from "@/lib/legacy-import";
import { CAPE_DISPLAY_OPTIONS, resolveCapeProps, type CapeDisplay } from "@/lib/cape";
import { deleteUserAccount } from "@/lib/content-cleanup.server";
import { saveProfileBatch } from "@/lib/profile-edit.server";
import {
  MAX_PROFILE_VIDEOS,
  PROFILE_FIELD_LIMITS,
  validateBedrockMcidFormat,
  validateLinkInput,
  validateMcidFormat,
  validateVideoInput,
  type LinkPayload,
  type ProfileFieldErrors,
  type VideoPayload,
} from "@/lib/profile-edit-validation";
import {
  buildProfileChanges,
  buildProfileDraft,
  hasProfileChanges,
  moveDraftVideo,
  newDraftKey,
  resolveSpeedrunUsernameForSave,
  speedrunLinkIdentifier,
  type DraftLink,
  type DraftVideo,
  type ProfileDraft,
} from "@/lib/profile-edit-draft";
import type { McidCheckResult } from "@/routes/api/me/mcid-check";
import {
  parseRtaStartedYearMonth,
  rtaCareerExactLabel,
  rtaCareerView,
  RTA_STARTED_MIN_YEAR,
} from "@/lib/rta-career";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { MinecraftFullBody } from "@/components/minecraft-fullbody";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  Share2,
  Video,
  Settings,
  AlertTriangle,
  Download,
  Pin,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  X,
} from "lucide-react";
import { Youtube, Twitch, Twitter } from "@/components/brand-icons";
import { SkinUploader } from "@/components/skin-uploader";
import { CapeUploader } from "@/components/cape-uploader";
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
    },
    // キー配置等のデータが存在するか（レガシーインポート案内の出し分けにだけ使う）。
    // 中身は不要なので EXISTS で users 取得と同じ 1 往復に畳み、関連データ全件をクライアントへ返さない
    // ※ RQB の extras では列参照が非修飾（"id"）で出力され、サブクエリ側の列と衝突して常に false になるため、
    //   外側の users.id はルート別名で明示的に修飾する（loader テストが相関を固定している）
    extras: {
      hasExistingData: sql<number>`(
        exists(select 1 from ${keybindings} where ${keybindings.userId} = "users"."id")
        or exists(select 1 from ${playerConfigs} where ${playerConfigs.userId} = "users"."id")
        or exists(select 1 from ${itemLayouts} where ${itemLayouts.userId} = "users"."id")
        or exists(select 1 from ${searchCrafts} where ${searchCrafts.userId} = "users"."id")
        or exists(select 1 from ${keyRemaps} where ${keyRemaps.userId} = "users"."id")
      )`.as("has_existing_data"),
    },
  });

  if (!user) {
    throw new Response(t("meEdit.userNotFound"), { status: 404 });
  }

  const { hasExistingData: hasExistingDataRaw, ...userRow } = user;
  const hasExistingData = Boolean(hasExistingDataRaw);

  // レガシーAPIのURLのみ返す（チェックはクライアントサイドで行う）
  const legacyApiUrl = env.LEGACY_API_URL;

  // 自動翻訳が無効（ANTHROPIC_API_KEY 未設定）のときは許可スイッチを出さない（真偽値だけをクライアントへ渡す）
  const translationEnabled = isTranslationEnabled();

  return {
    user: userRow,
    links: user.socialLinks,
    videos: user.profileVideos,
    legacyApiUrl,
    hasExistingData,
    translationEnabled,
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
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

  // アカウント削除
  if (actionType === "delete_account") {
    const confirmText = (formData.get("confirmText") as string)?.trim();
    const expectedText = user.mcid || user.slug;

    if (confirmText !== expectedText) {
      return { error: t("meEdit.deleteConfirmMismatch"), action: "delete" };
    }

    // 派生データの削除（翻訳キャッシュ・favorites孤児行）と本体削除（users + better-auth
    // 3テーブル）を単一トランザクションで原子化する（app/lib/content-cleanup.server.ts）。
    // トランザクション成功後、Vercel Blob 実体の削除は内部で runAfterResponse 経由でスケジュールされる。
    await deleteUserAccount(db, { user, sessionUserId: session.user.id });

    // Redirect to home after deletion
    return redirect("/");
  }

  // プロフィール情報の更新（保存バーの一括保存。`save_all` と `_action` 未指定は同じ経路）。
  // 本体は app/lib/profile-edit.server.ts。`changes`（JSON）に MCID・リンク・動画の差分が載る
  return saveProfileBatch({ db, t, user, formData });
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
  { value: "youtube", label: "YouTube", placeholder: "e.g. couriern3w", prefix: "youtube.com/@" },
  { value: "twitch", label: "Twitch", placeholder: "e.g. couriern3w", prefix: "twitch.tv/" },
  { value: "twitter", label: "Twitter/X", placeholder: "e.g. couriern3w", prefix: "x.com/" },
  { value: "custom", label: null, labelKey: "meEdit.customSns" as const, placeholder: "e.g. username", prefix: "" },
] as const;

// 既定タブ Select のラベル。値の集合・順序は SELECTABLE_PROFILE_TABS（@/lib/profile-tabs）が単一情報源
const DEFAULT_PROFILE_TAB_LABEL_KEYS: Record<SelectableProfileTabValue, MessageKey> = {
  profile: "meEdit.tabProfile",
  stats: "meEdit.tabStats",
  playstyle: "meEdit.tabPlaystyle",
  keybindings: "meEdit.tabKeybindings",
  devices: "meEdit.tabDevices",
  items: "meEdit.tabItems",
  searchcraft: "meEdit.tabSearchcraft",
};

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

// href に置く URL。カスタムリンクは http/https 以外（保存済みの javascript: 等）なら undefined を返し、
// href 属性自体を出さない（プロフィール側と同じく safeExternalHref を通す）
function getPlatformUrl(platform: string, identifier: string, customUrlValue?: string | null): string | undefined {
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
      return safeExternalHref(customUrlValue);
    default:
      return "#";
  }
}

// ソーシャルリンク編集ダイアログ。確定しても保存はされず、下書き（保存バーで一括保存）に反映するだけ
function SocialLinkDialog({
  editingLink,
  otherPlatforms,
  onSubmit,
}: {
  editingLink: DraftLink | null;
  /** 他のリンクが使用中のプラットフォーム（カスタム以外は1プラットフォーム1件） */
  otherPlatforms: string[];
  onSubmit: (payload: LinkPayload) => void;
}) {
  const t = useT();
  const [selectedPlatform, setSelectedPlatform] = useState(editingLink?.platform ?? "youtube");
  const [error, setError] = useState<string | null>(null);

  const currentOption = platformOptions.find((opt) => opt.value === selectedPlatform);
  const isCustom = selectedPlatform === "custom";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: LinkPayload = {
      platform: selectedPlatform,
      identifier: String(fd.get("identifier") ?? "").trim(),
      customLabel: String(fd.get("customLabel") ?? "").trim() || null,
      customUrl: String(fd.get("customUrl") ?? "").trim() || null,
    };
    const errorKey = validateLinkInput(payload);
    if (errorKey) {
      setError(t(errorKey));
      return;
    }
    if (payload.platform !== "custom" && otherPlatforms.includes(payload.platform)) {
      setError(t("meEdit.platformLinkExists"));
      return;
    }
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit}>
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
            <SelectTrigger id="platform" className="w-full">
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
          <Label htmlFor="link-identifier">{t("meEdit.userId")}</Label>
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
              maxLength={PROFILE_FIELD_LIMITS.linkIdentifier}
              className="flex-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {isCustom ? t("meEdit.customIdentifierHint") : t("meEdit.socialIdHint")}
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-xs text-muted-foreground">{t("meEdit.pendingSaveNote")}</p>
      </div>
      <DialogFooter>
        <Button type="submit">{editingLink ? t("meEdit.updateLink") : t("meEdit.addLink")}</Button>
      </DialogFooter>
    </form>
  );
}

// 動画編集ダイアログ。確定しても保存はされず、下書き（保存バーで一括保存）に反映するだけ
function VideoDialog({
  editingVideo,
  defaultUrl,
  onSubmit,
}: {
  editingVideo: DraftVideo | null;
  defaultUrl?: string;
  onSubmit: (payload: VideoPayload) => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: VideoPayload = {
      url: String(fd.get("url") ?? "").trim(),
      title: String(fd.get("title") ?? "").trim() || null,
      isPinned: fd.get("isPinned") === "true",
    };
    const errorKey = validateVideoInput(payload);
    if (errorKey) {
      setError(t(errorKey));
      return;
    }
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit}>
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
            maxLength={PROFILE_FIELD_LIMITS.videoTitle}
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
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-xs text-muted-foreground">{t("meEdit.pendingSaveNote")}</p>
      </div>
      <DialogFooter>
        <Button type="submit">{editingVideo ? t("meEdit.videoUpdate") : t("meEdit.videoAdd")}</Button>
      </DialogFooter>
    </form>
  );
}

// 未保存（保存バーで保存するまで反映されない）項目に付けるバッジ
function PendingBadge({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="outline" className="text-warning border-warning/50 bg-warning/10 text-xs">
      {children}
    </Badge>
  );
}

// 下書きの項目単位の取り消しボタン
function UndoButton({ onClick, disabled, title }: { onClick: () => void; disabled?: boolean; title?: string }) {
  const t = useT();
  return (
    // 無効なボタンは title が出ないため、理由は外側の span に付ける
    <span title={title}>
      <Button variant="ghost" size="sm" type="button" onClick={onClick} disabled={disabled}>
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        {t("meEdit.undoChange")}
      </Button>
    </span>
  );
}

export default function EditProfilePage() {
  const t = useT();
  const locale = useLocale();
  const { user, links, videos, legacyApiUrl, hasExistingData, translationEnabled } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();

  // MCID・リンク・動画は保存バーで保存するまで下書き（draft）にだけ持ち、保存時に差分を1リクエストで送る
  // （docs/profiles.md「/me/edit の保存方式」）。savedDraft は dirty 判定・取り消しの基準
  const loaderDraft = useMemo(() => buildProfileDraft({ user, links, videos }), [user, links, videos]);
  const [draft, setDraft] = useState<ProfileDraft>(loaderDraft);
  const [savedDraft, setSavedDraft] = useState<ProfileDraft>(loaderDraft);
  // 保存時にサーバーが返した検証エラー（MCID・リンク行・動画行）
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isVideoDialogOpen, setIsVideoDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isMcidDialogOpen, setIsMcidDialogOpen] = useState(false);
  const [isBedrockMcidDialogOpen, setIsBedrockMcidDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<DraftLink | null>(null);
  const [editingVideo, setEditingVideo] = useState<DraftVideo | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [newMcid, setNewMcid] = useState("");
  const [mcidCheck, setMcidCheck] = useState<{ status: "idle" | "checking" | "error"; message?: string }>({
    status: "idle",
  });
  const [newBedrockMcid, setNewBedrockMcid] = useState("");
  const [bedrockError, setBedrockError] = useState<string | null>(null);
  // MCID 事前照合のリクエスト番号（古い結果を捨てるため）
  const mcidCheckSeqRef = useRef(0);
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
  // buildFormValues は user + RTA初期値のスナップショットを1箇所にまとめる（me/playstyle.tsx と同じ
  // パターン）。useState の初期化関数・useRef の初期値の両方から呼び、リテラルの二重管理を避ける
  const buildFormValues = () => ({
    displayName: user.displayName ?? "",
    displayNameAlphabet: user.displayNameAlphabet ?? "",
    bio: user.bio ?? "",
    location: user.location ?? "",
    pronouns: user.pronouns ?? "",
    profileVisibility: user.profileVisibility ?? "public",
    profilePose: (user.profilePose as PoseName) ?? "waving",
    slimSkin: user.slimSkin ?? false,
    capeDisplay: (user.capeDisplay as CapeDisplay) ?? "cape",
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
    allowAutoTranslation: user.allowAutoTranslation ?? true,
  });

  const [formValues, setFormValues] = useState(buildFormValues);
  // 保存済みの値（dirty 判定の基準）。保存成功時に送信時点のスナップショットへ更新する
  const [savedFormValues, setSavedFormValues] = useState(buildFormValues);
  const submittedValuesRef = useRef<ReturnType<typeof buildFormValues> | null>(null);

  // selectedPoseをformValuesに同期
  useEffect(() => {
    setFormValues((prev) => ({
      ...prev,
      profilePose: selectedPose,
    }));
  }, [selectedPose]);

  // 変更チェック（フォーム値 ＋ MCID・リンク・動画の下書き）
  const hasChanges =
    JSON.stringify(formValues) !== JSON.stringify(savedFormValues) || hasProfileChanges(savedDraft, draft);

  // 未保存のままアプリ内遷移・タブ閉じをしようとしたら確認する
  const blocker = useUnsavedWarning(hasChanges);

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
    setFormValues(savedFormValues);
    setSelectedPose((savedFormValues.profilePose as PoseName) ?? "waving");
    setDraft(savedDraft);
    setFieldErrors({});
  }, [savedFormValues, savedDraft]);

  // 保存処理
  const handleSave = useCallback(() => {
    const { rtaStartedYear, rtaStartedMonth } = formValues;
    // RTA歴は年・月の両方を選ぶか、両方未選択（未回答）のみ有効
    if (isRtaStartedIncomplete) {
      toast.error(t("meEdit.rtaStartedBothOrNone"));
      return;
    }

    const formData = new FormData();
    formData.set("_action", "save_all");
    formData.set("displayName", formValues.displayName);
    formData.set("displayNameAlphabet", formValues.displayNameAlphabet);
    formData.set("bio", formValues.bio);
    formData.set("location", formValues.location);
    formData.set("pronouns", formValues.pronouns);
    formData.set("profileVisibility", formValues.profileVisibility);
    formData.set("profilePose", formValues.profilePose);
    formData.set("slimSkin", String(formValues.slimSkin));
    formData.set("capeDisplay", formValues.capeDisplay);
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
    // 同じ保存に speedrun.com リンクの変更があるときはサーバーがリンクを優先するため、
    // フォーム欄の手入力値ではなくリンクの下書きから決めた値を送り、「保存済み」としても扱う
    const speedruncomUsername = resolveSpeedrunUsernameForSave(savedDraft, draft, formValues.speedruncomUsername);
    formData.set("speedruncomUsername", speedruncomUsername);
    formData.set("showPacemanOnHome", String(formValues.showPacemanOnHome));
    formData.set("showTwitchOnHome", String(formValues.showTwitchOnHome));
    formData.set("showYoutubeOnHome", String(formValues.showYoutubeOnHome));
    formData.set("showRankedStats", String(formValues.showRankedStats));
    formData.set("showPacemanStats", String(formValues.showPacemanStats));
    // 機能無効時はスイッチを出さないので送らない（action は未送信なら列を上書きしない）
    if (translationEnabled) {
      formData.set("allowAutoTranslation", String(formValues.allowAutoTranslation));
    }
    // MCID・リンク・動画の差分（無ければ送らない）
    const changes = buildProfileChanges(savedDraft, draft);
    if (Object.keys(changes).length > 0) {
      formData.set("changes", JSON.stringify(changes));
    }
    setFieldErrors({});
    submittedValuesRef.current = { ...formValues, speedruncomUsername };
    if (speedruncomUsername !== formValues.speedruncomUsername) {
      setFormValues((prev) => ({ ...prev, speedruncomUsername }));
    }
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, formValues, draft, savedDraft, isRtaStartedIncomplete, t, translationEnabled]);

  // ポーズ変更を同期
  useEffect(() => {
    setFormValues((prev) => ({ ...prev, profilePose: selectedPose }));
  }, [selectedPose]);

  // ポーズプレビュー用のマント。capeDisplay は保存前のフォーム値を使う（選択が即プレビューに反映される）
  const capeProps = resolveCapeProps({
    uuid: user.uuid,
    customCapeUrl: user.customCapeUrl,
    capeDisplay: formValues.capeDisplay,
  });

  // 保存中〜保存後の再取得（loading）が終わるまでは idle にならない（二重送信で新規行が重複するのを防ぐ）
  const isSubmitting = fetcher.state !== "idle";
  const isDeleting = deleteFetcher.state === "submitting";
  const isImporting = importFetcher.state === "submitting";
  const data = fetcher.data;
  const deleteData = deleteFetcher.data;
  const importData = importFetcher.data;

  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const prevImportDataRef = useRef<typeof importFetcher.data>(undefined);

  // 保存成功後に基準値を更新（レスポンスごとに1回だけ。送信時点の値を使うので保存中の入力は未保存のまま残る）
  const handledSaveDataRef = useRef<typeof fetcher.data>(undefined);
  useEffect(() => {
    if (!data || data === handledSaveDataRef.current) return;
    handledSaveDataRef.current = data;
    if ("success" in data && data.action === "profile" && submittedValuesRef.current) {
      setSavedFormValues(submittedValuesRef.current);
    }
  }, [data]);

  // loader の再取得結果を下書きへ取り込む。保存成功後は新規行に実 id が振られているため必ず取り込み直す
  // （そのままだと新規行が再び「作成」扱いになり重複する）。未保存の変更が無いときも最新に追従する。
  // 保存中は下書きを変える操作をすべて無効化している（disabled={isSubmitting}）ので、取り込みで編集中の内容を失うことはない
  const rebasedDataRef = useRef<typeof fetcher.data>(undefined);
  const latestDraftRef = useRef({ draft, savedDraft });
  latestDraftRef.current = { draft, savedDraft };
  useEffect(() => {
    const saved = Boolean(data && "success" in data && data.success && data.action === "profile");
    const justSaved = saved && fetcher.state === "idle" && data !== rebasedDataRef.current;
    const { draft: currentDraft, savedDraft: currentSaved } = latestDraftRef.current;
    if (justSaved || !hasProfileChanges(currentSaved, currentDraft)) {
      if (justSaved) rebasedDataRef.current = data;
      setSavedDraft(loaderDraft);
      setDraft(loaderDraft);
    }
  }, [loaderDraft, data, fetcher.state]);

  // プロフィール保存のトースト。検証エラーは項目ごとのエラー表示にも反映する
  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.action === "profile") {
      toast.success(t("meEdit.profileUpdated"));
      setFieldErrors({});
    } else if ("error" in data) {
      toast.error(data.error);
      setFieldErrors(("fieldErrors" in data && data.fieldErrors) || {});
    }
  }, [data]);

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

  // ---- 下書きの操作（保存は保存バーでまとめて行う） ----
  const isMcidChanged = draft.mcid.value !== savedDraft.mcid.value;
  const isBedrockChanged = draft.bedrockMcid !== savedDraft.bedrockMcid;
  const deletedLinks = savedDraft.links.filter((l) => !draft.links.some((d) => d.id === l.id));
  const deletedVideos = savedDraft.videos.filter((v) => !draft.videos.some((d) => d.id === v.id));

  const isLinkEdited = (link: DraftLink) => {
    const before = link.id ? savedDraft.links.find((l) => l.id === link.id) : undefined;
    if (!before) return false;
    const norm = (l: DraftLink) =>
      JSON.stringify([
        l.platform,
        l.identifier.trim(),
        l.platform === "custom" ? l.customLabel.trim() : "",
        l.platform === "custom" ? l.customUrl.trim() : "",
      ]);
    return norm(before) !== norm(link);
  };
  const isVideoEdited = (video: DraftVideo) => {
    const before = video.id ? savedDraft.videos.find((v) => v.id === video.id) : undefined;
    if (!before) return false;
    return (
      before.url.trim() !== video.url.trim() ||
      before.title.trim() !== video.title.trim() ||
      before.isPinned !== video.isPinned
    );
  };

  const clearRowError = (kind: "links" | "videos", key: string) => {
    setFieldErrors((prev) => {
      const group = prev[kind];
      if (!group || !(key in group)) return prev;
      const rest = { ...group };
      delete rest[key];
      return { ...prev, [kind]: rest };
    });
  };

  // リンク。speedrun.com リンクが増減・変更したら、フォームの speedruncomUsername もそれに合わせる
  // （サーバーは同じ保存に speedrun.com リンクの変更があればリンクを優先するため、画面上も同じ値にしておく）
  const updateLinks = (nextLinks: DraftLink[]) => {
    const before = speedrunLinkIdentifier(draft.links);
    const after = speedrunLinkIdentifier(nextLinks);
    setDraft((prev) => ({ ...prev, links: nextLinks }));
    if (before !== after) {
      setFormValues((prev) => ({ ...prev, speedruncomUsername: after ?? "" }));
    }
  };

  const handleOpenCreate = () => {
    setEditingLink(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (link: DraftLink) => {
    setEditingLink(link);
    setIsDialogOpen(true);
  };

  const handleLinkSubmit = (payload: LinkPayload) => {
    const apply = {
      platform: payload.platform,
      identifier: payload.identifier,
      customLabel: payload.customLabel ?? "",
      customUrl: payload.customUrl ?? "",
    };
    if (editingLink) {
      updateLinks(draft.links.map((l) => (l.key === editingLink.key ? { ...l, ...apply } : l)));
      clearRowError("links", editingLink.key);
    } else {
      updateLinks([...draft.links, { key: newDraftKey(), id: null, ...apply }]);
    }
    setIsDialogOpen(false);
  };

  const handleLinkRemove = (key: string) => {
    updateLinks(draft.links.filter((l) => l.key !== key));
    clearRowError("links", key);
  };

  // 取り消し（復元）すると同じプラットフォームのリンクが重複する場合は復元できない
  const isRestoreBlocked = (link: DraftLink) =>
    link.platform !== "custom" && draft.links.some((l) => l.platform === link.platform);

  const handleLinkRestore = (link: DraftLink) => {
    const index = savedDraft.links.findIndex((l) => l.key === link.key);
    const next = [...draft.links];
    next.splice(Math.min(Math.max(index, 0), next.length), 0, link);
    updateLinks(next);
  };

  const handleLinkUndoEdit = (key: string) => {
    const original = savedDraft.links.find((l) => l.key === key);
    if (!original) return;
    updateLinks(draft.links.map((l) => (l.key === key ? original : l)));
    clearRowError("links", key);
  };

  // 動画
  const handleOpenVideoCreate = () => {
    setEditingVideo(null);
    setIsVideoDialogOpen(true);
  };

  const handleOpenVideoEdit = (video: DraftVideo) => {
    setEditingVideo(video);
    setIsVideoDialogOpen(true);
  };

  const handleVideoSubmit = (payload: VideoPayload) => {
    const apply = { url: payload.url, title: payload.title ?? "", isPinned: payload.isPinned };
    if (editingVideo) {
      setDraft((prev) => ({
        ...prev,
        videos: prev.videos.map((v) => (v.key === editingVideo.key ? { ...v, ...apply } : v)),
      }));
      clearRowError("videos", editingVideo.key);
    } else {
      setDraft((prev) => ({
        ...prev,
        videos: [...prev.videos, { key: newDraftKey(), id: null, ...apply }],
      }));
    }
    setIsVideoDialogOpen(false);
  };

  const handleVideoRemove = (key: string) => {
    setDraft((prev) => ({ ...prev, videos: prev.videos.filter((v) => v.key !== key) }));
    clearRowError("videos", key);
  };

  const handleVideoRestore = (video: DraftVideo) => {
    const index = savedDraft.videos.findIndex((v) => v.key === video.key);
    setDraft((prev) => {
      const next = [...prev.videos];
      next.splice(Math.min(Math.max(index, 0), next.length), 0, video);
      return { ...prev, videos: next };
    });
  };

  const handleVideoMove = (key: string, direction: "up" | "down") => {
    setDraft((prev) => ({ ...prev, videos: moveDraftVideo(prev.videos, key, direction) }));
  };

  // Java 版 MCID。確定時に Mojang 照合（/api/me/mcid-check）し、確認できたものだけ下書きに載せる。
  // 保存時にもサーバーが再照合する（この結果は信用されない）
  const handleMcidUndo = () => {
    setDraft((prev) => ({ ...prev, mcid: savedDraft.mcid }));
    setFieldErrors((prev) => ({ ...prev, mcid: undefined }));
  };

  const handleMcidRemove = () => {
    setDraft((prev) => ({ ...prev, mcid: { value: null, uuid: null } }));
    setFieldErrors((prev) => ({ ...prev, mcid: undefined }));
  };

  const handleMcidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = newMcid.trim();
    const formatKey = validateMcidFormat(value);
    if (formatKey) {
      setMcidCheck({ status: "error", message: t(formatKey) });
      return;
    }
    // 保存済みの MCID と同じなら「変更なし」に戻すだけ（照合不要）
    if (value === savedDraft.mcid.value) {
      handleMcidUndo();
      setIsMcidDialogOpen(false);
      return;
    }
    setMcidCheck({ status: "checking" });
    const seq = ++mcidCheckSeqRef.current;
    try {
      const res = await fetch(`/api/me/mcid-check?mcid=${encodeURIComponent(value)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`mcid-check ${res.status}`);
      const result = (await res.json()) as McidCheckResult;
      // ダイアログを閉じた・再度確定した後に返ってきた古い結果は捨てる
      if (seq !== mcidCheckSeqRef.current) return;
      if (result.status === "ok") {
        setDraft((prev) => ({ ...prev, mcid: { value: result.mcid, uuid: result.uuid } }));
        setFieldErrors((prev) => ({ ...prev, mcid: undefined }));
        setIsMcidDialogOpen(false);
        setNewMcid("");
        setMcidCheck({ status: "idle" });
        return;
      }
      const message =
        result.status === "invalid"
          ? t("meEdit.mcidLength")
          : result.status === "taken"
            ? t("meEdit.mcidTaken")
            : result.status === "not_found"
              ? t("meEdit.mcidNotFound")
              : t("meEdit.mcidVerifyFailed");
      setMcidCheck({ status: "error", message });
    } catch {
      if (seq !== mcidCheckSeqRef.current) return;
      setMcidCheck({ status: "error", message: t("meEdit.mcidVerifyFailed") });
    }
  };

  // Bedrock 版 MCID（自己申告。Mojang 照合なし）
  const handleBedrockUndo = () => {
    setDraft((prev) => ({ ...prev, bedrockMcid: savedDraft.bedrockMcid }));
    setFieldErrors((prev) => ({ ...prev, bedrockMcid: undefined }));
  };

  const handleBedrockRemove = () => {
    setDraft((prev) => ({ ...prev, bedrockMcid: null }));
    setFieldErrors((prev) => ({ ...prev, bedrockMcid: undefined }));
  };

  const handleBedrockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = newBedrockMcid.trim();
    const errorKey = validateBedrockMcidFormat(value);
    if (errorKey) {
      setBedrockError(t(errorKey));
      return;
    }
    setDraft((prev) => ({ ...prev, bedrockMcid: value }));
    setFieldErrors((prev) => ({ ...prev, bedrockMcid: undefined }));
    setIsBedrockMcidDialogOpen(false);
    setNewBedrockMcid("");
    setBedrockError(null);
  };

  const renderMcidDialog = (trigger: React.ReactNode) => (
    <Dialog
      open={isMcidDialogOpen}
      onOpenChange={(open) => {
        setIsMcidDialogOpen(open);
        if (!open) {
          mcidCheckSeqRef.current++; // 進行中の照合結果を無効化する
          setNewMcid("");
          setMcidCheck({ status: "idle" });
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {draft.mcid.value ? t("meEdit.changeMcidTitle") : t("meEdit.setMcidTitle")}
          </DialogTitle>
          <DialogDescription>
            {draft.mcid.value ? t("meEdit.changeMcidDesc") : t("meEdit.setMcidDesc")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleMcidSubmit}>
          <div className="space-y-4 py-4">
            {draft.mcid.value && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{t("meEdit.mcidUrlChangeWarning")}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="new-mcid">
                {draft.mcid.value ? t("meEdit.newMcid") : t("meEdit.minecraftIdTitle")}
              </Label>
              <Input
                id="new-mcid"
                name="mcid"
                value={newMcid}
                onChange={(e) => {
                  setNewMcid(e.target.value);
                  if (mcidCheck.status === "error") setMcidCheck({ status: "idle" });
                }}
                placeholder={t("meEdit.mcidExample")}
                minLength={PROFILE_FIELD_LIMITS.mcidMin}
                maxLength={PROFILE_FIELD_LIMITS.mcidMax}
              />
            </div>
            {mcidCheck.status === "error" && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{mcidCheck.message}</AlertDescription>
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">{t("meEdit.pendingSaveNote")}</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!newMcid.trim() || mcidCheck.status === "checking"}>
              {mcidCheck.status === "checking" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("meEdit.mcidChecking")}
                </>
              ) : draft.mcid.value ? (
                t("meEdit.applyMcidChange")
              ) : (
                t("meEdit.setMcid")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6 pb-24">
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
              <Button type="submit" disabled={isImporting || hasChanges}>
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
            {hasChanges && (
              <p className="mt-2 text-xs text-muted-foreground">{t("meEdit.importDisabledDirty")}</p>
            )}
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
            {/* MCID設定（下書き。保存バーで保存するまで反映されない） */}
            <div className="space-y-3">
              <Label>{t("meEdit.minecraftIdTitle")}</Label>
              {draft.mcid.value ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0">
                      <MinecraftAvatar uuid={draft.mcid.uuid} skinUrl={user.customSkinUrl} size={64} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">@{draft.mcid.value}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        UUID: {draft.mcid.uuid}
                      </p>
                      {isMcidChanged && <PendingBadge>{t("meEdit.unsavedBadge")}</PendingBadge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {isMcidChanged && <UndoButton onClick={handleMcidUndo} disabled={isSubmitting} />}
                    {renderMcidDialog(
                      <Button variant="outline" size="sm" disabled={isSubmitting}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {t("meEdit.change")}
                      </Button>,
                    )}
                    <Button variant="ghost" size="sm" type="button" onClick={handleMcidRemove} disabled={isSubmitting}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("meEdit.delete")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 p-3 border rounded-lg bg-muted/30">
                  <p className="text-sm text-muted-foreground">
                    {savedDraft.mcid.value ? t("meEdit.mcidPendingRemove") : t("meEdit.mcidNotConfigured")}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    {isMcidChanged && <UndoButton onClick={handleMcidUndo} />}
                    {renderMcidDialog(
                      <Button size="sm" disabled={isSubmitting}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t("meEdit.setMcid")}
                      </Button>,
                    )}
                  </div>
                </div>
              )}
              {fieldErrors.mcid && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{fieldErrors.mcid}</AlertDescription>
                </Alert>
              )}
            </div>

            <Separator />

            {/* Bedrock版MCID（Xboxゲーマータグ）。自己申告のためMojang検証はせず、slug・スキンには影響しない。下書き（保存バーで保存するまで反映されない） */}
            <div className="space-y-3">
              <Label>{t("meEdit.bedrockMcidTitle")}</Label>
              <p className="text-sm text-muted-foreground">{t("meEdit.bedrockMcidDesc")}</p>
              <div className="flex items-center justify-between gap-3 p-3 border rounded-lg bg-muted/30">
                {draft.bedrockMcid ? (
                  <div className="min-w-0">
                    <p className="truncate font-medium">@{draft.bedrockMcid}</p>
                    {isBedrockChanged && <PendingBadge>{t("meEdit.unsavedBadge")}</PendingBadge>}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {savedDraft.bedrockMcid
                      ? t("meEdit.bedrockMcidPendingRemove")
                      : t("meEdit.bedrockMcidNotConfigured")}
                  </p>
                )}
                <div className="flex shrink-0 gap-2">
                  {isBedrockChanged && <UndoButton onClick={handleBedrockUndo} disabled={isSubmitting} />}
                  <Dialog
                    open={isBedrockMcidDialogOpen}
                    onOpenChange={(open) => {
                      setIsBedrockMcidDialogOpen(open);
                      setBedrockError(null);
                      setNewBedrockMcid(open ? (draft.bedrockMcid ?? "") : "");
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button variant={draft.bedrockMcid ? "outline" : "default"} size="sm" disabled={isSubmitting}>
                        {draft.bedrockMcid ? (
                          <Pencil className="mr-2 h-4 w-4" />
                        ) : (
                          <Plus className="mr-2 h-4 w-4" />
                        )}
                        {draft.bedrockMcid ? t("meEdit.change") : t("meEdit.setBedrockMcid")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          {draft.bedrockMcid
                            ? t("meEdit.changeBedrockMcidTitle")
                            : t("meEdit.setBedrockMcidTitle")}
                        </DialogTitle>
                        <DialogDescription>{t("meEdit.setBedrockMcidDesc")}</DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleBedrockSubmit}>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="new-bedrock-mcid">{t("meEdit.newBedrockMcid")}</Label>
                            <Input
                              id="new-bedrock-mcid"
                              name="bedrockMcid"
                              value={newBedrockMcid}
                              onChange={(e) => setNewBedrockMcid(e.target.value)}
                              placeholder={t("meEdit.bedrockMcidExample")}
                              minLength={PROFILE_FIELD_LIMITS.bedrockMcidMin}
                              maxLength={PROFILE_FIELD_LIMITS.bedrockMcidMax}
                            />
                          </div>
                          {bedrockError && (
                            <Alert variant="destructive">
                              <AlertCircle className="h-4 w-4" />
                              <AlertDescription>{bedrockError}</AlertDescription>
                            </Alert>
                          )}
                          <p className="text-xs text-muted-foreground">{t("meEdit.pendingSaveNote")}</p>
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={!newBedrockMcid.trim()}>
                            {t("meEdit.saveBedrockMcid")}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                  {draft.bedrockMcid && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={isSubmitting}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t("meEdit.delete")}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("meEdit.removeBedrockMcidTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("meEdit.removeBedrockMcidConfirm")} {t("meEdit.pendingSaveNote")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("meEdit.cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            type="button"
                            onClick={handleBedrockRemove}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t("meEdit.delete")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
              {fieldErrors.bedrockMcid && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{fieldErrors.bedrockMcid}</AlertDescription>
                </Alert>
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

            <Separator />

            {/* Custom Cape Upload */}
            <div className="space-y-3">
              <Label>{t("capeUploader.customCapeTitle")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("capeUploader.customCapeDesc")}
              </p>
              {user.customCapeUrl && (
                <Alert className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t("capeUploader.customCapeActive")}
                  </AlertDescription>
                </Alert>
              )}
              <CapeUploader
                userId={user.id}
                currentCapeUrl={user.customCapeUrl}
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
                  <Label id="pose-label">{t("meEdit.poseLabel")}</Label>
                  <RadioGroup
                    aria-labelledby="pose-label"
                    value={selectedPose}
                    onValueChange={(value) => setSelectedPose(value as typeof selectedPose)}
                    className="grid grid-cols-3 gap-3"
                  >
                    {(["standing", "walking", "waving"] as const).map((pose) => (
                      <RadioGroupPrimitive.Item
                        key={pose}
                        value={pose}
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
                            {...capeProps}
                            asImage
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {pose === "standing" && t("meEdit.poseStanding")}
                          {pose === "walking" && t("meEdit.poseWalking")}
                          {pose === "waving" && t("meEdit.poseWaving")}
                        </span>
                      </RadioGroupPrimitive.Item>
                    ))}
                  </RadioGroup>
                </div>
              </>
            )}

            <Separator />

            {/* Skin Model Toggle - 常に表示 */}
            <div className="space-y-2">
              <Label id="skin-model-label">{t("meEdit.skinModelLabel")}</Label>
              <RadioGroup
                aria-labelledby="skin-model-label"
                value={formValues.slimSkin ? "slim" : "default"}
                onValueChange={(value) => setFormValues((prev) => ({ ...prev, slimSkin: value === "slim" }))}
                className="flex gap-0 rounded-lg border p-1 w-fit"
              >
                <RadioGroupPrimitive.Item
                  value="default"
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${!formValues.slimSkin
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                    }`}
                >
                  {t("meEdit.skinModelDefault")}
                </RadioGroupPrimitive.Item>
                <RadioGroupPrimitive.Item
                  value="slim"
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${formValues.slimSkin
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                    }`}
                >
                  {t("meEdit.skinModelSlim")}
                </RadioGroupPrimitive.Item>
              </RadioGroup>
            </div>

            <Separator />

            {/* Cape Display Toggle - 常に表示（Mojang のマントにも適用されるため） */}
            <div className="space-y-2">
              <Label id="cape-display-label">{t("meEdit.capeDisplayLabel")}</Label>
              <RadioGroup
                aria-labelledby="cape-display-label"
                value={formValues.capeDisplay}
                onValueChange={(value) => setFormValues((prev) => ({ ...prev, capeDisplay: value as typeof prev.capeDisplay }))}
                className="flex gap-0 rounded-lg border p-1 w-fit"
              >
                {CAPE_DISPLAY_OPTIONS.map((option) => (
                  <RadioGroupPrimitive.Item
                    key={option}
                    value={option}
                    className={`px-4 py-1.5 text-sm rounded-md transition-colors ${formValues.capeDisplay === option
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                      }`}
                  >
                    {option === "cape" && t("meEdit.capeDisplayCape")}
                    {option === "elytra" && t("meEdit.capeDisplayElytra")}
                    {option === "hidden" && t("meEdit.capeDisplayHidden")}
                  </RadioGroupPrimitive.Item>
                ))}
              </RadioGroup>
              <p className="text-xs text-muted-foreground">{t("meEdit.capeDisplayHint")}</p>
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
                maxLength={PROFILE_FIELD_LIMITS.displayName}
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
                maxLength={PROFILE_FIELD_LIMITS.displayNameAlphabet}
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
                maxLength={PROFILE_FIELD_LIMITS.bio}
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
                  maxLength={PROFILE_FIELD_LIMITS.location}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pronouns">{t("meEdit.pronouns")}</Label>
                <Combobox
                  id="pronouns"
                  options={pronounOptions}
                  value={formValues.pronouns}
                  onValueChange={(value) => handleInputChange("pronouns", value.slice(0, PROFILE_FIELD_LIMITS.pronouns))}
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
                maxLength={PROFILE_FIELD_LIMITS.shortBio}
              />
              <p className="text-xs text-muted-foreground">
                {t("meEdit.shortBioHint")}
              </p>
            </div>

            {translationEnabled && (
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
                <div className="space-y-1">
                  <Label htmlFor="allowAutoTranslation" className="text-sm font-normal cursor-pointer">
                    {t("meEdit.allowAutoTranslation")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("meEdit.allowAutoTranslationHint")}
                  </p>
                </div>
                <Switch
                  id="allowAutoTranslation"
                  checked={formValues.allowAutoTranslation}
                  onCheckedChange={(checked) =>
                    setFormValues((prev) => ({ ...prev, allowAutoTranslation: checked }))
                  }
                />
              </div>
            )}

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
                  <SelectTrigger id="mainPlatform" className="w-full">
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
                  <SelectTrigger id="role" className="w-full">
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
                  maxLength={PROFILE_FIELD_LIMITS.speedruncomUsername}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("meEdit.speedrunUsernameHint")}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Videos（複数動画欄。旧「おすすめ動画」featuredVideoUrl の後継）。下書き（保存バーで一括保存） */}
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenVideoCreate}
                    disabled={isSubmitting || draft.videos.length >= MAX_PROFILE_VIDEOS}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t("meEdit.add")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <VideoDialog
                    // 開くたびに再マウントし、非制御入力（defaultValue/defaultChecked）の
                    // 前回状態が持ち越されないようにする
                    key={`${isVideoDialogOpen}-${editingVideo?.key ?? "new"}`}
                    editingVideo={editingVideo}
                    onSubmit={handleVideoSubmit}
                    // 旧「おすすめ動画」からの移行を助けるため、初回追加時はレガシーURLをプリフィル
                    defaultUrl={draft.videos.length === 0 && deletedVideos.length === 0 ? user.featuredVideoUrl ?? "" : ""}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {draft.videos.length > 0 || deletedVideos.length > 0 ? (
              <div className="space-y-2">
                {draft.videos.map((video, index) => {
                  const thumbnail = getYouTubeThumbnailUrl(video.url);
                  const rowError = fieldErrors.videos?.[video.key];
                  const videoLabel = video.title || t("meEdit.videoNoTitle");
                  const pending = video.id === null || isVideoEdited(video);
                  return (
                    <div key={video.key} className="space-y-1">
                      <div className="flex items-center gap-3 p-3 border rounded-lg">
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
                            {pending && <PendingBadge>{t("meEdit.unsavedBadge")}</PendingBadge>}
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
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("meEdit.moveUpItemAria", { label: videoLabel })}
                            type="button"
                            disabled={isSubmitting || index === 0}
                            onClick={() => handleVideoMove(video.key, "up")}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("meEdit.moveDownItemAria", { label: videoLabel })}
                            type="button"
                            disabled={isSubmitting || index === draft.videos.length - 1}
                            onClick={() => handleVideoMove(video.key, "down")}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" type="button" aria-label={t("meEdit.editItemAria", { label: videoLabel })} disabled={isSubmitting} onClick={() => handleOpenVideoEdit(video)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" type="button" aria-label={t("meEdit.removeItemAria", { label: videoLabel })} disabled={isSubmitting} onClick={() => handleVideoRemove(video.key)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {rowError && <p className="text-xs text-destructive">{rowError}</p>}
                    </div>
                  );
                })}
                {deletedVideos.map((video) => (
                  <div
                    key={video.key}
                    className="flex items-center justify-between gap-3 p-3 border border-dashed rounded-lg opacity-70"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate line-through">
                        {video.title || t("meEdit.videoNoTitle")}
                      </p>
                      <p className="text-xs text-muted-foreground truncate line-through">{video.url}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <PendingBadge>{t("meEdit.pendingDeleteBadge")}</PendingBadge>
                      <UndoButton
                        onClick={() => handleVideoRestore(video)}
                        disabled={isSubmitting || draft.videos.length >= MAX_PROFILE_VIDEOS}
                        title={draft.videos.length >= MAX_PROFILE_VIDEOS ? t("meEdit.restoreBlockedVideoLimit") : undefined}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Video className="h-12 w-12 mx-auto mb-2 opacity-50" />
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
                <SelectTrigger id="profileVisibility" className="w-full">
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
                <SelectTrigger id="defaultProfileTab" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELECTABLE_PROFILE_TABS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(DEFAULT_PROFILE_TAB_LABEL_KEYS[value])}
                    </SelectItem>
                  ))}
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
        <UnsavedChangesDialog blocker={blocker} />
      </div>

      {/* Social Links Section（下書き。保存バーで一括保存） */}
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
                <Button variant="outline" size="sm" onClick={handleOpenCreate} disabled={isSubmitting}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("meEdit.add")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <SocialLinkDialog
                  // 開くたびに再マウントし、非制御入力の前回状態が持ち越されないようにする
                  key={`${isDialogOpen}-${editingLink?.key ?? "new"}`}
                  editingLink={editingLink}
                  otherPlatforms={draft.links
                    .filter((l) => l.key !== editingLink?.key && l.platform !== "custom")
                    .map((l) => l.platform)}
                  onSubmit={handleLinkSubmit}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {draft.links.length > 0 || deletedLinks.length > 0 ? (
            <div className="space-y-2">
              {draft.links.map((link) => {
                const platformLabel = link.platform === "custom" && link.customLabel
                  ? link.customLabel
                  : platformOptions.find((p) => p.value === link.platform)?.label ?? link.platform;
                const url = getPlatformUrl(link.platform, link.identifier, link.customUrl || null);
                const rowError = fieldErrors.links?.[link.key];
                const pending = link.id === null || isLinkEdited(link);
                return (
                  <div key={link.key} className="space-y-1">
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3 min-w-0">
                        {getPlatformIcon(link.platform)}
                        <div className="min-w-0">
                          <p className="font-medium flex items-center gap-2">
                            {platformLabel}
                            {pending && <PendingBadge>{t("meEdit.unsavedBadge")}</PendingBadge>}
                          </p>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-muted-foreground hover:underline"
                            >
                              {link.identifier}
                            </a>
                          ) : (
                            <span className="text-sm text-muted-foreground">{link.identifier}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {link.id !== null && isLinkEdited(link) && (
                          <UndoButton onClick={() => handleLinkUndoEdit(link.key)} disabled={isSubmitting} />
                        )}
                        <Button variant="ghost" size="icon" type="button" aria-label={t("meEdit.editItemAria", { label: platformLabel })} disabled={isSubmitting} onClick={() => handleOpenEdit(link)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" type="button" aria-label={t("meEdit.removeItemAria", { label: platformLabel })} disabled={isSubmitting} onClick={() => handleLinkRemove(link.key)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {rowError && <p className="text-xs text-destructive">{rowError}</p>}
                  </div>
                );
              })}
              {deletedLinks.map((link) => {
                const platformLabel = link.platform === "custom" && link.customLabel
                  ? link.customLabel
                  : platformOptions.find((p) => p.value === link.platform)?.label ?? link.platform;
                return (
                  <div
                    key={link.key}
                    className="flex items-center justify-between gap-3 p-3 border border-dashed rounded-lg opacity-70"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {getPlatformIcon(link.platform)}
                      <div className="min-w-0">
                        <p className="font-medium line-through">{platformLabel}</p>
                        <p className="text-sm text-muted-foreground line-through truncate">{link.identifier}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <PendingBadge>{t("meEdit.pendingDeleteBadge")}</PendingBadge>
                      <UndoButton
                        onClick={() => handleLinkRestore(link)}
                        disabled={isSubmitting || isRestoreBlocked(link)}
                        title={isRestoreBlocked(link) ? t("meEdit.restoreBlockedPlatform") : undefined}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Share2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
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
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 border border-destructive/30 rounded-lg bg-destructive/5">
            <div className="min-w-0 flex-1 basis-56">
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
                        {hasChanges && <> {t("meEdit.deleteDiscardNote")}</>}
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
                      // 削除後の遷移を未保存警告（useBlocker）に止められないよう、下書きを先に破棄する
                      onClick={handleReset}
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
