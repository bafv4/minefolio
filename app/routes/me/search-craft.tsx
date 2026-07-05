import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLoaderData, useFetcher, Link, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/search-craft";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCrafts, configPresets } from "@/lib/schema";
import { eq, asc, and } from "drizzle-orm";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createId } from "@paralleldrive/cuid2";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Search,
  Plus,
  AlertCircle,
  Settings,
  Copy,
  Share2,
} from "lucide-react";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { SearchCraftListEditor, arrayMove } from "@/components/search-craft-editor";
import { toUiRemaps } from "@/lib/remap-utils";
import { t } from "@/lib/messages";
import { syncActivePresetSnapshot, assertPresetIsActive, PresetMismatchError } from "@/lib/preset-utils";
import { configHistory } from "@/lib/schema";
import { PresetSelector } from "@/components/preset-selector";

export const meta: Route.MetaFunction = () => {
  return [{ title: t("meSearchCraft.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate, formAction }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  // /me/presets でのアクション（プリセット切替・作成・削除）の後は再検証する
  if (formAction === "/me/presets") {
    return true;
  }
  return false;
}

// mcitemsのテクスチャベースURL
const TEXTURE_BASE_URL = "/mcitems";

type SearchCraftItem = {
  id: string;
  sequence: number;
  items: string[];
  keys: string[];
  searchStr: string | null;
  comment: string | null;
  timing: "bastion" | "fortress" | "other" | null;
};


export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      searchCrafts: {
        orderBy: [asc(searchCrafts.sequence)],
      },
      keyRemaps: true,
    },
  });

  if (!user) {
    throw new Response(t("meSearchCraft.userNotFound"), { status: 404 });
  }

  // Parse JSON fields
  const crafts: SearchCraftItem[] = user.searchCrafts.map((craft) => ({
    id: craft.id,
    sequence: craft.sequence,
    items: JSON.parse(craft.items) as string[],
    keys: JSON.parse(craft.keys) as string[],
    searchStr: craft.searchStr,
    comment: craft.comment,
    timing: craft.timing ?? null,
  }));

  // 全プリセットを取得（コピー機能用）
  const allPresets = await db.query.configPresets.findMany({
    where: eq(configPresets.userId, user.id),
    columns: {
      id: true,
      name: true,
      isActive: true,
      searchCraftsData: true,
    },
  });

  // アクティブなプリセットを取得
  const activePreset = allPresets.find((p) => p.isActive);

  return {
    userId: user.id,
    crafts,
    // 入力キーのライブプレビュー用（表示専用）
    remaps: toUiRemaps(user.keyRemaps),
    activePreset: activePreset ? { id: activePreset.id, name: activePreset.name } : null,
    hasPresets: allPresets.length > 0,
    presets: allPresets.map((p) => ({
      id: p.id,
      name: p.name,
      isActive: p.isActive,
      hasSearchCrafts: !!p.searchCraftsData,
      searchCraftsData: p.searchCraftsData,
    })),
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-36 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-11 sm:h-10 w-full sm:w-20" />
      </div>
      {/* 説明カード */}
      <div className="rounded-lg border border-dashed bg-secondary/30 p-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4 mt-1" />
      </div>
      {/* クラフトカード */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Skeleton className="h-6 w-6" />
                <Skeleton className="h-6 w-6" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="flex items-center gap-1">
                      <Skeleton className="h-8 w-24" />
                      {j < 2 && <Skeleton className="h-3 w-3" />}
                    </div>
                  ))}
                </div>
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="flex gap-1">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8" />
              </div>
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
    return { error: t("meSearchCraft.userNotFound") };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;
  const presetId = (formData.get("presetId") as string | null) || null;

  try {
    await assertPresetIsActive(db, user.id, presetId);
  } catch (e) {
    if (e instanceof PresetMismatchError) {
      return { error: t("mePresets.staleSession") };
    }
    throw e;
  }

  if (actionType === "saveAll") {
    const craftsJson = formData.get("crafts") as string;

    try {
      const crafts = JSON.parse(craftsJson) as SearchCraftItem[];

      const now = new Date();
      await db.transaction(async (tx) => {
        // 既存のサーチクラフトを全削除
        await tx.delete(searchCrafts).where(eq(searchCrafts.userId, user.id));

        // 新しいサーチクラフトを挿入
        for (let i = 0; i < crafts.length; i++) {
          const craft = crafts[i];
          await tx.insert(searchCrafts).values({
            id: craft.id.startsWith("new-") ? createId() : craft.id,
            userId: user.id,
            sequence: i + 1,
            items: JSON.stringify(craft.items),
            keys: JSON.stringify([]), // keysは使用しない（後方互換性のため空配列で保持）
            searchStr: craft.searchStr || null,
            comment: craft.comment || null,
            timing: craft.timing || null,
            createdAt: now,
            updatedAt: now,
          });
        }
      });

      // アクティブプリセットスナップショット同期
      await syncActivePresetSnapshot(db, user.id, ["searchCrafts"]);

      // 変更履歴を記録
      await db.insert(configHistory).values({
        id: createId(),
        userId: user.id,
        changeType: "game_setting",
        changeDescription: t("meSearchCraft.searchCraftChangeHistory"),
        createdAt: now,
      });

      return { success: true };
    } catch (error) {
      console.error("Save error:", error);
      return { error: t("meSearchCraft.saveFailed") };
    }
  }

  return { error: t("meSearchCraft.unknownAction") };
}

// ItemSelectDialog / EditableSearchCraftCard は @/components/search-craft-editor に抽出済み

export default function SearchCraftPage() {
  const { crafts: initialCrafts, remaps, activePreset, hasPresets, presets } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [crafts, setCrafts] = useState<SearchCraftItem[]>(initialCrafts);
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);

  const isSubmitting = fetcher.state === "submitting";

  // loaderデータが更新されたらローカル状態も更新
  useEffect(() => {
    setCrafts(initialCrafts);
  }, [initialCrafts]);

  // 保存結果の処理
  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(t("meSearchCraft.saveSuccess"));
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  // 変更検知
  const hasChanges = useMemo(() => {
    if (crafts.length !== initialCrafts.length) return true;
    return JSON.stringify(crafts) !== JSON.stringify(initialCrafts);
  }, [crafts, initialCrafts]);

  const handleUpdateCraft = useCallback((index: number, updated: SearchCraftItem) => {
    setCrafts((prev) => {
      const newCrafts = [...prev];
      newCrafts[index] = updated;
      return newCrafts;
    });
  }, []);

  const handleDeleteCraft = useCallback((index: number) => {
    setCrafts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddCraft = useCallback(() => {
    const newCraft: SearchCraftItem = {
      id: `new-${Date.now()}`,
      sequence: crafts.length + 1,
      items: [],
      keys: [],
      searchStr: null,
      comment: null,
      timing: null,
    };
    setCrafts((prev) => [...prev, newCraft]);
  }, [crafts.length]);

  const handleReorder = useCallback((oldIndex: number, newIndex: number) => {
    setCrafts((prev) => arrayMove(prev, oldIndex, newIndex));
  }, []);

  const handleSave = useCallback(() => {
    // バリデーション
    const emptyCrafts = crafts.filter((c) => c.items.length === 0);
    if (emptyCrafts.length > 0) {
      toast.error(t("meSearchCraft.selectAtLeastOneItem"));
      return;
    }

    const emptySearchStr = crafts.filter((c) => !c.searchStr);
    if (emptySearchStr.length > 0) {
      toast.error(t("meSearchCraft.craftStringRequired"));
      return;
    }

    const formData = new FormData();
    formData.set("_action", "saveAll");
    formData.set("crafts", JSON.stringify(crafts));
    if (activePreset) {
      formData.set("presetId", activePreset.id);
    }
    fetcher.submit(formData, { method: "post" });
  }, [crafts, fetcher, activePreset]);

  const handleReset = useCallback(() => {
    setCrafts(initialCrafts);
  }, [initialCrafts]);

  // プリセットからコピー
  const handleCopyFromPreset = useCallback((presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || !preset.searchCraftsData) {
      toast.error(t("meSearchCraft.copyNoData"));
      return;
    }

    try {
      const searchCraftsDataParsed = JSON.parse(preset.searchCraftsData) as SearchCraftItem[];
      setCrafts(searchCraftsDataParsed.map((craft, idx) => ({
        ...craft,
        id: `new-${Date.now()}-${idx}`,
      })));
      toast.success(t("meSearchCraft.copiedFromPreset", { name: preset.name }));
    } catch (e) {
      console.error("Failed to parse search crafts data:", e);
      toast.error(t("meSearchCraft.parseFailed"));
    }

    setCopyDialogOpen(false);
  }, [presets]);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("meSearchCraft.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("meSearchCraft.pageDescription")}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button asChild variant="outline" className="w-full sm:w-auto h-11 sm:h-10">
            <Link to="/my-guides/templates">
              <Share2 className="mr-2 h-4 w-4" />
              {t("meSearchCraft.publishAsTemplate")}
            </Link>
          </Button>
          <Button onClick={handleAddCraft} disabled={!hasPresets} className="w-full sm:w-auto h-11 sm:h-10">
            <Plus className="mr-2 h-4 w-4" />
            {t("meSearchCraft.add")}
          </Button>
        </div>
      </div>

      {/* プリセットセレクター */}
      <PresetSelector
        presets={presets.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))}
        activePresetId={activePreset?.id ?? null}
        hasChanges={hasChanges}
        onCopyFromOther={presets.length > 1 ? () => setCopyDialogOpen(true) : undefined}
      />

      <div style={{ pointerEvents: hasPresets ? "auto" : "none", opacity: hasPresets ? 1 : 0.5 }}>
      {crafts.length > 0 ? (
        <Card>
          <CardContent className="py-1">
            <SearchCraftListEditor
              crafts={crafts}
              remaps={remaps}
              onUpdate={handleUpdateCraft}
              onDelete={handleDeleteCraft}
              onReorder={handleReorder}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium">{t("meSearchCraft.emptyTitle")}</p>
            <p className="text-sm text-muted-foreground mb-4">
              {t("meSearchCraft.emptyDescription")}
            </p>
            <Button onClick={handleAddCraft}>
              <Plus className="mr-2 h-4 w-4" />
              {t("meSearchCraft.add")}
            </Button>
          </CardContent>
        </Card>
      )}
      </div>

      <FloatingSaveBar
        hasChanges={hasChanges}
        isSubmitting={isSubmitting}
        onSave={handleSave}
        onReset={handleReset}
      />

      {/* プリセットからコピーダイアログ */}
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("meSearchCraft.copyDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("meSearchCraft.copyDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {presets
                .filter((p) => p.id !== activePreset?.id)
                .map((preset) => (
                  <Button
                    key={preset.id}
                    variant="outline"
                    className="w-full justify-start h-auto py-3"
                    disabled={!preset.hasSearchCrafts}
                    onClick={() => handleCopyFromPreset(preset.id)}
                  >
                    <div className="flex flex-col items-start gap-1">
                      <span className="font-medium">{preset.name}</span>
                      <div className="flex gap-1 flex-wrap">
                        {preset.hasSearchCrafts ? (
                          <Badge variant="secondary" className="text-xs">
                            <Search className="h-3 w-3 mr-1" />
                            {t("meSearchCraft.pageTitle")}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {t("meSearchCraft.noData")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Button>
                ))}
              {presets.filter((p) => p.id !== activePreset?.id).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("meSearchCraft.noOtherPresets")}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
              {t("meSearchCraft.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
            <h2 className="text-2xl font-bold">{t("meSearchCraft.errorTitle")}</h2>
            <p className="text-muted-foreground">
              {t("meSearchCraft.errorDescription")}
            </p>
            <Button onClick={() => window.location.reload()}>
              {t("meSearchCraft.reloadPage")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
