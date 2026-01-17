import { useState, useEffect, useRef, useId, useMemo, useCallback } from "react";
import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/search-craft";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { users, searchCrafts } from "@/lib/schema";
import { eq, asc, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { toast } from "sonner";
import {
  Search,
  Plus,
  Trash2,
  X,
  GripVertical,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  MinecraftItemIcon,
  getCraftableItems,
  getCraftableItemsByCategory,
  searchItems,
  formatItemName,
  ITEM_CATEGORIES,
  type ItemCategory,
} from "@bafv4/mcitems/1.16/react";
import { FloatingSaveBar } from "@/components/floating-save-bar";

export const meta: Route.MetaFunction = () => {
  return [{ title: "サーチクラフト - Minefolio" }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
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
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      searchCrafts: {
        orderBy: [asc(searchCrafts.sequence)],
      },
    },
  });

  if (!user) {
    throw new Response("ユーザーが見つかりません", { status: 404 });
  }

  // Parse JSON fields
  const crafts: SearchCraftItem[] = user.searchCrafts.map((craft) => ({
    id: craft.id,
    sequence: craft.sequence,
    items: JSON.parse(craft.items) as string[],
    keys: JSON.parse(craft.keys) as string[],
    searchStr: craft.searchStr,
    comment: craft.comment,
  }));

  return { userId: user.id, crafts };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-36 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-20" />
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
    const craftsJson = formData.get("crafts") as string;

    try {
      const crafts = JSON.parse(craftsJson) as SearchCraftItem[];

      // 既存のサーチクラフトを全削除
      await db.delete(searchCrafts).where(eq(searchCrafts.userId, user.id));

      // 新しいサーチクラフトを挿入
      const now = new Date();
      for (let i = 0; i < crafts.length; i++) {
        const craft = crafts[i];
        await db.insert(searchCrafts).values({
          id: craft.id.startsWith("new-") ? createId() : craft.id,
          userId: user.id,
          sequence: i + 1,
          items: JSON.stringify(craft.items),
          keys: JSON.stringify([]), // keysは使用しない（後方互換性のため空配列で保持）
          searchStr: craft.searchStr || null,
          comment: craft.comment || null,
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

// アイテム選択ダイアログ
function ItemSelectDialog({
  isOpen,
  onClose,
  selectedItems,
  onItemsChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedItems: string[];
  onItemsChange: (items: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory>("all");

  // mcitemsからクラフト可能なアイテムを取得
  const filteredItems = search
    ? searchItems(search).filter(id => getCraftableItems().includes(id))
    : getCraftableItemsByCategory(selectedCategory);

  const toggleItem = (itemId: string) => {
    const normalizedId = itemId.startsWith("minecraft:") ? itemId : `minecraft:${itemId}`;
    if (selectedItems.includes(normalizedId)) {
      onItemsChange(selectedItems.filter((i) => i !== normalizedId));
    } else {
      onItemsChange([...selectedItems, normalizedId]);
    }
  };

  const isItemSelected = (itemId: string) => {
    const normalizedId = itemId.startsWith("minecraft:") ? itemId : `minecraft:${itemId}`;
    return selectedItems.includes(normalizedId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>アイテムを選択</DialogTitle>
          <DialogDescription>
            クラフト文字列で検索するアイテムを選択してください（複数選択可）
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
          {selectedItems.length > 0 && (
            <div className="flex flex-wrap gap-1 p-2 bg-secondary/30 rounded-lg">
              {selectedItems.map((itemId) => (
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
                className={`w-9 h-9 flex items-center justify-center rounded border-2 transition-colors ${
                  isItemSelected(itemId)
                    ? "border-primary bg-primary/20"
                    : "border-transparent hover:border-border hover:bg-secondary/50"
                }`}
                title={formatItemName(itemId)}
              >
                <MinecraftItemIcon
                  itemId={itemId}
                  size={28}
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

// インライン編集可能なサーチクラフトカード（ソータブル対応）
function EditableSearchCraftCard({
  craft,
  onUpdate,
  onDelete,
}: {
  craft: SearchCraftItem;
  onUpdate: (updated: SearchCraftItem) => void;
  onDelete: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(!craft.searchStr); // 新規作成時は展開
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: craft.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleSearchStrChange = (value: string) => {
    onUpdate({ ...craft, searchStr: value.toLowerCase() || null });
  };

  const handleCommentChange = (value: string) => {
    onUpdate({ ...craft, comment: value || null });
  };

  const handleItemsChange = (items: string[]) => {
    onUpdate({ ...craft, items });
  };

  const removeItem = (index: number) => {
    onUpdate({ ...craft, items: craft.items.filter((_, i) => i !== index) });
  };

  return (
    <>
      <Card
        ref={setNodeRef}
        style={style}
        className={isDragging ? "opacity-50 shadow-lg" : ""}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* Drag handle */}
            <button
              {...attributes}
              {...listeners}
              className="flex items-center justify-center py-2 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
            >
              <GripVertical className="h-5 w-5" />
            </button>

            {/* Main content */}
            <div className="flex-1 min-w-0 space-y-3">
              {/* アイテム表示 */}
              <div className="flex flex-wrap items-center gap-1.5">
                {craft.items.map((itemId, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-1.5 bg-secondary/50 rounded px-2 py-1 group"
                  >
                    <MinecraftItemIcon
                      itemId={itemId}
                      size={20}
                      textureBaseUrl={TEXTURE_BASE_URL}
                      className="pixelated"
                    />
                    <span className="text-sm">{formatItemName(itemId)}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => setIsItemDialogOpen(true)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  追加
                </Button>
              </div>

              {/* クラフト文字列 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground shrink-0">検索:</Label>
                <Input
                  value={craft.searchStr || ""}
                  onChange={(e) => handleSearchStrChange(e.target.value)}
                  placeholder="scr"
                  className="font-mono h-8 w-32"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* 展開時：コメント */}
              {isExpanded && (
                <div className="space-y-2">
                  <Label htmlFor={`comment-${craft.id}`} className="text-xs text-muted-foreground">
                    コメント（任意）
                  </Label>
                  <Textarea
                    id={`comment-${craft.id}`}
                    value={craft.comment || ""}
                    onChange={(e) => handleCommentChange(e.target.value)}
                    placeholder="このシーケンスについてのメモ..."
                    rows={2}
                  />
                </div>
              )}

              {/* 折りたたみ時：コメントがあれば表示 */}
              {!isExpanded && craft.comment && (
                <p className="text-xs text-muted-foreground truncate">
                  {craft.comment}
                </p>
              )}
            </div>

            {/* Delete button */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>シーケンスを削除しますか？</AlertDialogTitle>
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
        </CardContent>
      </Card>

      <ItemSelectDialog
        isOpen={isItemDialogOpen}
        onClose={() => setIsItemDialogOpen(false)}
        selectedItems={craft.items}
        onItemsChange={handleItemsChange}
      />
    </>
  );
}

export default function SearchCraftPage() {
  const { crafts: initialCrafts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [crafts, setCrafts] = useState<SearchCraftItem[]>(initialCrafts);
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const dndContextId = useId();

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
      toast.success("サーチクラフトを保存しました");
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  // ドラッグ&ドロップ用のセンサー設定
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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
    };
    setCrafts((prev) => [...prev, newCraft]);
  }, [crafts.length]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setCrafts((prev) => {
        const oldIndex = prev.findIndex((c) => c.id === active.id);
        const newIndex = prev.findIndex((c) => c.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, []);

  const handleSave = useCallback(() => {
    // バリデーション
    const emptyCrafts = crafts.filter((c) => c.items.length === 0);
    if (emptyCrafts.length > 0) {
      toast.error("アイテムを1つ以上選択してください");
      return;
    }

    const emptySearchStr = crafts.filter((c) => !c.searchStr);
    if (emptySearchStr.length > 0) {
      toast.error("クラフト文字列を入力してください");
      return;
    }

    fetcher.submit(
      { _action: "saveAll", crafts: JSON.stringify(crafts) },
      { method: "post" }
    );
  }, [crafts, fetcher]);

  const handleReset = useCallback(() => {
    setCrafts(initialCrafts);
  }, [initialCrafts]);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">サーチクラフト</h1>
          <p className="text-muted-foreground">
            スピードラン用のクラフト検索シーケンスを設定します。
          </p>
        </div>
        <Button onClick={handleAddCraft}>
          <Plus className="mr-2 h-4 w-4" />
          追加
        </Button>
      </div>

      {/* 説明カード */}
      <Card className="bg-secondary/30 border-dashed">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            サーチクラフトとは、クラフトメニューの検索バーで特定のキーを入力することで
            素早くアイテムを見つけるテクニックです。例えば「<code className="bg-background px-1 rounded">scr</code>」と入力すると
            <strong>S</strong>tick → <strong>C</strong>rafting table → Stone Pickaxe（<strong>R</strong>ock）の順にクラフトできます。
          </p>
        </CardContent>
      </Card>

      {crafts.length > 0 ? (
        <DndContext
          id={dndContextId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={crafts.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {crafts.map((craft, index) => (
                <EditableSearchCraftCard
                  key={craft.id}
                  craft={craft}
                  onUpdate={(updated) => handleUpdateCraft(index, updated)}
                  onDelete={() => handleDeleteCraft(index)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium">サーチクラフトが設定されていません</p>
            <p className="text-sm text-muted-foreground mb-4">
              クラフト検索シーケンスを追加して、スピードランを効率化しましょう。
            </p>
            <Button onClick={handleAddCraft}>
              <Plus className="mr-2 h-4 w-4" />
              シーケンスを追加
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
