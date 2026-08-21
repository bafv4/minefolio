import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/records";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, categoryRecords } from "@/lib/schema";
import { eq, and, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { formatTime, parseTimeToMs } from "@/lib/time-utils";
import { fetchSpeedrunComStats, getSpeedrunComVideoEmbedUrl } from "@/lib/external-stats";
import { parseRunIdList, toggleRunId } from "@/lib/run-id-list";
import { YouTubeEmbed } from "@/components/youtube-embed";
import { PinnedBadge } from "@/components/pinned-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Trophy,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Pin,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

// pbVideoUrl は http/https スキームのみ許可する（javascript: 等を弾き Stored XSS を防ぐ）。
// F6 が所有する共有ヘルパー app/lib/safe-url.ts とは独立させるため、この機能内の
// ローカルヘルパーとして持つ（同等の実装が profile.tsx の RecordCard 側にもある）。
export function isHttpVideoUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

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
  const t = useT();
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

    if (pbVideoUrl && !isHttpVideoUrl(pbVideoUrl)) {
      return { error: t("meRecords.invalidVideoUrl") };
    }

    if (action === "create") {
      const userRecords = await db.query.categoryRecords.findMany({
        where: eq(categoryRecords.userId, user.id),
        columns: { id: true },
      });
      if (userRecords.length >= 50) {
        return { error: t("meRecords.errorLimitReached") };
      }

      await db.insert(categoryRecords).values({
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
    } else if (id) {
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

  // Speedrun.com記録の表示/非表示トグル
  if (action === "toggleSpeedrunRecord") {
    const runId = formData.get("runId") as string;
    if (!runId) {
      return { error: t("meRecords.recordIdRequired") };
    }

    const newHidden = toggleRunId(parseRunIdList(user.hiddenSpeedrunRecords), runId);
    await db
      .update(users)
      .set({
        hiddenSpeedrunRecords: JSON.stringify(newHidden),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { success: true, hiddenRecords: newHidden };
  }

  // Speedrun.com記録のピン留めトグル
  if (action === "toggleSpeedrunRecordPin") {
    const runId = formData.get("runId") as string;
    if (!runId) {
      return { error: t("meRecords.recordIdRequired") };
    }

    const newPinned = toggleRunId(parseRunIdList(user.pinnedSpeedrunRecords), runId);
    await db
      .update(users)
      .set({
        pinnedSpeedrunRecords: JSON.stringify(newPinned),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { success: true, pinnedRecords: newPinned };
  }

  return { error: t("meRecords.invalidAction") };
}

export default function RecordsPage() {
  const t = useT();
  const {
    records,
    speedruncomRecords,
    hiddenSpeedrunRecords: initialHidden,
    pinnedSpeedrunRecords: initialPinned,
    speedruncomUsername,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<typeof records[0] | null>(null);
  const [hiddenSpeedrunRecords, setHiddenSpeedrunRecords] = useState<string[]>(initialHidden);
  const [pinnedSpeedrunRecords, setPinnedSpeedrunRecords] = useState<string[]>(initialPinned);

  const isSubmitting = fetcher.state === "submitting";
  const data = fetcher.data;

  // fetcherの結果を反映
  useEffect(() => {
    if (fetcher.data && "hiddenRecords" in fetcher.data && fetcher.data.hiddenRecords) {
      setHiddenSpeedrunRecords(fetcher.data.hiddenRecords);
    }
    if (fetcher.data && "pinnedRecords" in fetcher.data && fetcher.data.pinnedRecords) {
      setPinnedSpeedrunRecords(fetcher.data.pinnedRecords);
    }
  }, [fetcher.data]);

  // Speedrun.com記録のフラグ（非表示/ピン留め）を、サーバー送信 + 楽観的更新でトグルする
  const toggleSpeedrunRecordFlag = (
    action: "toggleSpeedrunRecord" | "toggleSpeedrunRecordPin",
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    runId: string,
  ) => {
    fetcher.submit({ _action: action, runId }, { method: "post" });
    setter((prev) => toggleRunId(prev, runId));
  };

  const toggleSpeedrunRecordVisibility = (runId: string) =>
    toggleSpeedrunRecordFlag("toggleSpeedrunRecord", setHiddenSpeedrunRecords, runId);

  const toggleSpeedrunRecordPin = (runId: string) =>
    toggleSpeedrunRecordFlag("toggleSpeedrunRecordPin", setPinnedSpeedrunRecords, runId);

  const handleOpenCreate = () => {
    setEditingRecord(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (record: typeof records[0]) => {
    setEditingRecord(record);
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
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
              <DialogHeader>
                <DialogTitle>{editingRecord ? t("meRecords.editRecord") : t("meRecords.addRecordTitle")}</DialogTitle>
                <DialogDescription>
                  {editingRecord ? t("meRecords.editRecordDescription") : t("meRecords.addRecordDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="category">{t("meRecords.categoryId")}</Label>
                  <Input
                    id="category"
                    name="category"
                    defaultValue={editingRecord?.category ?? ""}
                    placeholder={t("meRecords.categoryIdPlaceholder")}
                    maxLength={100}
                    required
                  />
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
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{data.error}</AlertDescription>
        </Alert>
      )}

      {/* Speedrun.com記録セクション */}
      {speedruncomUsername && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              {t("meRecords.speedrunSectionTitle")}
            </CardTitle>
            <CardDescription>
              {t("meRecords.speedrunSectionDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {speedruncomRecords && !speedruncomRecords.error && speedruncomRecords.personalBests.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {speedruncomRecords.personalBests.map((pb) => {
                  const isHidden = hiddenSpeedrunRecords.includes(pb.run.id);
                  const isPinned = pinnedSpeedrunRecords.includes(pb.run.id);
                  const videoEmbedUrl = getSpeedrunComVideoEmbedUrl(pb);
                  return (
                    <div
                      key={pb.run.id}
                      className={cn(
                        "p-3 bg-secondary/50 rounded-lg space-y-1 relative group",
                        isHidden && "opacity-50"
                      )}
                    >
                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => toggleSpeedrunRecordPin(pb.run.id)}
                              className="p-1.5 rounded hover:bg-secondary transition-colors"
                            >
                              {isPinned ? (
                                <Pin className="h-4 w-4 text-primary" />
                              ) : (
                                <Pin className="h-4 w-4 text-muted-foreground" />
                              )}
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
                              onClick={() => toggleSpeedrunRecordVisibility(pb.run.id)}
                              className="p-1.5 rounded hover:bg-secondary transition-colors"
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
                      <div className="flex items-center justify-between pr-16">
                        <span className="font-medium text-sm truncate">
                          {pb.category?.data?.name ?? "Unknown"}
                        </span>
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
                            className="text-xs text-primary hover:underline flex items-center gap-1"
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
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Trophy className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t("meRecords.noSpeedrunRecords")}</p>
                <p className="text-xs mt-1">{t("meRecords.noSpeedrunRecordsHint")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* カスタム記録セクション */}
      <div>
        <h2 className="text-lg font-semibold mb-4">{t("meRecords.customRecords")}</h2>
        {records.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {records.map((record) => (
              <Card key={record.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        {record.categoryDisplayName}
                      </CardTitle>
                      <CardDescription>{record.category}</CardDescription>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(record)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <fetcher.Form method="post">
                        <input type="hidden" name="_action" value="delete" />
                        <input type="hidden" name="id" value={record.id} />
                        <Button variant="ghost" size="icon" type="submit">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </fetcher.Form>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {record.personalBest && (
                    <p className="text-2xl font-mono font-bold">
                      {formatTime(record.personalBest)}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    {!record.isVisible && <Badge variant="secondary">{t("meRecords.private")}</Badge>}
                    {record.isPinned && <PinnedBadge />}
                    {record.pbVideoUrl && (
                      <Button variant="outline" size="sm" asChild>
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
          <Card>
            <CardContent className="text-center py-12">
              <Trophy className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-lg font-medium">{t("meRecords.noCustomRecords")}</p>
              <p className="text-sm text-muted-foreground mb-4">
                {t("meRecords.noCustomRecordsDescription")}
              </p>
              <Button onClick={handleOpenCreate}>
                <Plus className="mr-2 h-4 w-4" />
                {t("meRecords.addFirstRecord")}
              </Button>
            </CardContent>
          </Card>
        )}
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
