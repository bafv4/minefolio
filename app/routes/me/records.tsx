import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/records";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { users, categoryRecords } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { formatTime, parseTimeToMs } from "@/lib/time-utils";
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
  Star,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";

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
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
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

  return { user, records: user.categoryRecords };
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
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
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
    const isFeatured = formData.get("isFeatured") === "true";
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
        isFeatured,
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
          isFeatured,
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

  if (action === "toggleFeatured") {
    const id = formData.get("id") as string;
    const isFeatured = formData.get("isFeatured") === "true";
    if (id) {
      await db
        .update(categoryRecords)
        .set({ isFeatured, updatedAt: new Date() })
        .where(eq(categoryRecords.id, id));
    }
    return { success: true };
  }

  return { error: "無効な操作です" };
}

export default function RecordsPage() {
  const { records } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<typeof records[0] | null>(null);

  const isSubmitting = fetcher.state === "submitting";
  const data = fetcher.data;

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
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="isFeatured"
                      name="isFeatured"
                      value="true"
                      defaultChecked={editingRecord?.isFeatured ?? false}
                    />
                    <Label htmlFor="isFeatured">注目</Label>
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

      {records.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {records.map((record) => (
            <Card key={record.id} className={record.isFeatured ? "border-yellow-500/50" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {record.categoryDisplayName}
                      {record.isFeatured && <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />}
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
            <p className="text-lg font-medium">記録がまだありません</p>
            <p className="text-sm text-muted-foreground mb-4">
              最初のスピードラン記録を追加して、あなたの実績を公開しましょう。
            </p>
            <Button onClick={handleOpenCreate}>
              <Plus className="mr-2 h-4 w-4" />
              最初の記録を追加
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
