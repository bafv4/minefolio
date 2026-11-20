import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLoaderData, useFetcher, useRouteLoaderData, type ShouldRevalidateFunctionArgs } from "react-router";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { MeChecklist } from "@/components/me/me-checklist";
import type { Route } from "./+types/edit";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { isTranslationEnabled } from "@/lib/translate.server";
import { users, socialLinks, profileVideos } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { safeExternalHref } from "@/lib/safe-url";
import { getYouTubeThumbnailUrl } from "@/lib/youtube-url";
import { CAPE_DISPLAY_OPTIONS, resolveCapeProps, type CapeDisplay } from "@/lib/cape";
import { AGE_GROUP_VALUES, parseAgeGroup } from "@/lib/age-group";
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
import { Card, CardContent } from "@/components/ui/card";
import { PageSection } from "@/components/page-section";
import { EmptyState } from "@/components/empty-state";
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
  DialogClose,
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
  });

  if (!user) {
    throw new Response(t("meEdit.userNotFound"), { status: 404 });
  }

  const userRow = user;

  // 自動翻訳が無効（ANTHROPIC_API_KEY 未設定）のときは許可スイッチを出さない（真偽値だけをクライアントへ渡す）
  const translationEnabled = isTranslationEnabled();

  return {
    // 年代は既知の値だけを返す（未知の値は未設定として扱う）
    user: { ...userRow, ageGroup: parseAgeGroup(userRow.ageGroup) ?? null },
    links: user.socialLinks,
    videos: user.profileVideos,
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
  // `_action` が送られているのに `save_all` 以外（古いタブが送る import_legacy / delete_account など）は、
  // 保存したと偽らずエラーにする。未指定（従来の保存）は下の経路のまま
  const actionType = formData.get("_action");
  if (actionType !== null && actionType !== "save_all") {
    return { error: t("meEdit.invalidOption") };
  }
  // プロフィール情報の更新（保存バーの一括保存。`save_all` と `_action` 未指定は同じ経路）。
  // 本体は app/lib/profile-edit.server.ts。`changes`（JSON）に MCID・リンク・動画の差分が載る。
  // このページの項目だけを送る（公開範囲・既定タブ・表示設定は /me/account。profile-edit-scope.ts）
  return saveProfileBatch({ db, t, user, formData });
}

// Radix Select は空文字を value にできないため、「未設定」項目用の番兵値を使う（状態上は "" に正規化する）
const RTA_STARTED_NONE = "none";
const AGE_GROUP_NONE = "none";

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
  { value: "speedruncom", label: "Speedrun.com", placeholderKey: "meEdit.linkPlaceholderExample" as const, prefix: "speedrun.com/users/" },
  { value: "youtube", label: "YouTube", placeholderKey: "meEdit.linkPlaceholderExample" as const, prefix: "youtube.com/@" },
  { value: "twitch", label: "Twitch", placeholderKey: "meEdit.linkPlaceholderExample" as const, prefix: "twitch.tv/" },
  { value: "twitter", label: "Twitter/X", placeholderKey: "meEdit.linkPlaceholderExample" as const, prefix: "x.com/" },
  { value: "custom", label: null, labelKey: "meEdit.customSns" as const, placeholderKey: null, prefix: "" },
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
                maxLength={PROFILE_FIELD_LIMITS.customLabel}
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
                maxLength={PROFILE_FIELD_LIMITS.customUrl}
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
              placeholder={currentOption?.placeholderKey ? t(currentOption.placeholderKey) : t("meEdit.linkPlaceholderUsername")}
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
        <DialogClose asChild>
          <Button type="button" variant="outline">{t("meEdit.cancel")}</Button>
        </DialogClose>
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
        <DialogClose asChild>
          <Button type="button" variant="outline">{t("meEdit.cancel")}</Button>
        </DialogClose>
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
      <Button variant="ghost" size="sm" type="button" className="min-h-11 sm:min-h-8" onClick={onClick} disabled={disabled}>
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        {t("meEdit.undoChange")}
      </Button>
    </span>
  );
}

export default function EditProfilePage() {
  const t = useT();
  // 「はじめに」（MeChecklist、first）が出ている間は、MCID 欄を first にしない（罫線の無い欄が2つ続くため）
  // 閉じた直後は loader を再取得しない（記録は素の fetch）ので、閉じたことはこの画面の状態で持つ
  const [checklistDismissed, setChecklistDismissed] = useState(false);
  const layoutData = useRouteLoaderData("routes/me/_layout") as { checklist?: unknown } | undefined;
  const hasChecklist = !checklistDismissed && layoutData?.checklist != null;
  const locale = useLocale();
  const { user, links, videos, translationEnabled } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  // MCID・リンク・動画は保存バーで保存するまで下書き（draft）にだけ持ち、保存時に差分を1リクエストで送る
  // （docs/profiles.md「/me/edit の保存方式」）。savedDraft は dirty 判定・取り消しの基準
  const loaderDraft = useMemo(() => buildProfileDraft({ user, links, videos }), [user, links, videos]);
  const [draft, setDraft] = useState<ProfileDraft>(loaderDraft);
  const [savedDraft, setSavedDraft] = useState<ProfileDraft>(loaderDraft);
  // 保存時にサーバーが返した検証エラー（MCID・リンク行・動画行）
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isVideoDialogOpen, setIsVideoDialogOpen] = useState(false);
  const [isMcidDialogOpen, setIsMcidDialogOpen] = useState(false);
  const [isBedrockMcidDialogOpen, setIsBedrockMcidDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<DraftLink | null>(null);
  const [editingVideo, setEditingVideo] = useState<DraftVideo | null>(null);
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
    ageGroup: user.ageGroup ?? "",
    ageGroupPublic: (user.ageGroup ?? null) !== null && user.ageGroupPublic,
    profilePose: (user.profilePose as PoseName) ?? "waving",
    slimSkin: user.slimSkin ?? false,
    capeDisplay: (user.capeDisplay as CapeDisplay) ?? "cape",
    mainPlatform: user.mainPlatform ?? "",
    role: user.role ?? "",
    shortBio: user.shortBio ?? "",
    rtaStartedYear: initialRtaStartedYear,
    rtaStartedMonth: initialRtaStartedMonth,
    speedruncomUsername: user.speedruncomUsername ?? "",
    allowAutoTranslation: user.allowAutoTranslation ?? true,
  });

  // カスタムスキン/マントの URL。アップローダーが API 経由で即時保存するので、完了時にここだけ更新する
  // （ページ再読込や loader 再検証をすると未保存の下書きが消えるため、loader の値を初期値にローカルで持つ）
  const [customSkinUrl, setCustomSkinUrl] = useState<string | null>(user.customSkinUrl);
  const [customCapeUrl, setCustomCapeUrl] = useState<string | null>(user.customCapeUrl);

  const [formValues, setFormValues] = useState(buildFormValues);

  // Radix の SelectValue は SSR で選択中の項目の文字を描けないため、今の値の表示文字を明示して渡す
  const selectedAgeGroup = parseAgeGroup(formValues.ageGroup);
  const mainPlatformLabels: Record<string, string> = {
    pc_windows: t("playerProfile.platformPcWindows"),
    pc_mac: t("playerProfile.platformPcMac"),
    pc_linux: t("playerProfile.platformPcLinux"),
    switch: "Switch",
    mobile: t("meEdit.mobile"),
    other: t("meEdit.other"),
  };
  const roleLabels: Record<string, string> = {
    runner: t("meEdit.roleRunner"),
    viewer: t("meEdit.roleViewer"),
  };

  // エラーの欄へスクロールしてフォーカスする（保存バーの裏は scroll-padding が避ける）。
  // 対象が描画されていなければ何もしない
  const focusErrorTarget = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      el.focus({ preventScroll: true });
    });
  }, []);
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
      focusErrorTarget(rtaStartedYear ? "rtaStartedMonth" : "rtaStartedYear");
      return;
    }

    const formData = new FormData();
    formData.set("_action", "save_all");
    formData.set("displayName", formValues.displayName);
    formData.set("displayNameAlphabet", formValues.displayNameAlphabet);
    formData.set("bio", formValues.bio);
    formData.set("location", formValues.location);
    formData.set("pronouns", formValues.pronouns);
    formData.set("ageGroup", formValues.ageGroup);
    formData.set("ageGroupPublic", String(formValues.ageGroup !== "" && formValues.ageGroupPublic));
    formData.set("profilePose", formValues.profilePose);
    formData.set("slimSkin", String(formValues.slimSkin));
    formData.set("capeDisplay", formValues.capeDisplay);
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
  }, [fetcher, formValues, draft, savedDraft, isRtaStartedIncomplete, t, translationEnabled, focusErrorTarget]);

  // ポーズ変更を同期
  useEffect(() => {
    setFormValues((prev) => ({ ...prev, profilePose: selectedPose }));
  }, [selectedPose]);

  // ポーズプレビュー用のマント。capeDisplay は保存前のフォーム値を使う（選択が即プレビューに反映される）
  const capeProps = resolveCapeProps({
    uuid: user.uuid,
    customCapeUrl: customCapeUrl,
    capeDisplay: formValues.capeDisplay,
  });

  // 保存中〜保存後の再取得（loading）が終わるまでは idle にならない（二重送信で新規行が重複するのを防ぐ）
  const isSubmitting = fetcher.state !== "idle";
  const data = fetcher.data;

  const prevDataRef = useRef<typeof fetcher.data>(undefined);

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
      const errors = ("fieldErrors" in data && data.fieldErrors) || {};
      setFieldErrors(errors);
      // ページ順（MCID → Bedrock → リンク → 動画）で最初のエラー欄へ連れて行く
      const firstLink = latestDraftRef.current.draft.links.find((l) => errors.links?.[l.key]);
      const firstVideo = latestDraftRef.current.draft.videos.find((v) => errors.videos?.[v.key]);
      const targetId = errors.mcid
        ? "edit-error-mcid"
        : errors.bedrockMcid
          ? "edit-error-bedrockMcid"
          : firstLink
            ? `edit-error-link-${firstLink.key}`
            : firstVideo
              ? `edit-error-video-${firstVideo.key}`
              : null;
      if (targetId) focusErrorTarget(targetId);
    }
  }, [data, focusErrorTarget]);

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
    <div className="space-y-7 pb-24 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("meEdit.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("meEdit.pageDescription")}
        </p>
      </div>

      <MeChecklist onDismiss={() => setChecklistDismissed(true)} />

      <div className="space-y-7 sm:space-y-8">
        {/* MCID & Skin Section（ツアーの「プロフィール編集」の指す先） */}
        <div data-me-tour="edit-form">
        <PageSection
          id="edit-mcid-skin"
          first={!hasChecklist}
          title={t("meEdit.mcidSkinTitle")}
          className="space-y-6"
        >
            <p className="-mt-2 text-sm text-muted-foreground">{t("meEdit.mcidSkinDesc")}</p>
            {/* MCID設定（下書き。保存バーで保存するまで反映されない） */}
            <div className="space-y-3">
              <h3 className="text-base font-semibold">{t("meEdit.minecraftIdTitle")}</h3>
              {draft.mcid.value ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0">
                      <MinecraftAvatar uuid={draft.mcid.uuid} skinUrl={customSkinUrl} size={64} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium break-all">@{draft.mcid.value}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        UUID: {draft.mcid.uuid}
                      </p>
                      {isMcidChanged && <PendingBadge>{t("meEdit.unsavedBadge")}</PendingBadge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {isMcidChanged && <UndoButton onClick={handleMcidUndo} disabled={isSubmitting} />}
                    {renderMcidDialog(
                      <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={isSubmitting}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {t("meEdit.change")}
                      </Button>,
                    )}
                    <Button variant="ghost" size="sm" type="button" className="min-h-11 sm:min-h-8" onClick={handleMcidRemove} disabled={isSubmitting}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("meEdit.delete")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {savedDraft.mcid.value ? t("meEdit.mcidPendingRemove") : t("meEdit.mcidNotConfigured")}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    {isMcidChanged && <UndoButton onClick={handleMcidUndo} />}
                    {renderMcidDialog(
                      <Button size="sm" className="min-h-11 sm:min-h-8" disabled={isSubmitting}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t("meEdit.setMcid")}
                      </Button>,
                    )}
                  </div>
                </div>
              )}
              {fieldErrors.mcid && (
                <Alert variant="destructive" id="edit-error-mcid" tabIndex={-1}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{fieldErrors.mcid}</AlertDescription>
                </Alert>
              )}
            </div>

            <Separator />

            {/* Bedrock版MCID（Xboxゲーマータグ）。自己申告のためMojang検証はせず、slug・スキンには影響しない。下書き（保存バーで保存するまで反映されない） */}
            <div className="space-y-3">
              <h3 className="text-base font-semibold">{t("meEdit.bedrockMcidTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("meEdit.bedrockMcidDesc")}</p>
              <div className="flex flex-wrap items-center justify-between gap-3">
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
                      <Button variant={draft.bedrockMcid ? "outline" : "default"} size="sm" className="min-h-11 sm:min-h-8" disabled={isSubmitting}>
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
                        <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" disabled={isSubmitting}>
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
                <Alert variant="destructive" id="edit-error-bedrockMcid" tabIndex={-1}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{fieldErrors.bedrockMcid}</AlertDescription>
                </Alert>
              )}
            </div>

            <Separator />

            {/* Custom Skin Upload */}
            <div className="space-y-3">
              <h3 className="text-base font-semibold">{t("skinUploader.customSkinTitle")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("skinUploader.customSkinDesc")}
              </p>
              {customSkinUrl && (
                <Alert className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t("skinUploader.customSkinActive")}
                  </AlertDescription>
                </Alert>
              )}
              <SkinUploader
                userId={user.id}
                currentSkinUrl={customSkinUrl}
                onUploadComplete={(url) => setCustomSkinUrl(url)}
                onDelete={() => setCustomSkinUrl(null)}
              />
            </div>

            <Separator />

            {/* Custom Cape Upload */}
            <div className="space-y-3">
              <h3 className="text-base font-semibold">{t("capeUploader.customCapeTitle")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("capeUploader.customCapeDesc")}
              </p>
              {customCapeUrl && (
                <Alert className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t("capeUploader.customCapeActive")}
                  </AlertDescription>
                </Alert>
              )}
              <CapeUploader
                userId={user.id}
                currentCapeUrl={customCapeUrl}
                onUploadComplete={(url) => setCustomCapeUrl(url)}
                onDelete={() => setCustomCapeUrl(null)}
              />
              {/* スキンとマントの両方に当てはまる注意なので、2つのアップロード欄の後に1回だけ出す */}
              <p className="text-xs text-muted-foreground">{t("meEdit.uploadImmediateNote")}</p>
            </div>

            {/* Pose Selection - show when user has uuid OR custom skin */}
            {(user.uuid || customSkinUrl) && (
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
                          ? "border-brand bg-brand/5"
                          : "border-muted hover:border-muted-foreground/30"
                          }`}
                      >
                        <div className="w-16 h-24">
                          <MinecraftFullBody
                            uuid={user.uuid ?? undefined}
                            skinUrl={customSkinUrl ?? undefined}
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
                  className={`min-h-11 px-4 text-sm rounded-md transition-colors sm:min-h-8 sm:py-1.5 ${!formValues.slimSkin
                    ? "bg-brand text-brand-foreground"
                    : "hover:bg-muted"
                    }`}
                >
                  {t("meEdit.skinModelDefault")}
                </RadioGroupPrimitive.Item>
                <RadioGroupPrimitive.Item
                  value="slim"
                  className={`min-h-11 px-4 text-sm rounded-md transition-colors sm:min-h-8 sm:py-1.5 ${formValues.slimSkin
                    ? "bg-brand text-brand-foreground"
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
                    className={`min-h-11 px-4 text-sm rounded-md transition-colors sm:min-h-8 sm:py-1.5 ${formValues.capeDisplay === option
                      ? "bg-brand text-brand-foreground"
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
        </PageSection>
        </div>

        {/* Basic Info */}
        <PageSection id="edit-basic" title={t("meEdit.basicInfo")} className="space-y-4">
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
                  className="h-11 sm:h-9"
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

            <div className="space-y-3">
              <div className="space-y-2 sm:max-w-sm">
                <Label htmlFor="ageGroup">{t("meEdit.ageGroup")}</Label>
                <Select
                  value={formValues.ageGroup === "" ? AGE_GROUP_NONE : formValues.ageGroup}
                  onValueChange={(value) =>
                    setFormValues((prev) =>
                      value === AGE_GROUP_NONE
                        ? { ...prev, ageGroup: "", ageGroupPublic: false }
                        : { ...prev, ageGroup: value },
                    )
                  }
                >
                  <SelectTrigger id="ageGroup" className="w-full">
                    <SelectValue>
                      {selectedAgeGroup ? t(`meEdit.ageGroupLabels.${selectedAgeGroup}`) : t("meEdit.ageGroupNone")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AGE_GROUP_NONE}>{t("meEdit.ageGroupNone")}</SelectItem>
                    {AGE_GROUP_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`meEdit.ageGroupLabels.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="ageGroupPublic" className="text-sm font-normal cursor-pointer">
                    {t("meEdit.ageGroupPublic")}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t("meEdit.ageGroupPublicHint")}</p>
                </div>
                <Switch
                  id="ageGroupPublic"
                  checked={formValues.ageGroup !== "" && formValues.ageGroupPublic}
                  disabled={formValues.ageGroup === ""}
                  onCheckedChange={(checked) => setFormValues((prev) => ({ ...prev, ageGroupPublic: checked }))}
                />
              </div>
            </div>

            {translationEnabled && (
              <div className="flex items-start justify-between gap-4">
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
                      <SelectValue placeholder={t("meEdit.rtaStartedYearPlaceholder")}>
                        {/* 未選択（""）は undefined にして placeholder を出す（Number("") で「0年」にしない） */}
                        {formValues.rtaStartedYear
                          ? t("meEdit.rtaStartedYearOption", { year: Number(formValues.rtaStartedYear) })
                          : undefined}
                      </SelectValue>
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
                      <SelectValue placeholder={t("meEdit.rtaStartedMonthPlaceholder")}>
                        {/* 未選択（""）は undefined にして placeholder を出す（Number("") で「0月」にしない） */}
                        {formValues.rtaStartedMonth
                          ? t("meEdit.rtaStartedMonthOption", { month: Number(formValues.rtaStartedMonth) })
                          : undefined}
                      </SelectValue>
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
                    className="size-11 shrink-0 text-muted-foreground sm:size-9"
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
                    <SelectValue placeholder={t("meEdit.select")}>
                      {mainPlatformLabels[formValues.mainPlatform]}
                    </SelectValue>
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
                    <SelectValue placeholder={t("meEdit.select")}>
                      {roleLabels[formValues.role]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="runner">{t("meEdit.roleRunner")}</SelectItem>
                    <SelectItem value="viewer">{t("meEdit.roleViewer")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

        </PageSection>

        {/* Speedrun.com連携 */}
        <PageSection
          id="edit-speedrun"
          icon={<ExternalLink className="h-5 w-5 text-primary" aria-hidden="true" />}
          title={t("meEdit.speedrunIntegration")}
        >
            <p className="text-sm text-muted-foreground">{t("meEdit.speedrunIntegrationDesc")}</p>
            {/* 設定の入口はソーシャルリンクの Speedrun.com だけ。ここは読み取り結果の表示（下書きのリンクに追従する） */}
            <p className="text-sm" id="speedruncom-linked">
              {formValues.speedruncomUsername ? (
                t("meEdit.speedrunLinkedFrom", { username: formValues.speedruncomUsername })
              ) : (
                <span className="text-muted-foreground">{t("meEdit.speedrunLinkedNone")}</span>
              )}
            </p>
        </PageSection>

        {/* Social Links Section（下書き。保存バーで一括保存） */}
        <PageSection
          id="edit-social"
          icon={<Share2 className="h-5 w-5 text-primary" aria-hidden="true" />}
          title={t("meEdit.socialLinks")}
          action={
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={handleOpenCreate} disabled={isSubmitting}>
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
          }
        >
            <p className="text-sm text-muted-foreground">{t("meEdit.socialLinksDesc")}</p>
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
                          <Button variant="ghost" size="icon" type="button" className="size-11 sm:size-9" aria-label={t("meEdit.editItemAria", { label: platformLabel })} disabled={isSubmitting} onClick={() => handleOpenEdit(link)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" type="button" className="size-11 sm:size-9" aria-label={t("meEdit.removeItemAria", { label: platformLabel })} disabled={isSubmitting} onClick={() => handleLinkRemove(link.key)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {rowError && (
                        <p id={`edit-error-link-${link.key}`} tabIndex={-1} className="text-xs text-destructive">
                          {rowError}
                        </p>
                      )}
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
              <EmptyState
                size="compact"
                icon={<Share2 className="h-5 w-5" />}
                title={t("meEdit.noSocialLinks")}
                description={t("meEdit.noSocialLinksHint")}
              />
            )}
        </PageSection>

        {/* Videos（複数動画欄。旧「おすすめ動画」featuredVideoUrl の後継）。下書き（保存バーで一括保存） */}
        <PageSection
          id="edit-videos"
          icon={<Video className="h-5 w-5 text-primary" aria-hidden="true" />}
          title={t("meEdit.videos")}
          action={
              <Dialog open={isVideoDialogOpen} onOpenChange={setIsVideoDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-8"
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
          }
        >
            <p className="text-sm text-muted-foreground">{t("meEdit.videosDesc")}</p>
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
                            className="size-11 sm:size-9"
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
                            className="size-11 sm:size-9"
                            aria-label={t("meEdit.moveDownItemAria", { label: videoLabel })}
                            type="button"
                            disabled={isSubmitting || index === draft.videos.length - 1}
                            onClick={() => handleVideoMove(video.key, "down")}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" type="button" className="size-11 sm:size-9" aria-label={t("meEdit.editItemAria", { label: videoLabel })} disabled={isSubmitting} onClick={() => handleOpenVideoEdit(video)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" type="button" className="size-11 sm:size-9" aria-label={t("meEdit.removeItemAria", { label: videoLabel })} disabled={isSubmitting} onClick={() => handleVideoRemove(video.key)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {rowError && (
                        <p id={`edit-error-video-${video.key}`} tabIndex={-1} className="text-xs text-destructive">
                          {rowError}
                        </p>
                      )}
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
              <EmptyState
                size="compact"
                icon={<Video className="h-5 w-5" />}
                title={t("meEdit.noVideos")}
                description={user.featuredVideoUrl ? t("meEdit.noVideosLegacyHint") : t("meEdit.noVideosHint")}
              />
            )}
        </PageSection>

        {/* Floating Save Bar（離脱時の警告も保存バーが持つ） */}
        <FloatingSaveBar
          hasChanges={hasChanges}
          isSubmitting={isSubmitting}
          saveResult={fetcher.data}
          saveSucceeded={fetcher.data != null && "success" in fetcher.data && fetcher.data.success === true}
          onSave={handleSave}
          onReset={handleReset}
        />
      </div>
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
