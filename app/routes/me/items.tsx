import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/items";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { users, itemLayouts } from "@/lib/schema";
import { eq, asc, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import {
  Package,
  Plus,
  Trash2,
  Edit,
  Layers,
  ChevronDown,
} from "lucide-react";
import {
  MinecraftItemIcon,
  searchItems,
  formatItemName,
  ITEM_CATEGORIES,
  getItemsByCategory,
  type ItemCategory,
} from "@bafv4/mcitems/1.16/react";
import { FloatingSaveBar } from "@/components/floating-save-bar";

export const meta: Route.MetaFunction = () => {
  return [{ title: "アイテム配置 - Minefolio" }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  return false;
}

// セグメントプリセット
const SEGMENT_PRESETS = [
  "Common",
  "Overworld",
  "Enter Nether",
  "Bastion",
  "Bastion → Fort",
  "Fortress",
  "Blinded / Stronghold",
  "Enter End",
  "Enter End (Zero)",
] as const;

// mcitemsのテクスチャベースURL
const TEXTURE_BASE_URL = "/mcitems";

type Slot = {
  slot: number;
  items: string[];
};

type ItemLayout = {
  id: string;
  segment: string;
  slots: Slot[];
  offhand: string[];
  notes: string | null;
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      itemLayouts: {
        orderBy: [asc(itemLayouts.displayOrder)],
      },
    },
  });

  if (!user) {
    throw new Response("ユーザーが見つかりません", { status: 404 });
  }

  // Parse JSON fields
  const layouts: ItemLayout[] = user.itemLayouts.map((layout) => ({
    id: layout.id,
    segment: layout.segment,
    slots: JSON.parse(layout.slots) as Slot[],
    offhand: layout.offhand ? JSON.parse(layout.offhand) : [],
    notes: layout.notes,
  }));

  return { userId: user.id, layouts };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-20" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5" />
                <Skeleton className="h-5 w-32" />
              </div>
              <div className="flex gap-1">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8" />
              </div>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              <Skeleton className="w-10 h-10 shrink-0" />
              <div className="w-px h-8 bg-border shrink-0" />
              {Array.from({ length: 9 }).map((_, j) => (
                <Skeleton key={j} className="w-10 h-10 shrink-0" />
              ))}
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
  const actionType = formData.get("_action") as string;

  if (actionType === "saveAll") {
    const layoutsJson = formData.get("layouts") as string;

    try {
      const layouts = JSON.parse(layoutsJson) as ItemLayout[];

      // 既存のレイアウトを全削除
      await db.delete(itemLayouts).where(eq(itemLayouts.userId, user.id));

      // 新しいレイアウトを挿入
      const now = new Date();
      for (let i = 0; i < layouts.length; i++) {
        const layout = layouts[i];
        await db.insert(itemLayouts).values({
          id: layout.id.startsWith("new-") ? createId() : layout.id,
          userId: user.id,
          segment: layout.segment,
          slots: JSON.stringify(layout.slots),
          offhand: JSON.stringify(layout.offhand),
          notes: layout.notes || null,
          displayOrder: i,
          createdAt: now,
          updatedAt: now,
        });
      }

      return { success: true };
    } catch (error) {
      console.error("Save error:", error);
      return { error: "データの保存に失敗しました" };
    }
  }

  return { error: "不明なアクション" };
}

// ホットバースロットコンポーネント
function HotbarSlot({
  slot,
  items,
  onItemsChange,
  isOffhand = false,
}: {
  slot: number;
  items: string[];
  onItemsChange: (items: string[]) => void;
  isOffhand?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory>("all");

  // mcitemsから検索
  const filteredItems = search
    ? searchItems(search)
    : getItemsByCategory(selectedCategory);

  const toggleItem = (itemId: string) => {
    // minecraft: プレフィックスを正規化
    const normalizedId = itemId.startsWith("minecraft:") ? itemId : `minecraft:${itemId}`;
    if (items.includes(normalizedId)) {
      onItemsChange(items.filter((i) => i !== normalizedId));
    } else {
      onItemsChange([...items, normalizedId]);
    }
  };

  const isItemSelected = (itemId: string) => {
    const normalizedId = itemId.startsWith("minecraft:") ? itemId : `minecraft:${itemId}`;
    return items.includes(normalizedId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="relative w-10 h-10 bg-secondary/50 border-2 border-border/50 rounded flex items-center justify-center hover:border-primary/50 transition-colors group"
        >
          {items.length > 0 ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <MinecraftItemIcon
                itemId={items[0]}
                size={28}
                textureBaseUrl={TEXTURE_BASE_URL}
                className="pixelated"
              />
              {items.length > 1 && (
                <span className="absolute bottom-0 right-0 text-[10px] bg-background/80 px-0.5 rounded">
                  +{items.length - 1}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">
              {isOffhand ? "オフ" : slot}
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isOffhand ? "オフハンド" : `スロット ${slot}`} のアイテム
          </DialogTitle>
          <DialogDescription>
            このスロットに入れるアイテムを選択してください（複数選択可）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="アイテムを検索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
            />
            <Select
              value={selectedCategory}
              onValueChange={(v) => setSelectedCategory(v as ItemCategory)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEM_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 選択中のアイテム */}
          {items.length > 0 && (
            <div className="flex flex-wrap gap-1 p-2 bg-secondary/30 rounded-lg">
              {items.map((itemId) => (
                <Badge
                  key={itemId}
                  variant="secondary"
                  className="cursor-pointer flex items-center gap-1 pl-1"
                  onClick={() => toggleItem(itemId)}
                >
                  <MinecraftItemIcon
                    itemId={itemId}
                    size={16}
                    textureBaseUrl={TEXTURE_BASE_URL}
                    className="pixelated"
                  />
                  {formatItemName(itemId)}
                  <span className="ml-1 text-muted-foreground">×</span>
                </Badge>
              ))}
            </div>
          )}

          {/* アイテムリスト */}
          <div className="grid grid-cols-8 gap-1 max-h-64 overflow-y-auto p-1">
            {filteredItems.slice(0, 200).map((itemId) => (
              <button
                key={itemId}
                type="button"
                onClick={() => toggleItem(itemId)}
                className={`w-10 h-10 flex items-center justify-center rounded border-2 transition-colors ${
                  isItemSelected(itemId)
                    ? "border-primary bg-primary/20"
                    : "border-transparent hover:border-border hover:bg-secondary/50"
                }`}
                title={formatItemName(itemId)}
              >
                <MinecraftItemIcon
                  itemId={itemId}
                  size={32}
                  textureBaseUrl={TEXTURE_BASE_URL}
                  className="pixelated"
                />
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onItemsChange([])}>
            クリア
          </Button>
          <DialogClose asChild>
            <Button>完了</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ホットバー全体コンポーネント
function Hotbar({
  slots,
  offhand,
  onSlotsChange,
  onOffhandChange,
}: {
  slots: Slot[];
  offhand: string[];
  onSlotsChange: (slots: Slot[]) => void;
  onOffhandChange: (items: string[]) => void;
}) {
  const updateSlot = (slotNum: number, items: string[]) => {
    const newSlots = slots.map((s) =>
      s.slot === slotNum ? { ...s, items } : s
    );
    // スロットが存在しない場合は追加
    if (!slots.find((s) => s.slot === slotNum)) {
      newSlots.push({ slot: slotNum, items });
    }
    onSlotsChange(newSlots);
  };

  const getSlotItems = (slotNum: number): string[] => {
    return slots.find((s) => s.slot === slotNum)?.items || [];
  };

  return (
    <div className="flex items-center gap-2">
      {/* オフハンド */}
      <div className="flex flex-col items-center gap-0.5">
        <HotbarSlot
          slot={0}
          items={offhand}
          onItemsChange={onOffhandChange}
          isOffhand
        />
        <span className="text-[10px] text-muted-foreground">オフ</span>
      </div>

      <div className="w-px h-10 bg-border" />

      {/* メインホットバー */}
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((slotNum) => (
          <div key={slotNum} className="flex flex-col items-center gap-0.5">
            <HotbarSlot
              slot={slotNum}
              items={getSlotItems(slotNum)}
              onItemsChange={(items) => updateSlot(slotNum, items)}
            />
            <span className="text-[10px] text-muted-foreground">{slotNum}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// セグメント名入力コンポーネント（プリセット付き）
function SegmentNameInput({
  value,
  onChange,
  existingSegments,
}: {
  value: string;
  onChange: (value: string) => void;
  existingSegments: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  // 未使用のプリセットのみ表示
  const availablePresets = SEGMENT_PRESETS.filter(
    (preset) => preset === value || !existingSegments.includes(preset)
  );

  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="セグメント名を入力..."
        className="flex-1"
      />
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-48 p-1">
          <div className="space-y-0.5">
            {availablePresets.map((preset) => (
              <button
                key={preset}
                type="button"
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-secondary transition-colors"
                onClick={() => {
                  onChange(preset);
                  setIsOpen(false);
                }}
              >
                {preset}
              </button>
            ))}
            {availablePresets.length === 0 && (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                プリセットがありません
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// インライン編集可能なレイアウトカード
function EditableLayoutCard({
  layout,
  onUpdate,
  onDelete,
  existingSegments,
}: {
  layout: ItemLayout;
  onUpdate: (updated: ItemLayout) => void;
  onDelete: () => void;
  existingSegments: string[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSegmentChange = (segment: string) => {
    onUpdate({ ...layout, segment });
  };

  const handleSlotsChange = (slots: Slot[]) => {
    onUpdate({ ...layout, slots });
  };

  const handleOffhandChange = (offhand: string[]) => {
    onUpdate({ ...layout, offhand });
  };

  const handleNotesChange = (notes: string) => {
    onUpdate({ ...layout, notes: notes || null });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <SegmentNameInput
              value={layout.segment}
              onChange={handleSegmentChange}
              existingSegments={existingSegments.filter((s) => s !== layout.segment)}
            />
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>配置を削除しますか？</AlertDialogTitle>
                  <AlertDialogDescription>
                    この操作は保存するまで確定されません。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>削除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* ホットバー編集 */}
        <div className="overflow-x-auto pb-2">
          <div className="min-w-max">
            <Hotbar
              slots={layout.slots}
              offhand={layout.offhand}
              onSlotsChange={handleSlotsChange}
              onOffhandChange={handleOffhandChange}
            />
          </div>
        </div>

        {/* 展開時にメモ表示 */}
        {isExpanded && (
          <div className="mt-4 space-y-2">
            <Label htmlFor={`notes-${layout.id}`}>メモ（任意）</Label>
            <Textarea
              id={`notes-${layout.id}`}
              value={layout.notes || ""}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="この配置についてのメモ..."
              rows={2}
            />
          </div>
        )}

        {/* メモがある場合は折りたたみ時も表示 */}
        {!isExpanded && layout.notes && (
          <p className="text-xs text-muted-foreground mt-2">{layout.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ItemLayoutsPage() {
  const { layouts: initialLayouts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [layouts, setLayouts] = useState<ItemLayout[]>(initialLayouts);
  const prevDataRef = useRef<typeof fetcher.data>(undefined);

  const isSubmitting = fetcher.state === "submitting";

  // loaderデータが更新されたらローカル状態も更新
  useEffect(() => {
    setLayouts(initialLayouts);
  }, [initialLayouts]);

  // 保存結果の処理
  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success("アイテム配置を保存しました");
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  // 変更検知
  const hasChanges = useMemo(() => {
    if (layouts.length !== initialLayouts.length) return true;
    return JSON.stringify(layouts) !== JSON.stringify(initialLayouts);
  }, [layouts, initialLayouts]);

  const handleUpdateLayout = useCallback((index: number, updated: ItemLayout) => {
    setLayouts((prev) => {
      const newLayouts = [...prev];
      newLayouts[index] = updated;
      return newLayouts;
    });
  }, []);

  const handleDeleteLayout = useCallback((index: number) => {
    setLayouts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddLayout = useCallback(() => {
    const newLayout: ItemLayout = {
      id: `new-${Date.now()}`,
      segment: "",
      slots: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ slot: n, items: [] })),
      offhand: [],
      notes: null,
    };
    setLayouts((prev) => [...prev, newLayout]);
  }, []);

  const handleSave = useCallback(() => {
    // バリデーション
    const emptySegments = layouts.filter((l) => !l.segment.trim());
    if (emptySegments.length > 0) {
      toast.error("セグメント名を入力してください");
      return;
    }

    // 重複チェック
    const segments = layouts.map((l) => l.segment.trim().toLowerCase());
    const duplicates = segments.filter((s, i) => segments.indexOf(s) !== i);
    if (duplicates.length > 0) {
      toast.error("同じセグメント名が重複しています");
      return;
    }

    fetcher.submit(
      { _action: "saveAll", layouts: JSON.stringify(layouts) },
      { method: "post" }
    );
  }, [layouts, fetcher]);

  const handleReset = useCallback(() => {
    setLayouts(initialLayouts);
  }, [initialLayouts]);

  const existingSegments = layouts.map((l) => l.segment);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">アイテム配置</h1>
          <p className="text-muted-foreground">
            ゲームの各場面に応じたホットバーやインベントリの配置を設定します。
          </p>
        </div>
        <Button onClick={handleAddLayout}>
          <Plus className="mr-2 h-4 w-4" />
          追加
        </Button>
      </div>

      {layouts.length > 0 ? (
        <div className="space-y-4">
          {layouts.map((layout, index) => (
            <EditableLayoutCard
              key={layout.id}
              layout={layout}
              onUpdate={(updated) => handleUpdateLayout(index, updated)}
              onDelete={() => handleDeleteLayout(index)}
              existingSegments={existingSegments}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium">アイテム配置が設定されていません</p>
            <p className="text-sm text-muted-foreground mb-4">
              ゲームの各場面（オーバーワールド、ネザーなど）ごとにホットバーの配置を設定できます。
            </p>
            <Button onClick={handleAddLayout}>
              <Plus className="mr-2 h-4 w-4" />
              配置を追加
            </Button>
          </CardContent>
        </Card>
      )}

      <FloatingSaveBar
        hasChanges={hasChanges}
        isSubmitting={isSubmitting}
        onSave={handleSave}
        onReset={handleReset}
      />
    </div>
  );
}
