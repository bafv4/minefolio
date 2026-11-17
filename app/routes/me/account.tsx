import { createTranslator, type MessageKey } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useRef, useState, useCallback } from "react";
import { useLoaderData, useFetcher, redirect, type ShouldRevalidateFunctionArgs } from "react-router";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import type { Route } from "./+types/account";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, playerConfigs, itemLayouts, searchCrafts, keyRemaps } from "@/lib/schema";
import { SELECTABLE_PROFILE_TABS, type SelectableProfileTabValue } from "@/lib/profile-tabs";
import { eq, sql } from "drizzle-orm";
import { importFromLegacy } from "@/lib/legacy-import";
import { deleteUserAccount } from "@/lib/content-cleanup.server";
import { saveProfileBatch } from "@/lib/profile-edit.server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection } from "@/components/page-section";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { toast } from "sonner";
import { Loader2, AlertCircle, AlertTriangle, Download, Settings } from "lucide-react";
import { useT } from "@/hooks/use-locale";

// /me/account（公開とアカウント）。公開範囲・既定タブ・ホームの表示設定を保存バーで確定し、
// 旧データの取り込みとアカウント削除を持つ。プロフィールの中身（MCID・基本情報・リンク・動画）は /me/edit。
// 保存本体は /me/edit と共通の saveProfileBatch（送られた項目だけを更新する。列の振り分けは app/lib/profile-edit-scope.ts）

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meAccount.title") }];
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

  return {
    user: userRow,
    // レガシーAPIのURLのみ返す（チェックはクライアントサイドで行う）
    legacyApiUrl: env.LEGACY_API_URL,
    hasExistingData: Boolean(hasExistingDataRaw),
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-8 animate-in fade-in duration-200" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-5 w-64 bg-muted rounded animate-pulse" />
      </div>
      <div className="space-y-4">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <div className="h-10 w-full bg-muted rounded animate-pulse" />
        <div className="h-10 w-full bg-muted rounded animate-pulse" />
        <div className="h-24 w-full bg-muted rounded animate-pulse" />
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

  // 送られているが未知の `_action` は、保存として扱って成功を返さずエラーにする
  // （`_action` が送られていない場合は従来どおり保存として扱う）
  if (actionType !== null && actionType !== "save_all") {
    return { error: t("meEdit.unknownAccountAction") };
  }

  // 公開範囲・既定タブ・表示設定の保存（保存バー。`save_all` と `_action` 未指定は同じ経路）。
  // 送られた項目だけを更新するので、/me/edit の項目（基本情報・MCID・リンク・動画）には触れない
  return saveProfileBatch({ db, t, user, formData });
}

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

type DisplayToggleKey =
  | "showPacemanOnHome"
  | "showTwitchOnHome"
  | "showYoutubeOnHome"
  | "showRankedStats"
  | "showPacemanStats";

// ホーム・プロフィールの表示設定スイッチ（順序と文言キー）
const DISPLAY_TOGGLES: readonly { key: DisplayToggleKey; labelKey: MessageKey }[] = [
  { key: "showPacemanOnHome", labelKey: "meEdit.showPacemanOnHome" },
  { key: "showTwitchOnHome", labelKey: "meEdit.showTwitchOnHome" },
  { key: "showYoutubeOnHome", labelKey: "meEdit.showYoutubeOnHome" },
  { key: "showRankedStats", labelKey: "meEdit.showRankedStats" },
  { key: "showPacemanStats", labelKey: "meEdit.showPacemanStats" },
];

export default function AccountPage() {
  const t = useT();
  const { user, legacyApiUrl, hasExistingData } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [importCompleted, setImportCompleted] = useState(false);

  // フォームの値をトラッキングして変更を検出（保存バーで確定するまで反映されない）
  const buildFormValues = () => ({
    profileVisibility: user.profileVisibility ?? "public",
    defaultProfileTab: user.defaultProfileTab ?? "profile",
    showPacemanOnHome: user.showPacemanOnHome ?? true,
    showTwitchOnHome: user.showTwitchOnHome ?? true,
    showYoutubeOnHome: user.showYoutubeOnHome ?? true,
    showRankedStats: user.showRankedStats ?? true,
    showPacemanStats: user.showPacemanStats ?? true,
  });
  const [formValues, setFormValues] = useState(buildFormValues);
  // 保存済みの値（dirty 判定の基準）。保存成功時に送信時点のスナップショットへ更新する
  const [savedFormValues, setSavedFormValues] = useState(buildFormValues);
  const submittedValuesRef = useRef<ReturnType<typeof buildFormValues> | null>(null);

  const hasChanges = JSON.stringify(formValues) !== JSON.stringify(savedFormValues);

  // Radix の SelectValue は SSR で選択中の項目の文字を描けないため、今の値の表示文字を明示して渡す
  const visibilityLabels: Record<string, string> = {
    public: t("meEdit.profilePublic"),
    unlisted: t("meEdit.profileUnlisted"),
    private: t("meEdit.profilePrivate"),
  };
  const defaultTabKey = DEFAULT_PROFILE_TAB_LABEL_KEYS[formValues.defaultProfileTab as SelectableProfileTabValue];
  const defaultTabLabel = defaultTabKey ? t(defaultTabKey) : undefined;

  const handleReset = useCallback(() => {
    setFormValues(savedFormValues);
  }, [savedFormValues]);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("_action", "save_all");
    formData.set("profileVisibility", formValues.profileVisibility);
    formData.set("defaultProfileTab", formValues.defaultProfileTab);
    formData.set("showPacemanOnHome", String(formValues.showPacemanOnHome));
    formData.set("showTwitchOnHome", String(formValues.showTwitchOnHome));
    formData.set("showYoutubeOnHome", String(formValues.showYoutubeOnHome));
    formData.set("showRankedStats", String(formValues.showRankedStats));
    formData.set("showPacemanStats", String(formValues.showPacemanStats));
    submittedValuesRef.current = formValues;
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, formValues]);

  // 保存中〜保存後の再取得（loading）が終わるまでは idle にならない
  const isSubmitting = fetcher.state !== "idle";
  const isDeleting = deleteFetcher.state === "submitting";
  const isImporting = importFetcher.state === "submitting";
  const data = fetcher.data;
  const deleteData = deleteFetcher.data;
  const importData = importFetcher.data;

  // 保存結果のトースト・基準値の更新（レスポンスごとに1回だけ。送信時点の値を使うので保存中の入力は未保存のまま残る）
  const handledSaveDataRef = useRef<typeof fetcher.data>(undefined);
  useEffect(() => {
    if (!data || data === handledSaveDataRef.current) return;
    handledSaveDataRef.current = data;
    if ("success" in data && data.action === "profile") {
      toast.success(t("meEdit.profileUpdated"));
      if (submittedValuesRef.current) setSavedFormValues(submittedValuesRef.current);
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [data, t]);

  // インポート結果のトースト
  const prevImportDataRef = useRef<typeof importFetcher.data>(undefined);
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
  }, [importData, t]);

  const showLegacyImport = Boolean(legacyApiUrl) && !importCompleted && !hasExistingData;

  return (
    <div className="space-y-7 pb-24 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("meAccount.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("meAccount.pageDescription")}</p>
      </div>

      {/* 公開範囲・既定タブ・表示設定（保存バーで確定） */}
      <PageSection
        id="account-settings"
        first
        icon={<Settings className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("meEdit.profileSettings")}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="profileVisibility">{t("meEdit.profileVisibility")}</Label>
          <Select
            value={formValues.profileVisibility}
            onValueChange={(value) => setFormValues((prev) => ({ ...prev, profileVisibility: value as typeof prev.profileVisibility }))}
          >
            <SelectTrigger id="profileVisibility" className="w-full data-[size=default]:max-sm:h-11">
              <SelectValue>{visibilityLabels[formValues.profileVisibility]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">{t("meEdit.profilePublic")}</SelectItem>
              <SelectItem value="unlisted">{t("meEdit.profileUnlisted")}</SelectItem>
              <SelectItem value="private">{t("meEdit.profilePrivate")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="defaultProfileTab">{t("meEdit.defaultTab")}</Label>
          <Select
            value={formValues.defaultProfileTab}
            onValueChange={(value) => setFormValues((prev) => ({ ...prev, defaultProfileTab: value as typeof prev.defaultProfileTab }))}
          >
            <SelectTrigger id="defaultProfileTab" className="w-full data-[size=default]:max-sm:h-11">
              <SelectValue>{defaultTabLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SELECTABLE_PROFILE_TABS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(DEFAULT_PROFILE_TAB_LABEL_KEYS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("meEdit.defaultTabHint")}</p>
        </div>

        <div className="space-y-3 pt-2">
          <h3 className="text-base font-semibold">{t("meEdit.displaySettings")}</h3>
          <p className="text-xs text-muted-foreground">{t("meEdit.displaySettingsHint")}</p>

          <div className="max-w-2xl space-y-3">
            {DISPLAY_TOGGLES.map(({ key, labelKey }) => (
              <div key={key} className="flex min-h-11 items-center justify-between gap-4 sm:min-h-0">
                <Label htmlFor={key} className="text-sm font-normal cursor-pointer">
                  {t(labelKey)}
                </Label>
                <Switch
                  id={key}
                  checked={formValues[key]}
                  onCheckedChange={(checked) => setFormValues((prev) => ({ ...prev, [key]: checked }))}
                />
              </div>
            ))}
          </div>
        </div>
      </PageSection>

      {/* 旧データ取り込み（キー配置等が無い走者にだけ案内する） */}
      {showLegacyImport && (
        <PageSection
          id="account-legacy-import"
          icon={<Download className="h-5 w-5 text-primary" aria-hidden="true" />}
          title={t("meEdit.importFromLegacyTitle")}
        >
          <p className="text-sm text-muted-foreground">{t("meEdit.importFromLegacyDesc")}</p>
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
          {hasChanges && <p className="mt-2 text-xs text-muted-foreground">{t("meEdit.importDisabledDirty")}</p>}
        </PageSection>
      )}

      {/* Floating Save Bar（離脱時の警告も保存バーが持つ） */}
      <FloatingSaveBar
        hasChanges={hasChanges}
        isSubmitting={isSubmitting}
        saveResult={fetcher.data}
        saveSucceeded={fetcher.data != null && "success" in fetcher.data && fetcher.data.success === true}
        onSave={handleSave}
        onReset={handleReset}
      />

      {/* Danger Zone */}
      <PageSection
        id="account-danger"
        icon={<AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />}
        title={t("meEdit.dangerZone")}
      >
        <p className="text-sm text-muted-foreground">{t("meEdit.dangerZoneDesc")}</p>
        {/* 静的な内容なので通知（role）にはしない。見た目は NoticeBanner の error と同じ */}
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 basis-56">
              <p className="font-medium">{t("meEdit.deleteAccount")}</p>
              <p className="text-sm text-muted-foreground">{t("meEdit.deleteAccountDesc")}</p>
            </div>
            <Dialog
              open={isDeleteDialogOpen}
              onOpenChange={(open) => {
                setIsDeleteDialogOpen(open);
                if (!open) setConfirmText("");
              }}
            >
              <DialogTrigger asChild>
                <Button variant="destructive">{t("meEdit.deleteAccount")}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    {t("meEdit.confirmDeleteTitle")}
                  </DialogTitle>
                  <DialogDescription>{t("meEdit.confirmDeleteDesc")}</DialogDescription>
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
                    <Button type="button" variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
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
        </div>
      </PageSection>
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
            <p className="text-muted-foreground">{t("meEdit.errorDescription")}</p>
            <Button onClick={() => window.location.reload()}>{t("meEdit.reloadPage")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
