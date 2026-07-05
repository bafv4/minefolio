import { useState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
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
import {
  Plus,
  Trash2,
  X,
  GripVertical,
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
import { ActualKeyBadges } from "@/components/search-craft-template-view";
import type { RemapInfo } from "@/lib/remap-utils";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";

// mcitemsのテクスチャベースURL
const TEXTURE_BASE_URL = "/mcitems";

/**
 * サーチクラフト編集UI（/me/search-craft とテンプレートエディタで共通）。
 * ドラッグ&ドロップの並べ替え・アイテム選択ダイアログ・タイミング選択を含む。
 */

/** 編集UIが必要とする最小のエントリ形状 */
export type SearchCraftDraft = {
  id: string;
  items: string[];
  searchStr: string | null;
  comment: string | null;
  timing: "bastion" | "fortress" | "other" | null;
};

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
          <DialogTitle>{t("meSearchCraft.selectItems")}</DialogTitle>
          <DialogDescription>
            {t("meSearchCraft.selectItemsDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder={t("meSearchCraft.searchItems")}
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
          <div className="grid grid-cols-5 sm:grid-cols-8 gap-1 max-h-64 overflow-y-auto p-1">
            {filteredItems.slice(0, 200).map((itemId) => (
              <Tooltip key={itemId}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => toggleItem(itemId)}
                    className={`w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center rounded border-2 transition-colors touch-manipulation ${
                      isItemSelected(itemId)
                        ? "border-primary bg-primary/20"
                        : "border-transparent hover:border-border hover:bg-secondary/50"
                    }`}
                  >
                    <MinecraftItemIcon
                      itemId={itemId}
                      size={28}
                      textureBaseUrl={TEXTURE_BASE_URL}
                      className="pixelated"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{formatItemName(itemId)}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <DialogFooter>
            <Button variant="outline" onClick={() => onItemsChange([])}>
            {t("meSearchCraft.clear")}
          </Button>
          <DialogClose asChild>
            <Button>{t("meSearchCraft.complete")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// インライン編集可能なサーチクラフト行（ソータブル対応）
function EditableSearchCraftRow<T extends SearchCraftDraft>({
  craft,
  index,
  remaps,
  onUpdate,
  onDelete,
}: {
  craft: T;
  index: number;
  remaps?: RemapInfo[];
  onUpdate: (updated: T) => void;
  onDelete: () => void;
}) {
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

  const removeItem = (itemIndex: number) => {
    onUpdate({ ...craft, items: craft.items.filter((_, i) => i !== itemIndex) });
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "py-3 flex items-start gap-2",
          isDragging && "opacity-50 bg-secondary/30 rounded-lg shadow-lg",
        )}
      >
        {/* Drag handle + 順番 */}
        <div className="flex items-center gap-1 pt-1.5 shrink-0">
          <button
            {...attributes}
            {...listeners}
            className="flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
          >
            <GripVertical className="h-5 w-5" />
          </button>
          <span className="w-5 text-xs font-mono text-muted-foreground/60 text-right">
            {index + 1}
          </span>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* アイテム */}
          <div className="flex flex-wrap items-center gap-1.5">
            {craft.items.map((itemId, itemIndex) => (
              <div
                key={itemIndex}
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
                  onClick={() => removeItem(itemIndex)}
                  className="text-muted-foreground hover:text-destructive opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
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
              {t("meSearchCraft.add")}
            </Button>
          </div>

          {/* サーチ文字列・タイミング・入力キープレビュー */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">
                {t("meSearchCraft.searchLabel")}
              </Label>
              <Input
                value={craft.searchStr || ""}
                onChange={(e) => onUpdate({ ...craft, searchStr: e.target.value || null })}
                placeholder="scr"
                className="font-mono h-8 w-32"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">
                {t("meSearchCraft.timing")}
              </Label>
              <Select
                value={craft.timing ?? "__none"}
                onValueChange={(value) =>
                  onUpdate({
                    ...craft,
                    timing: value === "__none" ? null : (value as SearchCraftDraft["timing"]),
                  })
                }
              >
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t("meSearchCraft.timingNone")}</SelectItem>
                  <SelectItem value="bastion">Bastion</SelectItem>
                  <SelectItem value="fortress">Fortress</SelectItem>
                  <SelectItem value="other">{t("meSearchCraft.timingOther")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* 入力キーのライブプレビュー（リマップ考慮） */}
            {remaps && craft.searchStr && (
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground shrink-0">
                  {t("meSearchCraft.keyPreviewLabel")}
                </Label>
                <ActualKeyBadges searchStr={craft.searchStr} remaps={remaps} />
              </div>
            )}
          </div>

          {/* コメント（常時表示） */}
          <Input
            value={craft.comment || ""}
            onChange={(e) => onUpdate({ ...craft, comment: e.target.value || null })}
            placeholder={t("meSearchCraft.commentOptional")}
            className="h-8 text-sm"
          />
        </div>

        {/* Delete button */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="shrink-0">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("meSearchCraft.deleteCraftTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("meSearchCraft.deleteCraftDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("meSearchCraft.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>{t("meSearchCraft.delete")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <ItemSelectDialog
        isOpen={isItemDialogOpen}
        onClose={() => setIsItemDialogOpen(false)}
        selectedItems={craft.items}
        onItemsChange={(items) => onUpdate({ ...craft, items })}
      />
    </>
  );
}

/** ドラッグ&ドロップ並べ替え対応のサーチクラフト編集リスト（行形式） */
export function SearchCraftListEditor<T extends SearchCraftDraft>({
  crafts,
  remaps,
  onUpdate,
  onDelete,
  onReorder,
}: {
  crafts: T[];
  /** 指定すると各行に入力キーのライブプレビューを表示する */
  remaps?: RemapInfo[];
  onUpdate: (index: number, updated: T) => void;
  onDelete: (index: number) => void;
  onReorder: (oldIndex: number, newIndex: number) => void;
}) {
  const dndContextId = useId();

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = crafts.findIndex((c) => c.id === active.id);
      const newIndex = crafts.findIndex((c) => c.id === over.id);
      onReorder(oldIndex, newIndex);
    }
  };

  return (
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
        <div className="divide-y">
          {crafts.map((craft, index) => (
            <EditableSearchCraftRow
              key={craft.id}
              craft={craft}
              index={index}
              remaps={remaps}
              onUpdate={(updated) => onUpdate(index, updated)}
              onDelete={() => onDelete(index)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export { arrayMove };
