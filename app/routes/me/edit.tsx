import { useEffect, useRef, useState, useCallback } from "react";
import { useLoaderData, useFetcher, redirect, useParams, type ShouldRevalidateFunctionArgs } from "react-router";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import type { Route } from "./+types/edit";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, socialLinks, authUsers, authSessions, authAccounts } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { importFromLegacy } from "@/lib/legacy-import";
import { createId } from "@paralleldrive/cuid2";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { MinecraftFullBody } from "@/components/minecraft-fullbody";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";
import type { PoseName } from "@/components/minecraft-fullbody";

export const meta: Route.MetaFunction = () => {
  return [{ title: "プロフィール編集 - Minefolio" }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  return false;
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      socialLinks: {
        orderBy: [asc(socialLinks.displayOrder)],
      },
      keybindings: true,
      playerConfig: true,
      itemLayouts: true,
      searchCrafts: true,
      keyRemaps: true,
    },
  });

  if (!user) {
    throw new Response("ユーザーが見つかりません", { status: 404 });
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

  return { user, links: user.socialLinks, legacyApiUrl, hasExistingData };
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

export async function action({ context, request }: Route.ActionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return { error: "ユーザーが見つかりません" };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  // レガシーインポート
  if (actionType === "import_legacy") {
    const legacyApiUrl = env.LEGACY_API_URL;
    if (!legacyApiUrl) {
      return { error: "レガシーAPIが設定されていません", action: "import" };
    }

    const result = await importFromLegacy(db, user.id, legacyApiUrl, user.mcid);
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
      return { error: result.error ?? "インポートに失敗しました", action: "import" };
    }
  }

  // ソーシャルリンクの操作
  if (actionType === "create_link" || actionType === "update_link") {
    const id = formData.get("id") as string | null;
    const platform = formData.get("platform") as "speedruncom" | "youtube" | "twitch" | "twitter";
    const identifier = (formData.get("identifier") as string)?.trim();

    if (!platform || !identifier) {
      return { error: "プラットフォームとIDは必須です" };
    }

    // 長さチェック
    if (identifier.length > 100) {
      return { error: "IDは100文字以下にしてください" };
    }

    // IDの形式をバリデーション（より厳格なチェック）
    // 英数字、ハイフン、アンダースコアのみ許可（@と.は除外）
    if (!/^[\w\-]+$/.test(identifier)) {
      return { error: "IDには英数字、ハイフン、アンダースコアのみ使用できます" };
    }

    // 先頭と末尾のハイフン/アンダースコアを禁止
    if (/^[-_]|[-_]$/.test(identifier)) {
      return { error: "IDの先頭と末尾にハイフンやアンダースコアは使用できません" };
    }

    try {
      if (actionType === "create_link") {
        // 同じプラットフォームの既存リンクがあるか確認
        const existingPlatform = await db.query.socialLinks.findFirst({
          where: (links, { and, eq: eqOp }) => and(
            eqOp(links.userId, user.id),
            eqOp(links.platform, platform)
          ),
        });

        if (existingPlatform) {
          return { error: `${platform}のリンクは既に登録されています。編集から更新してください。` };
        }

        await db.insert(socialLinks).values({
          id: createId(),
          userId: user.id,
          platform,
          identifier,
        });

        // Speedrun.comの場合、speedruncomUsernameも自動設定
        if (platform === "speedruncom") {
          await db
            .update(users)
            .set({ speedruncomUsername: identifier, updatedAt: new Date() })
            .where(eq(users.id, user.id));
        }
      } else if (id) {
        // 更新時に別のプラットフォームに変更する場合、重複チェック
        const existingPlatform = await db.query.socialLinks.findFirst({
          where: (links, { and, eq: eqOp, ne }) => and(
            eqOp(links.userId, user.id),
            eqOp(links.platform, platform),
            ne(links.id, id)
          ),
        });

        if (existingPlatform) {
          return { error: `${platform}のリンクは既に登録されています。` };
        }

        // 更新前のリンク情報を取得
        const oldLink = await db.query.socialLinks.findFirst({
          where: eq(socialLinks.id, id),
        });

        await db
          .update(socialLinks)
          .set({ platform, identifier, updatedAt: new Date() })
          .where(eq(socialLinks.id, id));

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
        return { error: "このプラットフォームのリンクは既に登録されています" };
      }
      return { error: "リンクの保存に失敗しました" };
    }
  }

  if (actionType === "delete_link") {
    const id = formData.get("id") as string;
    if (id) {
      // 削除前にリンク情報を取得
      const linkToDelete = await db.query.socialLinks.findFirst({
        where: eq(socialLinks.id, id),
      });

      await db.delete(socialLinks).where(eq(socialLinks.id, id));

      // Speedrun.comリンクを削除した場合、speedruncomUsernameもクリア
      if (linkToDelete?.platform === "speedruncom") {
        await db
          .update(users)
          .set({ speedruncomUsername: null, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      }
    }
    return { success: true, action: "link" };
  }

  // アカウント削除
  if (actionType === "delete_account") {
    const confirmMcid = (formData.get("confirmMcid") as string)?.trim();

    if (confirmMcid !== user.mcid) {
      return { error: "MCIDが一致しません", action: "delete" };
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
  const bio = (formData.get("bio") as string)?.trim() || null;
  const location = (formData.get("location") as string)?.trim() || null;
  const pronouns = (formData.get("pronouns") as string)?.trim() || null;
  const profileVisibility = formData.get("profileVisibility") as "public" | "unlisted" | "private";
  const profilePose = formData.get("profilePose") as "standing" | "walking" | "waving";
  const defaultProfileTab = formData.get("defaultProfileTab") as "keybindings" | "stats" | "devices" | "settings";
  const featuredVideoUrl = (formData.get("featuredVideoUrl") as string)?.trim() || null;
  const mainEdition = (formData.get("mainEdition") as "java" | "bedrock") || null;
  const mainPlatform = (formData.get("mainPlatform") as "pc_windows" | "pc_mac" | "pc_linux" | "switch" | "mobile" | "other") || null;
  const role = (formData.get("role") as "viewer" | "runner") || null;
  const shortBio = (formData.get("shortBio") as string)?.trim() || null;
  const speedruncomUsername = (formData.get("speedruncomUsername") as string)?.trim() || null;

  // Validate
  if (displayName && displayName.length > 50) {
    return { error: "表示名は50文字以下にしてください" };
  }

  if (bio && bio.length > 500) {
    return { error: "自己紹介は500文字以下にしてください" };
  }

  if (location && location.length > 100) {
    return { error: "場所は100文字以下にしてください" };
  }

  if (featuredVideoUrl) {
    try {
      const videoUrl = new URL(featuredVideoUrl);

      // プロトコルチェック: http/https のみ許可
      if (!videoUrl.protocol.startsWith('http')) {
        return { error: "動画URLの形式が正しくありません" };
      }

      // 許可されたYouTubeホスト名のリスト
      const allowedYouTubeHosts = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'];

      if (!allowedYouTubeHosts.includes(videoUrl.hostname)) {
        return { error: "動画URLはYouTubeのURLを入力してください（youtube.com, youtu.be のみ）" };
      }
    } catch {
      return { error: "動画URLの形式が正しくありません" };
    }
  }

  if (shortBio && shortBio.length > 50) {
    return { error: "ひとことは50文字以下にしてください" };
  }

  if (speedruncomUsername && speedruncomUsername.length > 50) {
    return { error: "Speedrun.comユーザー名は50文字以下にしてください" };
  }

  await db
    .update(users)
    .set({
      displayName,
      bio,
      location,
      pronouns,
      profileVisibility,
      profilePose,
      defaultProfileTab,
      featuredVideoUrl,
      mainEdition,
      mainPlatform,
      role,
      shortBio,
      speedruncomUsername,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return { success: true, action: "profile" };
}

const platformOptions = [
  { value: "speedruncom", label: "Speedrun.com", placeholder: "例: couriern3w", prefix: "speedrun.com/users/" },
  { value: "youtube", label: "YouTube", placeholder: "例: @couriern3w", prefix: "youtube.com/" },
  { value: "twitch", label: "Twitch", placeholder: "例: couriern3w", prefix: "twitch.tv/" },
  { value: "twitter", label: "Twitter/X", placeholder: "例: couriern3w", prefix: "x.com/" },
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
    default:
      return <ExternalLink className="h-4 w-4" />;
  }
}

function getPlatformUrl(platform: string, identifier: string): string {
  switch (platform) {
    case "speedruncom":
      return `https://www.speedrun.com/users/${identifier}`;
    case "youtube":
      return `https://www.youtube.com/${identifier}`;
    case "twitch":
      return `https://www.twitch.tv/${identifier}`;
    case "twitter":
      return `https://x.com/${identifier}`;
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
  editingLink: { id: string; platform: string; identifier: string } | null;
  linkFetcher: ReturnType<typeof useFetcher<typeof action>>;
  isSubmitting: boolean;
}) {
  const [selectedPlatform, setSelectedPlatform] = useState(editingLink?.platform ?? "youtube");

  const currentOption = platformOptions.find((opt) => opt.value === selectedPlatform);

  return (
    <linkFetcher.Form method="post">
      <input type="hidden" name="_action" value={editingLink ? "update_link" : "create_link"} />
      {editingLink && <input type="hidden" name="id" value={editingLink.id} />}
      <DialogHeader>
        <DialogTitle>{editingLink ? "リンクを編集" : "ソーシャルリンクを追加"}</DialogTitle>
        <DialogDescription>
          {editingLink ? "リンクの詳細を更新します。" : "SNSアカウントのIDを入力してください。"}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="platform">プラットフォーム</Label>
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
        <div className="space-y-2">
          <Label htmlFor="link-identifier">ユーザーID</Label>
          <div className="flex items-center">
            <span className="text-sm text-muted-foreground mr-2 shrink-0">
              {currentOption?.prefix}
            </span>
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
            URLではなく、ユーザー名やチャンネルIDを入力してください
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          リンクを{editingLink ? "更新" : "追加"}
        </Button>
      </DialogFooter>
    </linkFetcher.Form>
  );
}

export default function EditProfilePage() {
  const { user, links, legacyApiUrl, hasExistingData } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const linkFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<typeof links[0] | null>(null);
  const [confirmMcid, setConfirmMcid] = useState("");
  const [selectedPose, setSelectedPose] = useState<PoseName>(
    (user.profilePose as PoseName) ?? "waving"
  );
  const [importCompleted, setImportCompleted] = useState(false);

  // フォームの値をトラッキングして変更を検出
  const [formValues, setFormValues] = useState({
    displayName: user.displayName ?? "",
    bio: user.bio ?? "",
    location: user.location ?? "",
    pronouns: user.pronouns ?? "",
    profileVisibility: user.profileVisibility ?? "public",
    profilePose: (user.profilePose as PoseName) ?? "waving",
    defaultProfileTab: user.defaultProfileTab ?? "keybindings",
    featuredVideoUrl: user.featuredVideoUrl ?? "",
    mainEdition: user.mainEdition ?? "",
    mainPlatform: user.mainPlatform ?? "",
    role: user.role ?? "",
    shortBio: user.shortBio ?? "",
    speedruncomUsername: user.speedruncomUsername ?? "",
  });

  const initialFormValues = useRef({
    displayName: user.displayName ?? "",
    bio: user.bio ?? "",
    location: user.location ?? "",
    pronouns: user.pronouns ?? "",
    profileVisibility: user.profileVisibility ?? "public",
    profilePose: (user.profilePose as PoseName) ?? "waving",
    defaultProfileTab: user.defaultProfileTab ?? "keybindings",
    featuredVideoUrl: user.featuredVideoUrl ?? "",
    mainEdition: user.mainEdition ?? "",
    mainPlatform: user.mainPlatform ?? "",
    role: user.role ?? "",
    shortBio: user.shortBio ?? "",
    speedruncomUsername: user.speedruncomUsername ?? "",
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

  // フォームリセット
  const handleReset = useCallback(() => {
    setFormValues(initialFormValues.current);
    setSelectedPose((initialFormValues.current.profilePose as PoseName) ?? "waving");
  }, []);

  // 保存処理
  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("displayName", formValues.displayName);
    formData.set("bio", formValues.bio);
    formData.set("location", formValues.location);
    formData.set("pronouns", formValues.pronouns);
    formData.set("profileVisibility", formValues.profileVisibility);
    formData.set("profilePose", formValues.profilePose);
    formData.set("defaultProfileTab", formValues.defaultProfileTab);
    formData.set("featuredVideoUrl", formValues.featuredVideoUrl);
    formData.set("mainEdition", formValues.mainEdition);
    formData.set("mainPlatform", formValues.mainPlatform);
    formData.set("role", formValues.role);
    formData.set("shortBio", formValues.shortBio);
    formData.set("speedruncomUsername", formValues.speedruncomUsername);
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, formValues]);

  // ポーズ変更を同期
  useEffect(() => {
    setFormValues((prev) => ({ ...prev, profilePose: selectedPose }));
  }, [selectedPose]);

  const isSubmitting = fetcher.state === "submitting";
  const isLinkSubmitting = linkFetcher.state === "submitting";
  const isDeleting = deleteFetcher.state === "submitting";
  const isImporting = importFetcher.state === "submitting";
  const data = fetcher.data;
  const linkData = linkFetcher.data;
  const deleteData = deleteFetcher.data;
  const importData = importFetcher.data;

  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const prevLinkDataRef = useRef<typeof linkFetcher.data>(undefined);
  const prevImportDataRef = useRef<typeof importFetcher.data>(undefined);

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
      toast.success("プロフィールを更新しました");
    } else if ("error" in data && !("action" in data)) {
      toast.error(data.error);
    }
  }, [data]);

  // ソーシャルリンク更新のトースト
  useEffect(() => {
    if (!linkData || linkData === prevLinkDataRef.current) return;
    prevLinkDataRef.current = linkData;

    if ("success" in linkData && linkData.action === "link") {
      toast.success("ソーシャルリンクを更新しました");
      setIsDialogOpen(false);
    } else if ("error" in linkData) {
      toast.error(linkData.error);
    }
  }, [linkData]);

  // インポート結果のトースト
  useEffect(() => {
    if (!importData || importData === prevImportDataRef.current) return;
    prevImportDataRef.current = importData;

    if ("success" in importData && importData.action === "import") {
      const parts: string[] = [];
      if ("keybindingsImported" in importData && (importData.keybindingsImported ?? 0) > 0) {
        parts.push(`キーバインド ${importData.keybindingsImported}件`);
      }
      if ("customKeysImported" in importData && (importData.customKeysImported ?? 0) > 0) {
        parts.push(`カスタムキー ${importData.customKeysImported}件`);
      }
      if ("remapsImported" in importData && (importData.remapsImported ?? 0) > 0) {
        parts.push(`リマップ ${importData.remapsImported}件`);
      }
      if ("fingerAssignmentsImported" in importData && importData.fingerAssignmentsImported) {
        parts.push("指割り当て");
      }
      if ("settingsImported" in importData && importData.settingsImported) {
        parts.push("設定");
      }
      if (parts.length > 0) {
        toast.success(`インポート完了: ${parts.join("、")}`);
      } else {
        toast.success("インポート完了（データなし）");
      }
      setImportCompleted(true);
    } else if ("error" in importData && importData.action === "import") {
      toast.error(importData.error);
    }
  }, [importData]);

  const handleOpenCreate = () => {
    setEditingLink(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (link: typeof links[0]) => {
    setEditingLink(link);
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">プロフィール編集</h1>
        <p className="text-muted-foreground">
          公開プロフィール情報を更新します。
        </p>
      </div>

      {/* Legacy Import Card */}
      {legacyApiUrl && !importCompleted && !hasExistingData && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5" />
              MCSRer Hotkeysからデータをインポート
            </CardTitle>
            <CardDescription>
              以前のMCSRer Hotkeysに登録されたキー配置・設定をインポートできます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <importFetcher.Form method="post">
              <input type="hidden" name="_action" value="import_legacy" />
              <Button type="submit" disabled={isImporting}>
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    インポート中...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    データをインポート
                  </>
                )}
              </Button>
            </importFetcher.Form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {/* Avatar Section */}
        <Card>
          <CardHeader>
            <CardTitle>MCID</CardTitle>
            <CardDescription>
              同期されています。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl overflow-hidden">
                <MinecraftAvatar uuid={user.uuid} size={80} />
              </div>
              <div>
                <p className="font-medium">@{user.mcid}</p>
                <p className="text-sm text-muted-foreground">
                  UUID: {user.uuid}
                </p>
              </div>
            </div>

            {/* Pose Selection */}
            <div className="space-y-3">
              <Label>プロフィールのポーズ</Label>
              <div className="grid grid-cols-3 gap-3">
                {(["standing", "walking", "waving"] as const).map((pose) => (
                  <button
                    key={pose}
                    type="button"
                    onClick={() => setSelectedPose(pose)}
                    className={`relative flex flex-col items-center gap-2 p-2 rounded-lg border-2 transition-colors ${
                      selectedPose === pose
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-muted-foreground/30"
                    }`}
                  >
                    <div className="w-16 h-24">
                      <MinecraftFullBody
                        uuid={user.uuid}
                        width={64}
                        height={96}
                        pose={pose}
                        angle={-35}
                        elevation={5}
                        zoom={0.9}
                        asImage
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {pose === "standing" && "直立"}
                      {pose === "walking" && "歩行"}
                      {pose === "waving" && "手を振る"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>基本情報</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">表示名</Label>
              <Input
                id="displayName"
                value={formValues.displayName}
                onChange={(e) => handleInputChange("displayName", e.target.value)}
                placeholder={user.mcid}
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                空欄の場合はMCIDが使用されます
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">自己紹介</Label>
              <Textarea
                id="bio"
                value={formValues.bio}
                onChange={(e) => handleInputChange("bio", e.target.value)}
                placeholder="自己紹介を入力..."
                maxLength={500}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location">場所</Label>
                <Input
                  id="location"
                  value={formValues.location}
                  onChange={(e) => handleInputChange("location", e.target.value)}
                  placeholder="例: 東京, 日本"
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pronouns">代名詞</Label>
                <Input
                  id="pronouns"
                  value={formValues.pronouns}
                  onChange={(e) => handleInputChange("pronouns", e.target.value)}
                  placeholder="例: he/him"
                  maxLength={20}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shortBio">ひとこと</Label>
              <Input
                id="shortBio"
                value={formValues.shortBio}
                onChange={(e) => handleInputChange("shortBio", e.target.value)}
                placeholder="例: RSG日本記録保持者"
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                プレイヤーカードに表示される短い肩書き
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mainEdition">エディション（メイン）</Label>
                <Select
                  value={formValues.mainEdition}
                  onValueChange={(value) => handleInputChange("mainEdition", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="選択..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="java">Java</SelectItem>
                    <SelectItem value="bedrock">Bedrock</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mainPlatform">プラットフォーム（メイン）</Label>
                <Select
                  value={formValues.mainPlatform}
                  onValueChange={(value) => handleInputChange("mainPlatform", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="選択..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pc_windows">PC（Windows）</SelectItem>
                    <SelectItem value="pc_mac">PC（Mac）</SelectItem>
                    <SelectItem value="pc_linux">PC（Linux）</SelectItem>
                    <SelectItem value="switch">Switch</SelectItem>
                    <SelectItem value="mobile">スマホ</SelectItem>
                    <SelectItem value="other">その他</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">ロール</Label>
                <Select
                  value={formValues.role}
                  onValueChange={(value) => handleInputChange("role", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="選択..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="runner">走者</SelectItem>
                    <SelectItem value="viewer">視聴者</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Speedrun.com連携 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ExternalLink className="h-5 w-5" />
              Speedrun.com 連携
            </CardTitle>
            <CardDescription>
              Speedrun.comのユーザー名を設定すると、Statsタブに記録が表示されます。
              ソーシャルリンクでSpeedrun.comを追加すると自動的に設定されます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="speedruncomUsername">Speedrun.com ユーザー名</Label>
              <div className="flex items-center">
                <span className="text-sm text-muted-foreground mr-2 shrink-0">
                  speedrun.com/users/
                </span>
                <Input
                  id="speedruncomUsername"
                  value={formValues.speedruncomUsername}
                  onChange={(e) => handleInputChange("speedruncomUsername", e.target.value)}
                  placeholder="例: Feinberg"
                  maxLength={50}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                直接入力するか、下のソーシャルリンクでSpeedrun.comを追加してください
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Featured Video */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              おすすめ動画
            </CardTitle>
            <CardDescription>
              プロフィールページに表示したいYouTube動画を設定します。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="featuredVideoUrl">YouTube URL</Label>
              <Input
                id="featuredVideoUrl"
                type="url"
                value={formValues.featuredVideoUrl}
                onChange={(e) => handleInputChange("featuredVideoUrl", e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
              <p className="text-xs text-muted-foreground">
                自己ベスト動画や配信のハイライトなど
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              プロフィール設定
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profileVisibility">公開設定</Label>
              <Select
                value={formValues.profileVisibility}
                onValueChange={(value) => handleInputChange("profileVisibility", value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">
                    公開 - 誰でもプロフィールを検索・閲覧可能
                  </SelectItem>
                  <SelectItem value="unlisted">
                    限定公開 - 直接リンクでのみアクセス可能
                  </SelectItem>
                  <SelectItem value="private">
                    非公開 - 自分だけがプロフィールを閲覧可能
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="defaultProfileTab">デフォルト表示タブ</Label>
              <Select
                value={formValues.defaultProfileTab}
                onValueChange={(value) => handleInputChange("defaultProfileTab", value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keybindings">キー配置</SelectItem>
                  <SelectItem value="stats">Stats</SelectItem>
                  <SelectItem value="devices">デバイス・設定</SelectItem>
                  <SelectItem value="settings">ゲーム設定</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                プロフィールを開いたときに最初に表示するタブ
              </p>
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
                ソーシャルリンク
              </CardTitle>
              <CardDescription>
                SNSや配信プラットフォームを連携します。
              </CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleOpenCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  追加
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
                const platformLabel = platformOptions.find((p) => p.value === link.platform)?.label ?? link.platform;
                const url = getPlatformUrl(link.platform, link.identifier);
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
              <p className="text-sm">ソーシャルリンクがまだありません</p>
              <p className="text-xs mt-1">配信チャンネルやSNSへのリンクを追加しましょう</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            危険な操作
          </CardTitle>
          <CardDescription>
            この操作は取り消すことができません。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 border border-destructive/30 rounded-lg bg-destructive/5">
            <div>
              <p className="font-medium">アカウントを削除</p>
              <p className="text-sm text-muted-foreground">
                プロフィール、記録、設定などすべてのデータが削除されます
              </p>
            </div>
            <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => {
              setIsDeleteDialogOpen(open);
              if (!open) setConfirmMcid("");
            }}>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  アカウントを削除
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    アカウントを削除しますか？
                  </DialogTitle>
                  <DialogDescription>
                    この操作は取り消すことができません。すべてのプロフィール情報、キー配置、記録、設定が完全に削除されます。
                  </DialogDescription>
                </DialogHeader>
                <deleteFetcher.Form method="post">
                  <input type="hidden" name="_action" value="delete_account" />
                  <div className="space-y-4 py-4">
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        この操作は元に戻せません。削除されたデータは復元できません。
                      </AlertDescription>
                    </Alert>
                    <div className="space-y-2">
                      <Label htmlFor="confirmMcid">
                        確認のため、あなたのMCID <span className="font-mono font-bold">{user.mcid}</span> を入力してください
                      </Label>
                      <Input
                        id="confirmMcid"
                        name="confirmMcid"
                        value={confirmMcid}
                        onChange={(e) => setConfirmMcid(e.target.value)}
                        placeholder={user.mcid}
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
                      キャンセル
                    </Button>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={confirmMcid !== user.mcid || isDeleting}
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          削除中...
                        </>
                      ) : (
                        "完全に削除する"
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
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Card>
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <h2 className="text-2xl font-bold">エラーが発生しました</h2>
            <p className="text-muted-foreground">
              ページの読み込み中にエラーが発生しました。ページをリロードしてください。
            </p>
            <Button onClick={() => window.location.reload()}>
              ページをリロード
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
