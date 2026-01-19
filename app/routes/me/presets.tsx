import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/presets";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { users, configPresets, configHistory, keybindings, playerConfigs, keyRemaps } from "@/lib/schema";
import { eq, desc, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createPreset, serializeKeybindings, serializePlayerConfig, serializeRemaps } from "@/lib/preset-utils";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import { Save, Trash2, Check, Plus, History, Clock, ArrowRight, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";

export const meta: Route.MetaFunction = () => {
  return [{ title: "設定プリセット - Minefolio" }];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context;
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    throw new Response("ユーザーが見つかりません", { status: 404 });
  }

  // プリセット一覧を取得
  const presets = await db.query.configPresets.findMany({
    where: eq(configPresets.userId, user.id),
    orderBy: [desc(configPresets.isActive), desc(configPresets.updatedAt)],
  });

  // 変更履歴を取得（最新20件）
  const history = await db.query.configHistory.findMany({
    where: eq(configHistory.userId, user.id),
    orderBy: [desc(configHistory.createdAt)],
    limit: 20,
    with: {
      preset: {
        columns: {
          name: true,
        },
      },
    },
  });

  return { userId: user.id, presets, history };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env } = context;
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      keybindings: true,
      playerConfig: true,
      keyRemaps: true,
    },
  });

  if (!user) {
    return { error: "ユーザーが見つかりません" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const now = new Date();

  // プリセット作成（現在の設定を保存）
  if (intent === "create-preset") {
    const name = formData.get("name") as string;
    const description = formData.get("description") as string | null;

    if (!name?.trim()) {
      return { error: "プリセット名を入力してください" };
    }

    // 共通関数を使用してプリセットを作成
    await createPreset(db, {
      userId: user.id,
      name: name.trim(),
      description: description?.trim() || null,
      isActive: false,
      keybindings: user.keybindings,
      playerConfig: user.playerConfig,
      keyRemaps: user.keyRemaps,
      source: "manual",
    });

    return { success: true, message: "プリセットを作成しました" };
  }

  // プリセット削除
  if (intent === "delete-preset") {
    const presetId = formData.get("presetId") as string;

    const preset = await db.query.configPresets.findFirst({
      where: eq(configPresets.id, presetId),
    });

    if (!preset || preset.userId !== user.id) {
      return { error: "プリセットが見つかりません" };
    }

    await db.delete(configPresets).where(eq(configPresets.id, presetId));

    // 履歴に記録
    await db.insert(configHistory).values({
      id: createId(),
      userId: user.id,
      changeType: "preset_switch",
      changeDescription: `プリセット「${preset.name}」を削除`,
      createdAt: now,
    });

    return { success: true, message: "プリセットを削除しました" };
  }

  // プリセット適用
  if (intent === "apply-preset") {
    const presetId = formData.get("presetId") as string;

    const preset = await db.query.configPresets.findFirst({
      where: eq(configPresets.id, presetId),
    });

    if (!preset || preset.userId !== user.id) {
      return { error: "プリセットが見つかりません" };
    }

    // 現在の設定をバックアップ（履歴用）
    const previousKeybindings = JSON.stringify(user.keybindings);

    // キーバインドを復元
    if (preset.keybindingsData) {
      const keybindingsFromPreset = JSON.parse(preset.keybindingsData) as Array<{
        action: string;
        keyCode: string;
        category: string;
      }>;

      for (const kbData of keybindingsFromPreset) {
        const existingKb = user.keybindings.find((kb) => kb.action === kbData.action);
        if (existingKb) {
          await db
            .update(keybindings)
            .set({ keyCode: kbData.keyCode, updatedAt: now })
            .where(eq(keybindings.id, existingKb.id));
        }
      }
    }

    // プレイヤー設定を復元
    if (preset.playerConfigData && user.playerConfig) {
      const configFromPreset = JSON.parse(preset.playerConfigData);
      await db
        .update(playerConfigs)
        .set({
          ...configFromPreset,
          fingerAssignments: preset.fingerAssignmentsData,
          updatedAt: now,
        })
        .where(eq(playerConfigs.id, user.playerConfig.id));
    }

    // リマップを復元
    if (preset.remapsData) {
      // 既存のリマップを削除
      await db.delete(keyRemaps).where(eq(keyRemaps.userId, user.id));

      // プリセットのリマップを追加
      const remapsFromPreset = JSON.parse(preset.remapsData) as Array<{
        sourceKey: string;
        targetKey: string | null;
        software: string | null;
        notes: string | null;
      }>;

      for (const remapData of remapsFromPreset) {
        await db.insert(keyRemaps).values({
          id: createId(),
          userId: user.id,
          sourceKey: remapData.sourceKey,
          targetKey: remapData.targetKey,
          software: remapData.software,
          notes: remapData.notes,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // 全てのプリセットを非アクティブに
    await db
      .update(configPresets)
      .set({ isActive: false, updatedAt: now })
      .where(eq(configPresets.userId, user.id));

    // このプリセットをアクティブに
    await db
      .update(configPresets)
      .set({ isActive: true, updatedAt: now })
      .where(eq(configPresets.id, presetId));

    // 履歴に記録
    await db.insert(configHistory).values({
      id: createId(),
      userId: user.id,
      changeType: "preset_switch",
      changeDescription: `プリセット「${preset.name}」を適用`,
      previousData: previousKeybindings,
      newData: preset.keybindingsData,
      presetId,
      createdAt: now,
    });

    return { success: true, message: `プリセット「${preset.name}」を適用しました` };
  }

  return { error: "不明な操作です" };
}

export default function PresetsPage() {
  const { presets, history } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDescription, setNewPresetDescription] = useState("");

  const isSubmitting = fetcher.state === "submitting";

  // トースト通知
  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(data.message);
      setIsCreateDialogOpen(false);
      setNewPresetName("");
      setNewPresetDescription("");
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  const handleCreatePreset = () => {
    if (!newPresetName.trim()) {
      toast.error("プリセット名を入力してください");
      return;
    }

    const formData = new FormData();
    formData.set("intent", "create-preset");
    formData.set("name", newPresetName);
    formData.set("description", newPresetDescription);
    fetcher.submit(formData, { method: "post" });
  };

  const changeTypeLabels: Record<string, string> = {
    keybinding: "キー配置",
    device: "デバイス",
    game_setting: "ゲーム設定",
    remap: "リマップ",
    preset_switch: "プリセット",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">設定プリセット</h1>
        <p className="text-muted-foreground">
          キー配置やデバイス設定を名前をつけて保存・復元できます
        </p>
      </div>

      {/* プリセット一覧 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">プリセット一覧</CardTitle>
            <CardDescription>保存した設定プリセット</CardDescription>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                現在の設定を保存
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>プリセットを作成</DialogTitle>
                <DialogDescription>
                  現在のキー配置・デバイス設定を新しいプリセットとして保存します
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="preset-name">プリセット名</Label>
                  <Input
                    id="preset-name"
                    placeholder="例: メイン設定、練習用"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preset-description">説明（任意）</Label>
                  <Textarea
                    id="preset-description"
                    placeholder="このプリセットの説明..."
                    value={newPresetDescription}
                    onChange={(e) => setNewPresetDescription(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreatePreset}
                  disabled={isSubmitting || !newPresetName.trim()}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  保存
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {presets.length > 0 ? (
            <div className="space-y-3">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{preset.name}</p>
                      {preset.isActive && (
                        <Badge variant="default" className="shrink-0">
                          <Check className="h-3 w-3 mr-1" />
                          適用中
                        </Badge>
                      )}
                    </div>
                    {preset.description && (
                      <p className="text-sm text-muted-foreground truncate mt-1">
                        {preset.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      更新: {formatDistanceToNow(new Date(preset.updatedAt), { addSuffix: true, locale: ja })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {!preset.isActive && (
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="apply-preset" />
                        <input type="hidden" name="presetId" value={preset.id} />
                        <Button type="submit" variant="outline" size="sm" disabled={isSubmitting}>
                          <ArrowRight className="h-4 w-4 mr-1" />
                          適用
                        </Button>
                      </fetcher.Form>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>プリセットを削除</AlertDialogTitle>
                          <AlertDialogDescription>
                            「{preset.name}」を削除しますか？この操作は取り消せません。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>キャンセル</AlertDialogCancel>
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="delete-preset" />
                            <input type="hidden" name="presetId" value={preset.id} />
                            <AlertDialogAction type="submit" className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              削除
                            </AlertDialogAction>
                          </fetcher.Form>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Save className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>プリセットがありません</p>
              <p className="text-sm mt-1">
                「現在の設定を保存」をクリックして、最初のプリセットを作成しましょう
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 変更履歴 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-5 w-5" />
            変更履歴
          </CardTitle>
          <CardDescription>設定の変更履歴（最新20件）</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length > 0 ? (
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 py-2 border-b last:border-0"
                >
                  <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{entry.changeDescription}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {changeTypeLabels[entry.changeType] ?? entry.changeType}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true, locale: ja })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-4 text-muted-foreground text-sm">
              変更履歴はありません
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
