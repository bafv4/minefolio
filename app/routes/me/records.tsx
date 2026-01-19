import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/records";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, categoryRecords } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { formatTime, parseTimeToMs } from "@/lib/time-utils";
import { fetchSpeedrunComStats } from "@/lib/external-stats";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export const meta: Route.MetaFunction = () => {
  return [{ title: "記録 - Minefolio" }];
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
      categoryRecords: {
        orderBy: [asc(categoryRecords.displayOrder)],
      },
    },
  });

  if (!user) {
    throw new Response("ユーザーが見つかりません", { status: 404 });
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

  // 非表示記録IDをパース
  const hiddenSpeedrunRecords: string[] = user.hiddenSpeedrunRecords
    ? JSON.parse(user.hiddenSpeedrunRecords)
    : [];

  return {
    user,
    records: user.categoryRecords,
    speedruncomRecords,
    hiddenSpeedrunRecords,
    speedruncomUsername: user.speedruncomUsername,
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32" />
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
  const action = formData.get("_action") as string;

  if (action === "create" || action === "update") {
    const id = formData.get("id") as string | null;
    const category = (formData.get("category") as string)?.trim();
    const categoryDisplayName = (formData.get("categoryDisplayName") as string)?.trim();
    const personalBestStr = (formData.get("personalBest") as string)?.trim();
    const pbVideoUrl = (formData.get("pbVideoUrl") as string)?.trim() || null;
    const isVisible = formData.get("isVisible") === "true";

    if (!category || !categoryDisplayName) {
      return { error: "カテゴリ名は必須です" };
    }

    const personalBest = personalBestStr ? parseTimeToMs(personalBestStr) : null;
    if (personalBestStr && personalBest === null) {
      return { error: "時間形式が不正です。M:SS.mmm形式で入力してください（例: 14:32.500）" };
    }

    if (action === "create") {
      await db.insert(categoryRecords).values({
        id: createId(),
        userId: user.id,
        category,
        categoryDisplayName,
        recordType: "custom",
        personalBest,
        pbVideoUrl,
        isVisible,
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
          updatedAt: new Date(),
        })
        .where(eq(categoryRecords.id, id));
    }

    return { success: true };
  }

  if (action === "delete") {
    const id = formData.get("id") as string;
    if (id) {
      await db.delete(categoryRecords).where(eq(categoryRecords.id, id));
    }
    return { success: true };
  }

  // Speedrun.com記録の表示/非表示トグル
  if (action === "toggleSpeedrunRecord") {
    const runId = formData.get("runId") as string;
    if (!runId) {
      return { error: "記録IDが必要です" };
    }

    // 現在の非表示リストを取得
    const currentHidden: string[] = user.hiddenSpeedrunRecords
      ? JSON.parse(user.hiddenSpeedrunRecords)
      : [];

    // トグル処理
    let newHidden: string[];
    if (currentHidden.includes(runId)) {
      newHidden = currentHidden.filter((id) => id !== runId);
    } else {
      newHidden = [...currentHidden, runId];
    }

    // データベースを更新
    await db
      .update(users)
      .set({
        hiddenSpeedrunRecords: JSON.stringify(newHidden),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { success: true, hiddenRecords: newHidden };
  }

  return { error: "無効な操作です" };
}

export default function RecordsPage() {
  const { records, speedruncomRecords, hiddenSpeedrunRecords: initialHidden, speedruncomUsername } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<typeof records[0] | null>(null);
  const [hiddenSpeedrunRecords, setHiddenSpeedrunRecords] = useState<string[]>(initialHidden);

  const isSubmitting = fetcher.state === "submitting";
  const data = fetcher.data;

  // fetcherの結果を反映
  useEffect(() => {
    if (fetcher.data && "hiddenRecords" in fetcher.data && fetcher.data.hiddenRecords) {
      setHiddenSpeedrunRecords(fetcher.data.hiddenRecords);
    }
  }, [fetcher.data]);

  // Speedrun.com記録の表示/非表示をトグル
  const toggleSpeedrunRecordVisibility = (runId: string) => {
    fetcher.submit(
      { _action: "toggleSpeedrunRecord", runId },
      { method: "post" }
    );
    // 楽観的更新
    setHiddenSpeedrunRecords((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId]
    );
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">記録</h1>
          <p className="text-muted-foreground">
            スピードラン自己ベストと目標を管理します。
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenCreate}>
              <Plus className="mr-2 h-4 w-4" />
              記録を追加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <fetcher.Form method="post" onSubmit={() => setIsDialogOpen(false)}>
              <input type="hidden" name="_action" value={editingRecord ? "update" : "create"} />
              {editingRecord && <input type="hidden" name="id" value={editingRecord.id} />}
              <DialogHeader>
                <DialogTitle>{editingRecord ? "記録を編集" : "記録を追加"}</DialogTitle>
                <DialogDescription>
                  {editingRecord ? "記録の詳細を更新します。" : "新しいスピードラン記録を追加します。"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="category">カテゴリID</Label>
                  <Input
                    id="category"
                    name="category"
                    defaultValue={editingRecord?.category ?? ""}
                    placeholder="例: rsg_any"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="categoryDisplayName">表示名</Label>
                  <Input
                    id="categoryDisplayName"
                    name="categoryDisplayName"
                    defaultValue={editingRecord?.categoryDisplayName ?? ""}
                    placeholder="例: RSG Any%"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="personalBest">自己ベスト (M:SS.mmm)</Label>
                  <Input
                    id="personalBest"
                    name="personalBest"
                    defaultValue={editingRecord?.personalBest ? formatTime(editingRecord.personalBest) : ""}
                    placeholder="例: 14:32.500"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pbVideoUrl">動画URL</Label>
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
                  <Label htmlFor="isVisible">公開</Label>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  記録を{editingRecord ? "更新" : "追加"}
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
              Speedrun.com 記録
            </CardTitle>
            <CardDescription>
              Speedrun.comから取得した記録の表示/非表示を設定できます。
              非表示にした記録はプロフィールに表示されません。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {speedruncomRecords && !speedruncomRecords.error && speedruncomRecords.personalBests.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {speedruncomRecords.personalBests.map((pb) => {
                  const isHidden = hiddenSpeedrunRecords.includes(pb.run.id);
                  return (
                    <div
                      key={pb.run.id}
                      className={cn(
                        "p-3 bg-secondary/50 rounded-lg space-y-1 relative group",
                        isHidden && "opacity-50"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSpeedrunRecordVisibility(pb.run.id)}
                        className="absolute top-2 right-2 p-1.5 rounded hover:bg-secondary transition-colors"
                        title={isHidden ? "表示する" : "非表示にする"}
                      >
                        {isHidden ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <div className="flex items-center justify-between pr-8">
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
                      <div className="flex items-center gap-2 flex-wrap">
                        {isHidden && (
                          <Badge variant="secondary" className="text-xs">非表示</Badge>
                        )}
                        {pb.run.weblink && (
                          <a
                            href={pb.run.weblink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            記録を見る
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
              <p className="text-sm text-muted-foreground">Speedrun.comに記録がありません。</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* カスタム記録セクション */}
      <div>
        <h2 className="text-lg font-semibold mb-4">カスタム記録</h2>
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
                    {!record.isVisible && <Badge variant="secondary">非公開</Badge>}
                    {record.pbVideoUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={record.pbVideoUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1 h-3 w-3" />
                          動画
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
              <p className="text-lg font-medium">カスタム記録がまだありません</p>
              <p className="text-sm text-muted-foreground mb-4">
                Speedrun.com以外の記録を追加できます。
              </p>
              <Button onClick={handleOpenCreate}>
                <Plus className="mr-2 h-4 w-4" />
                最初の記録を追加
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
