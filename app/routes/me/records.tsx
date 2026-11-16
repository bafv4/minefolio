import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/records";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb, isUniqueConstraintError } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, categoryRecords } from "@/lib/schema";
import { eq, and, asc, count } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { formatTime, parseTimeToMs } from "@/lib/time-utils";
import { fetchSpeedrunComStats, getSpeedrunComVideoEmbedUrl } from "@/lib/external-stats";
import { parseRunIdList, parseRunIdListInput, sameRunIdSet, toggleRunId } from "@/lib/run-id-list";
import { YouTubeEmbed } from "@/components/youtube-embed";
import { PinnedBadge } from "@/components/pinned-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { PageSection } from "@/components/page-section";
import { NoticeBanner } from "@/components/notice-banner";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
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
  Trophy,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  Pin,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { isHttpUrl } from "@/lib/safe-url";
import { categoryLabel, type CategoryKey } from "@/lib/playstyle";
import { RECORD_CATEGORY_KEYS, resolveRecordCategory, splitRecordCategory } from "@/lib/record-category";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meRecords.title") }];
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
      categoryRecords: {
        orderBy: [asc(categoryRecords.displayOrder)],
      },
    },
  });

  if (!user) {
    throw new Response(t("meRecords.userNotFound"), { status: 404 });
  }

  // Speedrun.com記録を取得（ユーザー名が設定されている場合のみ）
  let speedruncomRecords: Awaited<ReturnType<typeof fetchSpeedrunComStats>> | null = null;
  if (user.speedruncomUsername) {
    try {
      speedruncomRecords = await fetchSpeedrunComStats(user.speedruncomUsername);
    } catch (error) {
      console.error("Failed to fetch Speedrun.com records:", error);
    }
  }

  // 非表示・ピン留め記録IDをパース
  const hiddenSpeedrunRecords = parseRunIdList(user.hiddenSpeedrunRecords);
  const pinnedSpeedrunRecords = parseRunIdList(user.pinnedSpeedrunRecords);

  return {
    user,
    records: user.categoryRecords,
    speedruncomRecords,
    hiddenSpeedrunRecords,
    pinnedSpeedrunRecords,
    speedruncomUsername: user.speedruncomUsername,
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-11 sm:h-10 w-full sm:w-32" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="flex gap-1">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8" />
              </div>
            </div>
            <Skeleton className="h-8 w-28" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** create 分岐のトランザクションを、登録上限到達時にユーザー向けエラーメッセージ付きで中断するための例外 */
class RecordLimitError extends Error {}

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
    return { error: t("meRecords.userNotFound") };
  }

  const formData = await request.formData();
  const action = formData.get("_action") as string;

  if (action === "create" || action === "update") {
    const id = formData.get("id") as string | null;
    const category = (formData.get("category") as string)?.trim();
    const categoryDisplayName = (formData.get("categoryDisplayName") as string)?.trim();
    const personalBestStr = (formData.get("personalBest") as string)?.trim();
    const pbVideoUrl = (formData.get("pbVideoUrl") as string)?.trim() || null;
    const isVisible = formData.get("isVisible") === "true";
    const isPinned = formData.get("isPinned") === "true";

    if (!category || !categoryDisplayName) {
      return { error: t("meRecords.categoryRequired") };
    }

    if (category.length > 100 || categoryDisplayName.length > 100) {
      return { error: t("meRecords.categoryTooLong") };
    }

    const personalBest = personalBestStr ? parseTimeToMs(personalBestStr) : null;
    if (personalBestStr && personalBest === null) {
      return { error: t("meRecords.invalidTime") };
    }

    if (pbVideoUrl && !isHttpUrl(pbVideoUrl)) {
      return { error: t("meRecords.invalidVideoUrl") };
    }

    if (action === "create") {
      // 件数チェック→insert を同一トランザクションで行い、並行リクエストでの
      // 上限突破（read-then-insert の競合）を防ぐ
      try {
        await db.transaction(async (tx) => {
          const [{ n }] = await tx
            .select({ n: count() })
            .from(categoryRecords)
            .where(eq(categoryRecords.userId, user.id));
          if (n >= 50) {
            throw new RecordLimitError();
          }

          await tx.insert(categoryRecords).values({
            id: createId(),
            userId: user.id,
            category,
            categoryDisplayName,
            recordType: "custom",
            personalBest,
            pbVideoUrl,
            isVisible,
            isPinned,
          });
        });
      } catch (e) {
        if (e instanceof RecordLimitError) {
          return { error: t("meRecords.errorLimitReached") };
        }
        // (userId, category, recordType) の一意制約。同じカテゴリの記録は1件だけ
        if (isUniqueConstraintError(e)) {
          return { error: t("meRecords.categoryDuplicate") };
        }
        throw e;
      }
    } else if (id) {
      try {
        await db
          .update(categoryRecords)
          .set({
            category,
            categoryDisplayName,
            personalBest,
            pbVideoUrl,
            isVisible,
            isPinned,
            updatedAt: new Date(),
          })
          .where(and(eq(categoryRecords.id, id), eq(categoryRecords.userId, user.id)));
      } catch (e) {
        if (isUniqueConstraintError(e)) {
          return { error: t("meRecords.categoryDuplicate") };
        }
        throw e;
      }
    }

    return { success: true };
  }

  if (action === "delete") {
    const id = formData.get("id") as string;
    if (id) {
      await db
        .delete(categoryRecords)
        .where(and(eq(categoryRecords.id, id), eq(categoryRecords.userId, user.id)));
    }
    return { success: true };
  }

  // Speedrun.com記録の非表示・ピン留めを、下書きの内容でまとめて保存する（FloatingSaveBar から）
  if (action === "saveSpeedrunFlags") {
    const hidden = parseRunIdListInput(formData.get("hidden"));
    const pinned = parseRunIdListInput(formData.get("pinned"));
    if (!hidden || !pinned) {
      return { error: t("meRecords.invalidAction") };
    }

    // 非表示は露出を減らす操作なので updatedAt（ホームの「最近の更新」等）は進めない。ピン留めが変わったときだけ進める
    const pinnedChanged = !sameRunIdSet(parseRunIdList(user.pinnedSpeedrunRecords), pinned);
    await db
      .update(users)
      .set({
        hiddenSpeedrunRecords: JSON.stringify(hidden),
        pinnedSpeedrunRecords: JSON.stringify(pinned),
        ...(pinnedChanged ? { updatedAt: new Date() } : {}),
      })
      .where(eq(users.id, user.id));

    return { success: true, flags: true as const };
  }

  return { error: t("meRecords.invalidAction") };
}

export default function RecordsPage() {
  const t = useT();
  const {
    records,
    speedruncomRecords,
    hiddenSpeedrunRecords: savedHidden,
    pinnedSpeedrunRecords: savedPinned,
    speedruncomUsername,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const flagsFetcher = useFetcher<typeof action>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<typeof records[0] | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<typeof records[0] | null>(null);
  const [categoryKey, setCategoryKey] = useState<CategoryKey>("rsg");
  const [categorySuffix, setCategorySuffix] = useState("");
  // Speedrun.com 記録の非表示・ピン留めは下書きで持ち、FloatingSaveBar で保存する
  const [draftHidden, setDraftHidden] = useState<string[]>(savedHidden);
  const [draftPinned, setDraftPinned] = useState<string[]>(savedPinned);

  const isSubmitting = fetcher.state === "submitting";
  const isSavingFlags = flagsFetcher.state !== "idle";
  const data = fetcher.data;

  // 保存済みの内容が変わったとき（保存の完了・別操作の再検証で中身が変わったとき）だけ下書きを取り直す。
  // カスタム記録の追加・削除でも loader は再検証されるので、配列の参照ではなく内容で比べる
  // （そうしないと、未保存の下書きがその度に消える）
  const savedFlagsKey = JSON.stringify([[...savedHidden].sort(), [...savedPinned].sort()]);
  useEffect(() => {
    setDraftHidden(savedHidden);
    setDraftPinned(savedPinned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedFlagsKey]);

  const flagsDirty = !sameRunIdSet(draftHidden, savedHidden) || !sameRunIdSet(draftPinned, savedPinned);

  const flagsResult = flagsFetcher.data;
  const handledFlagsResult = useRef<typeof flagsResult>(undefined);
  useEffect(() => {
    if (!flagsResult || flagsResult === handledFlagsResult.current) return;
    handledFlagsResult.current = flagsResult;
    if ("success" in flagsResult && flagsResult.success) {
      toast.success(t("meRecords.saveFlagsSuccess"));
    } else {
      toast.error("error" in flagsResult ? flagsResult.error : t("meRecords.saveFlagsFailed"));
    }
  }, [flagsResult, t]);

  const handleSaveFlags = () => {
    flagsFetcher.submit(
      { _action: "saveSpeedrunFlags", hidden: JSON.stringify(draftHidden), pinned: JSON.stringify(draftPinned) },
      { method: "post" },
    );
  };

  const handleResetFlags = () => {
    setDraftHidden(savedHidden);
    setDraftPinned(savedPinned);
  };

  const handleOpenCreate = () => {
    setEditingRecord(null);
    setCategoryKey("rsg");
    setCategorySuffix("");
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (record: typeof records[0]) => {
    const { key, suffix } = splitRecordCategory(record.category);
    setEditingRecord(record);
    setCategoryKey(key);
    setCategorySuffix(suffix);
    setIsDialogOpen(true);
  };

  const iconButtonClass =
    "inline-flex size-11 items-center justify-center rounded transition-colors hover:bg-secondary sm:size-8";

  return (
    <div className="space-y-7 pb-24 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("meRecords.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("meRecords.pageDescription")}
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenCreate} className="w-full sm:w-auto h-11 sm:h-10">
              <Plus className="mr-2 h-4 w-4" />
              {t("meRecords.addRecord")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            {/* 開くたびに再マウントし、非制御入力の前回状態が持ち越されないようにする */}
            <fetcher.Form
              key={`${isDialogOpen}-${editingRecord?.id ?? "new"}`}
              method="post"
              onSubmit={() => setIsDialogOpen(false)}
            >
              <input type="hidden" name="_action" value={editingRecord ? "update" : "create"} />
              {editingRecord && <input type="hidden" name="id" value={editingRecord.id} />}
              <input type="hidden" name="category" value={resolveRecordCategory(editingRecord?.category ?? null, categoryKey, categorySuffix)} />
              <DialogHeader>
                <DialogTitle>{editingRecord ? t("meRecords.editRecord") : t("meRecords.addRecordTitle")}</DialogTitle>
                <DialogDescription>
                  {editingRecord ? t("meRecords.editRecordDescription") : t("meRecords.addRecordDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="categoryKey">{t("meRecords.categoryKey")}</Label>
                  <Select value={categoryKey} onValueChange={(v) => setCategoryKey(v as CategoryKey)}>
                    <SelectTrigger id="categoryKey" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECORD_CATEGORY_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>
                          {categoryLabel(t, key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("meRecords.categoryKeyHint")}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="categorySuffix">{t("meRecords.subcategory")}</Label>
                  <Input
                    id="categorySuffix"
                    value={categorySuffix}
                    onChange={(e) => setCategorySuffix(e.target.value)}
                    placeholder={t("meRecords.subcategoryPlaceholder")}
                    maxLength={80}
                    aria-describedby="categorySuffix-hint"
                  />
                  <p id="categorySuffix-hint" className="text-xs text-muted-foreground">
                    {t("meRecords.subcategoryHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="categoryDisplayName">{t("meRecords.displayName")}</Label>
                  <Input
                    id="categoryDisplayName"
                    name="categoryDisplayName"
                    defaultValue={editingRecord?.categoryDisplayName ?? ""}
                    placeholder={t("meRecords.displayNamePlaceholder")}
                    maxLength={100}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="personalBest">{t("meRecords.personalBest")}</Label>
                  <Input
                    id="personalBest"
                    name="personalBest"
                    defaultValue={editingRecord?.personalBest ? formatTime(editingRecord.personalBest) : ""}
                    placeholder={t("meRecords.personalBestPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pbVideoUrl">{t("meRecords.videoUrl")}</Label>
                  <Input
                    id="pbVideoUrl"
                    name="pbVideoUrl"
                    type="url"
                    defaultValue={editingRecord?.pbVideoUrl ?? ""}
                    placeholder="https://youtube.com/..."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="isVisible"
                    name="isVisible"
                    value="true"
                    defaultChecked={editingRecord?.isVisible ?? true}
                  />
                  <Label htmlFor="isVisible">{t("meRecords.visible")}</Label>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="isPinned"
                      name="isPinned"
                      value="true"
                      defaultChecked={editingRecord?.isPinned ?? false}
                    />
                    <Label htmlFor="isPinned">{t("meRecords.pinned")}</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("meRecords.pinnedHint")}</p>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  {t("meRecords.cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {editingRecord ? t("meRecords.submitUpdate") : t("meRecords.submitAdd")}
                </Button>
              </DialogFooter>
            </fetcher.Form>
          </DialogContent>
        </Dialog>
      </div>

      {data && "error" in data && (
        <NoticeBanner tone="error" icon={AlertCircle}>
          {data.error}
        </NoticeBanner>
      )}

      {/* Speedrun.com記録セクション */}
      {speedruncomUsername && (
        <PageSection
          id="records-speedruncom"
          first
          icon={<Trophy className="h-5 w-5 text-primary" aria-hidden="true" />}
          title={t("meRecords.speedrunSectionTitle")}
        >
          <p className="text-sm text-muted-foreground">
            {t("meRecords.speedrunSectionDescription")} {t("meRecords.sectionDraftHint")}
          </p>
          {speedruncomRecords && !speedruncomRecords.error && speedruncomRecords.personalBests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {speedruncomRecords.personalBests.map((pb) => {
                const isHidden = draftHidden.includes(pb.run.id);
                const isPinned = draftPinned.includes(pb.run.id);
                const videoEmbedUrl = getSpeedrunComVideoEmbedUrl(pb);
                const recordName = [pb.game?.data?.names?.international, pb.category?.data?.name]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={pb.run.id}
                    className={cn(
                      "rounded-xl bg-secondary/50 p-3 space-y-1 relative group",
                      isHidden && "opacity-50"
                    )}
                  >
                    <div className="absolute top-1 right-1 flex items-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setDraftPinned((prev) => toggleRunId(prev, pb.run.id))}
                            disabled={isSavingFlags}
                            aria-label={t("meRecords.pinRecordLabel", { name: recordName })}
                            aria-pressed={isPinned}
                            className={iconButtonClass}
                          >
                            <Pin className={cn("h-4 w-4", isPinned ? "text-primary" : "text-muted-foreground")} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isPinned ? t("meRecords.unpin") : t("meRecords.pin")}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setDraftHidden((prev) => toggleRunId(prev, pb.run.id))}
                            disabled={isSavingFlags}
                            aria-label={t("meRecords.showRecordLabel", { name: recordName })}
                            aria-pressed={!isHidden}
                            className={iconButtonClass}
                          >
                            {isHidden ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isHidden ? t("meRecords.show") : t("meRecords.hide")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center justify-between pr-24 sm:pr-20">
                      <h3 className="font-medium text-sm truncate">
                        {pb.category?.data?.name ?? "Unknown"}
                      </h3>
                      <Badge variant="outline" className="shrink-0">
                        #{pb.place}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {pb.game?.data?.names?.international ?? "Unknown Game"}
                    </p>
                    {(pb.platformName || pb.versionName) && (
                      <p className="text-xs text-muted-foreground">
                        {[pb.platformName, pb.versionName].filter(Boolean).join(" / ")}
                      </p>
                    )}
                    <p className="text-lg font-mono font-bold">
                      {formatTime(pb.run.times.primary_t * 1000)}
                    </p>
                    {videoEmbedUrl && (
                      <YouTubeEmbed
                        embedUrl={videoEmbedUrl}
                        title={pb.category?.data?.name ?? "Speedrun video"}
                      />
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {isPinned && <PinnedBadge />}
                      {isHidden && (
                        <Badge variant="secondary" className="text-xs">{t("meRecords.hidden")}</Badge>
                      )}
                      {pb.run.weblink && (
                        <a
                          href={pb.run.weblink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="-mx-2 -my-3.5 flex items-center gap-1 px-2 py-3.5 text-xs text-primary hover:underline sm:-my-2 sm:py-2"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t("meRecords.viewRecord")}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : speedruncomRecords?.error ? (
            <p className="text-sm text-muted-foreground">{speedruncomRecords.error}</p>
          ) : speedruncomRecords && speedruncomRecords.user === null ? (
            // error なしで user が null ＝ speedrun.com にそのユーザー名が無い（ユーザー名の誤設定に気づけるようにする）
            <NoticeBanner tone="info" icon={AlertCircle}>
              {t("meRecords.speedrunUserNotFound", { username: speedruncomUsername })}
            </NoticeBanner>
          ) : (
            <EmptyState
              size="compact"
              icon={<Trophy className="h-5 w-5" />}
              title={t("meRecords.noSpeedrunRecords")}
              description={t("meRecords.noSpeedrunRecordsHint")}
            />
          )}
        </PageSection>
      )}

      {/* カスタム記録セクション */}
      <PageSection
        id="records-custom"
        icon={<Trophy className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("meRecords.customRecords")}
        first={!speedruncomUsername}
      >
        {records.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {records.map((record) => (
              <Card key={record.id} className="gap-3 py-5">
                <CardHeader className="px-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold">{record.categoryDisplayName}</h3>
                      <CardDescription>{record.category}</CardDescription>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        aria-label={t("meRecords.editRecordLabel", { name: record.categoryDisplayName })}
                        onClick={() => handleOpenEdit(record)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        aria-label={t("meRecords.deleteRecordLabel", { name: record.categoryDisplayName })}
                        onClick={() => setDeletingRecord(record)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-5">
                  {record.personalBest && (
                    <p className="text-2xl font-mono font-bold">
                      {formatTime(record.personalBest)}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    {!record.isVisible && <Badge variant="secondary">{t("meRecords.private")}</Badge>}
                    {record.isPinned && <PinnedBadge />}
                    {record.pbVideoUrl && (
                      <Button variant="outline" size="sm" asChild className="min-h-11 sm:min-h-8">
                        <a href={record.pbVideoUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1 h-3 w-3" />
                          {t("meRecords.video")}
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            size="compact"
            icon={<Trophy className="h-5 w-5" />}
            title={t("meRecords.noCustomRecords")}
            description={t("meRecords.noCustomRecordsDescription")}
            action={
              <Button onClick={handleOpenCreate}>
                <Plus className="mr-2 h-4 w-4" />
                {t("meRecords.addFirstRecord")}
              </Button>
            }
          />
        )}
      </PageSection>

      <AlertDialog open={deletingRecord !== null} onOpenChange={(open) => !open && setDeletingRecord(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("meRecords.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("meRecords.deleteDescription", { name: deletingRecord?.categoryDisplayName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("meRecords.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletingRecord) {
                  fetcher.submit({ _action: "delete", id: deletingRecord.id }, { method: "post" });
                }
              }}
            >
              {t("meRecords.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FloatingSaveBar
        hasChanges={flagsDirty}
        isSubmitting={isSavingFlags}
        onSave={handleSaveFlags}
        onReset={handleResetFlags}
      />
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
            <h2 className="text-2xl font-bold">{t("meRecords.errorTitle")}</h2>
            <p className="text-muted-foreground">
              {t("meRecords.errorDescription")}
            </p>
            <Button onClick={() => window.location.reload()}>
              {t("meRecords.reloadPage")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
