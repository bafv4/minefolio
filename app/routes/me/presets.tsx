import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/presets";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, configPresets, configHistory, keybindings, playerConfigs, keyRemaps, itemLayouts, searchCrafts, type Keybinding, type PlayerConfig, type KeyRemap, type ItemLayout, type SearchCraft } from "@/lib/schema";
import { eq, desc, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createPreset, serializeKeybindings, serializePlayerConfig, serializeRemaps, serializeItemLayouts, serializeSearchCrafts, type PresetKeybindingData, type PresetRemapData, type PresetPlayerConfigData, type PresetItemLayoutData, type PresetSearchCraftData } from "@/lib/preset-utils";
import { DEFAULT_KEYBINDINGS } from "@/lib/defaults";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { Save, Trash2, Check, Plus, History, Clock, ArrowRight, Loader2, Copy, Keyboard, Mouse, Package, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";

export const meta: Route.MetaFunction = () => {
  return [{ title: "設定プリセット - Minefolio" }];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
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
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      keybindings: true,
      playerConfig: true,
      keyRemaps: true,
      itemLayouts: true,
      searchCrafts: true,
    },
  });

  if (!user) {
    return { error: "ユーザーが見つかりません" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const now = new Date();

  // プリセット作成（現在の設定を保存 or 既存プリセットからコピー）
  if (intent === "create-preset") {
    const name = formData.get("name") as string;
    const description = formData.get("description") as string | null;
    const sourceType = formData.get("sourceType") as string; // "current" or "copy"
    const sourcePresetId = formData.get("sourcePresetId") as string | null;

    if (!name?.trim()) {
      return { error: "プリセット名を入力してください" };
    }

    // 全ての既存プリセットを非アクティブに
    await db
      .update(configPresets)
      .set({ isActive: false, updatedAt: now })
      .where(eq(configPresets.userId, user.id));

    // 既存のkeybindings/keyRemaps/playerConfigs/itemLayouts/searchCraftsを削除
    await db.delete(keybindings).where(eq(keybindings.userId, user.id));
    await db.delete(keyRemaps).where(eq(keyRemaps.userId, user.id));
    await db.delete(playerConfigs).where(eq(playerConfigs.userId, user.id));
    await db.delete(itemLayouts).where(eq(itemLayouts.userId, user.id));
    await db.delete(searchCrafts).where(eq(searchCrafts.userId, user.id));

    const presetId = createId();

    if (sourceType === "copy" && sourcePresetId) {
      // 既存プリセットからコピー
      const sourcePreset = await db.query.configPresets.findFirst({
        where: eq(configPresets.id, sourcePresetId),
      });

      if (!sourcePreset || sourcePreset.userId !== user.id) {
        return { error: "コピー元のプリセットが見つかりません" };
      }

      // プリセットを作成（アクティブ状態で）
      await db.insert(configPresets).values({
        id: presetId,
        userId: user.id,
        name: name.trim(),
        description: description?.trim() || null,
        isActive: true,
        keybindingsData: sourcePreset.keybindingsData,
        playerConfigData: sourcePreset.playerConfigData,
        remapsData: sourcePreset.remapsData,
        fingerAssignmentsData: sourcePreset.fingerAssignmentsData,
        itemLayoutsData: sourcePreset.itemLayoutsData,
        searchCraftsData: sourcePreset.searchCraftsData,
        createdAt: now,
        updatedAt: now,
      });

      // プリセットのデータを実際のテーブルに展開
      // キーバインドを作成
      if (sourcePreset.keybindingsData) {
        const kbData = JSON.parse(sourcePreset.keybindingsData) as PresetKeybindingData[];
        for (const kb of kbData) {
          await db.insert(keybindings).values({
            id: createId(),
            userId: user.id,
            action: kb.action,
            keyCode: kb.keyCode,
            category: kb.category as "movement" | "combat" | "inventory" | "ui",
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // プレイヤー設定を作成
      if (sourcePreset.playerConfigData) {
        const configData = JSON.parse(sourcePreset.playerConfigData) as PresetPlayerConfigData;
        await db.insert(playerConfigs).values({
          id: createId(),
          userId: user.id,
          keyboardLayout: configData.keyboardLayout as "JIS" | "US" | "JIS_TKL" | "US_TKL" | null,
          keyboardModel: configData.keyboardModel,
          mouseDpi: configData.mouseDpi,
          gameSensitivity: configData.gameSensitivity,
          rawInput: configData.rawInput,
          mouseAcceleration: configData.mouseAcceleration,
          toggleSprint: configData.toggleSprint,
          toggleSneak: configData.toggleSneak,
          autoJump: configData.autoJump,
          fov: configData.fov,
          guiScale: configData.guiScale,
          gameLanguage: configData.gameLanguage,
          fingerAssignments: sourcePreset.fingerAssignmentsData,
          createdAt: now,
          updatedAt: now,
        });
      }

      // リマップを作成
      if (sourcePreset.remapsData) {
        const remapData = JSON.parse(sourcePreset.remapsData) as PresetRemapData[];
        for (const remap of remapData) {
          await db.insert(keyRemaps).values({
            id: createId(),
            userId: user.id,
            sourceKey: remap.sourceKey,
            targetKey: remap.targetKey,
            software: remap.software,
            notes: remap.notes,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // アイテム配置を作成
      if (sourcePreset.itemLayoutsData) {
        const layoutData = JSON.parse(sourcePreset.itemLayoutsData) as PresetItemLayoutData[];
        for (const layout of layoutData) {
          await db.insert(itemLayouts).values({
            id: createId(),
            userId: user.id,
            segment: layout.segment,
            slots: layout.slots,
            offhand: layout.offhand,
            notes: layout.notes,
            displayOrder: layout.displayOrder,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // サーチクラフトを作成
      if (sourcePreset.searchCraftsData) {
        const craftData = JSON.parse(sourcePreset.searchCraftsData) as PresetSearchCraftData[];
        for (const craft of craftData) {
          await db.insert(searchCrafts).values({
            id: createId(),
            userId: user.id,
            sequence: craft.sequence,
            items: craft.items,
            keys: craft.keys,
            searchStr: craft.searchStr,
            comment: craft.comment,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // 履歴に記録
      await db.insert(configHistory).values({
        id: createId(),
        userId: user.id,
        changeType: "preset_switch",
        changeDescription: `プリセット「${sourcePreset.name}」をコピーして「${name.trim()}」を作成・適用`,
        presetId,
        createdAt: now,
      });

      return { success: true, message: `プリセット「${name.trim()}」を作成して適用しました` };
    } else {
      // 現在の設定から作成、またはデフォルト設定から作成
      let keybindingsData: string | null = null;
      let playerConfigData: string | null = null;
      let remapsData: string | null = null;
      let fingerAssignmentsData: string | null = null;
      let itemLayoutsData: string | null = null;
      let searchCraftsData: string | null = null;

      if (user.keybindings.length > 0) {
        // 現在の設定がある場合はそれを使用
        keybindingsData = serializeKeybindings(user.keybindings);
        playerConfigData = user.playerConfig ? serializePlayerConfig(user.playerConfig) : null;
        remapsData = user.keyRemaps.length > 0 ? serializeRemaps(user.keyRemaps) : null;
        fingerAssignmentsData = user.playerConfig?.fingerAssignments ?? null;
        itemLayoutsData = user.itemLayouts.length > 0 ? serializeItemLayouts(user.itemLayouts) : null;
        searchCraftsData = user.searchCrafts.length > 0 ? serializeSearchCrafts(user.searchCrafts) : null;

        // 既存設定をコピー（削除後に再作成）
        for (const kb of user.keybindings) {
          await db.insert(keybindings).values({
            id: createId(),
            userId: user.id,
            action: kb.action,
            keyCode: kb.keyCode,
            category: kb.category,
            createdAt: now,
            updatedAt: now,
          });
        }

        if (user.playerConfig) {
          await db.insert(playerConfigs).values({
            id: createId(),
            userId: user.id,
            keyboardLayout: user.playerConfig.keyboardLayout,
            keyboardModel: user.playerConfig.keyboardModel,
            mouseDpi: user.playerConfig.mouseDpi,
            gameSensitivity: user.playerConfig.gameSensitivity,
            rawInput: user.playerConfig.rawInput,
            mouseAcceleration: user.playerConfig.mouseAcceleration,
            toggleSprint: user.playerConfig.toggleSprint,
            toggleSneak: user.playerConfig.toggleSneak,
            autoJump: user.playerConfig.autoJump,
            fov: user.playerConfig.fov,
            guiScale: user.playerConfig.guiScale,
            gameLanguage: user.playerConfig.gameLanguage,
            fingerAssignments: user.playerConfig.fingerAssignments,
            createdAt: now,
            updatedAt: now,
          });
        }

        for (const remap of user.keyRemaps) {
          await db.insert(keyRemaps).values({
            id: createId(),
            userId: user.id,
            sourceKey: remap.sourceKey,
            targetKey: remap.targetKey,
            software: remap.software,
            notes: remap.notes,
            createdAt: now,
            updatedAt: now,
          });
        }

        for (const layout of user.itemLayouts) {
          await db.insert(itemLayouts).values({
            id: createId(),
            userId: user.id,
            segment: layout.segment,
            slots: layout.slots,
            offhand: layout.offhand,
            notes: layout.notes,
            displayOrder: layout.displayOrder,
            createdAt: now,
            updatedAt: now,
          });
        }

        for (const craft of user.searchCrafts) {
          await db.insert(searchCrafts).values({
            id: createId(),
            userId: user.id,
            sequence: craft.sequence,
            items: craft.items,
            keys: craft.keys,
            searchStr: craft.searchStr,
            comment: craft.comment,
            createdAt: now,
            updatedAt: now,
          });
        }
      } else {
        // デフォルト設定を使用
        const defaultKbs = DEFAULT_KEYBINDINGS.map((kb) => ({
          action: kb.action,
          keyCode: kb.keyCode,
          category: kb.category,
        }));
        keybindingsData = JSON.stringify(defaultKbs);

        // デフォルトキーバインドを作成
        for (const kb of DEFAULT_KEYBINDINGS) {
          await db.insert(keybindings).values({
            id: createId(),
            userId: user.id,
            action: kb.action,
            keyCode: kb.keyCode,
            category: kb.category,
            createdAt: now,
            updatedAt: now,
          });
        }

        // デフォルトプレイヤー設定を作成
        await db.insert(playerConfigs).values({
          id: createId(),
          userId: user.id,
          keyboardLayout: "US",
          mouseAcceleration: false,
          rawInput: true,
          createdAt: now,
          updatedAt: now,
        });

        playerConfigData = JSON.stringify({
          keyboardLayout: "US",
          mouseAcceleration: false,
          rawInput: true,
        });
      }

      // プリセットを作成（アクティブ状態で）
      await db.insert(configPresets).values({
        id: presetId,
        userId: user.id,
        name: name.trim(),
        description: description?.trim() || null,
        isActive: true,
        keybindingsData,
        playerConfigData,
        remapsData,
        fingerAssignmentsData,
        itemLayoutsData,
        searchCraftsData,
        createdAt: now,
        updatedAt: now,
      });

      // 履歴に記録
      await db.insert(configHistory).values({
        id: createId(),
        userId: user.id,
        changeType: "preset_switch",
        changeDescription: `プリセット「${name.trim()}」を作成・適用`,
        presetId,
        createdAt: now,
      });

      return { success: true, message: `プリセット「${name.trim()}」を作成して適用しました` };
    }
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

    // アイテム配置を復元
    if (preset.itemLayoutsData) {
      // 既存のアイテム配置を削除
      await db.delete(itemLayouts).where(eq(itemLayouts.userId, user.id));

      // プリセットのアイテム配置を追加
      const layoutsFromPreset = JSON.parse(preset.itemLayoutsData) as Array<{
        segment: string;
        slots: string;
        offhand: string | null;
        notes: string | null;
        displayOrder: number;
      }>;

      for (const layoutData of layoutsFromPreset) {
        await db.insert(itemLayouts).values({
          id: createId(),
          userId: user.id,
          segment: layoutData.segment,
          slots: layoutData.slots,
          offhand: layoutData.offhand,
          notes: layoutData.notes,
          displayOrder: layoutData.displayOrder,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // サーチクラフトを復元
    if (preset.searchCraftsData) {
      // 既存のサーチクラフトを削除
      await db.delete(searchCrafts).where(eq(searchCrafts.userId, user.id));

      // プリセットのサーチクラフトを追加
      const craftsFromPreset = JSON.parse(preset.searchCraftsData) as Array<{
        sequence: number;
        items: string;
        keys: string;
        searchStr: string | null;
        comment: string | null;
      }>;

      for (const craftData of craftsFromPreset) {
        await db.insert(searchCrafts).values({
          id: createId(),
          userId: user.id,
          sequence: craftData.sequence,
          items: craftData.items,
          keys: craftData.keys,
          searchStr: craftData.searchStr,
          comment: craftData.comment,
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
  const [sourceType, setSourceType] = useState<"current" | "copy">("current");
  const [sourcePresetId, setSourcePresetId] = useState<string>("");

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
      setSourceType("current");
      setSourcePresetId("");
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  const handleCreatePreset = () => {
    if (!newPresetName.trim()) {
      toast.error("プリセット名を入力してください");
      return;
    }

    if (sourceType === "copy" && !sourcePresetId) {
      toast.error("コピー元のプリセットを選択してください");
      return;
    }

    const formData = new FormData();
    formData.set("intent", "create-preset");
    formData.set("name", newPresetName);
    formData.set("description", newPresetDescription);
    formData.set("sourceType", sourceType);
    if (sourceType === "copy" && sourcePresetId) {
      formData.set("sourcePresetId", sourcePresetId);
    }
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
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">プリセット一覧</CardTitle>
            <CardDescription>保存した設定プリセット</CardDescription>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
            setIsCreateDialogOpen(open);
            if (!open) {
              setNewPresetName("");
              setNewPresetDescription("");
              setSourceType("current");
              setSourcePresetId("");
            }
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                新規プリセット
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>プリセットを作成</DialogTitle>
                <DialogDescription>
                  新しいプリセットを作成します
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {/* ソース選択 */}
                <div className="space-y-3">
                  <Label>作成方法</Label>
                  <RadioGroup
                    value={sourceType}
                    onValueChange={(value) => setSourceType(value as "current" | "copy")}
                    className="space-y-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="current" id="source-current" />
                      <Label htmlFor="source-current" className="cursor-pointer font-normal">
                        現在の設定から作成
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="copy" id="source-copy" disabled={presets.length === 0} />
                      <Label htmlFor="source-copy" className={`cursor-pointer font-normal ${presets.length === 0 ? "text-muted-foreground" : ""}`}>
                        既存のプリセットをコピー
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* コピー元プリセット選択 */}
                {sourceType === "copy" && presets.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="source-preset">コピー元プリセット</Label>
                    <Select value={sourcePresetId} onValueChange={setSourcePresetId}>
                      <SelectTrigger>
                        <SelectValue placeholder="プリセットを選択" />
                      </SelectTrigger>
                      <SelectContent>
                        {presets.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            <div className="flex items-center gap-2">
                              <Copy className="h-3 w-3" />
                              {preset.name}
                              {preset.isActive && (
                                <Badge variant="outline" className="text-xs ml-1">
                                  適用中
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

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
                  disabled={isSubmitting || !newPresetName.trim() || (sourceType === "copy" && !sourcePresetId)}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : sourceType === "copy" ? (
                    <Copy className="h-4 w-4 mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {sourceType === "copy" ? "コピーして作成" : "保存"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {presets.length > 0 ? (
            <div className="space-y-3">
              {presets.map((preset) => {
                // プリセットに含まれる内容を計算
                const hasKeybindings = !!preset.keybindingsData;
                const hasPlayerConfig = !!preset.playerConfigData;
                const hasRemaps = !!preset.remapsData;
                const hasItemLayouts = !!preset.itemLayoutsData;
                const hasSearchCrafts = !!preset.searchCraftsData;

                // キーバインド数を計算
                let keybindingsCount = 0;
                if (preset.keybindingsData) {
                  try {
                    keybindingsCount = JSON.parse(preset.keybindingsData).length;
                  } catch {}
                }

                // アイテム配置数を計算
                let itemLayoutsCount = 0;
                if (preset.itemLayoutsData) {
                  try {
                    itemLayoutsCount = JSON.parse(preset.itemLayoutsData).length;
                  } catch {}
                }

                // サーチクラフト数を計算
                let searchCraftsCount = 0;
                if (preset.searchCraftsData) {
                  try {
                    searchCraftsCount = JSON.parse(preset.searchCraftsData).length;
                  } catch {}
                }

                return (
                  <div
                    key={preset.id}
                    className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
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

                        {/* 含まれる内容をアイコンで表示 */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {hasKeybindings && (
                            <Badge variant="secondary" className="text-xs py-0.5">
                              <Keyboard className="h-3 w-3 mr-1" />
                              キー配置 {keybindingsCount > 0 && `(${keybindingsCount})`}
                            </Badge>
                          )}
                          {hasPlayerConfig && (
                            <Badge variant="secondary" className="text-xs py-0.5">
                              <Mouse className="h-3 w-3 mr-1" />
                              デバイス
                            </Badge>
                          )}
                          {hasItemLayouts && (
                            <Badge variant="secondary" className="text-xs py-0.5">
                              <Package className="h-3 w-3 mr-1" />
                              アイテム {itemLayoutsCount > 0 && `(${itemLayoutsCount})`}
                            </Badge>
                          )}
                          {hasSearchCrafts && (
                            <Badge variant="secondary" className="text-xs py-0.5">
                              <Search className="h-3 w-3 mr-1" />
                              検索 {searchCraftsCount > 0 && `(${searchCraftsCount})`}
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground mt-2">
                          更新: {formatDistanceToNow(new Date(preset.updatedAt), { addSuffix: true, locale: ja })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!preset.isActive && (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="apply-preset" />
                            <input type="hidden" name="presetId" value={preset.id} />
                            <Button type="submit" variant="outline" size="sm" disabled={isSubmitting} className="touch-manipulation">
                              <ArrowRight className="h-4 w-4 sm:mr-1" />
                              <span className="hidden sm:inline">適用</span>
                            </Button>
                          </fetcher.Form>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive touch-manipulation">
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
                  </div>
                );
              })}
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
