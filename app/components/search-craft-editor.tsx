import { useState, useId, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Repeat,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
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
  getCraftableItems,
  getCraftableItemsByCategory,
  searchItems,
  formatItemName,
  ITEM_CATEGORIES,
  type ItemCategory,
} from "@bafv4/mcitems/1.16/react";
import { ItemIcon } from "@/components/item-icon";
import {
  ActualKeyBadges,
  TIMING_META,
  timingLabel,
} from "@/components/search-craft-template-view";
import {
  LoopEditorRow,
  resetTransitionCountsForCraft,
  type LoopEditorEntry,
  type SearchCraftLoopDraft,
} from "@/components/search-craft-loop-editor";
import { remapVariationRefs } from "@/lib/search-craft-loops";
import { MAX_SEARCH_VARIATIONS, type SearchCraftVariation } from "@/lib/search-craft-variations";
import type { RemapInfo } from "@/lib/remap-utils";
import type { SearchCraftTiming } from "@/lib/search-craft-templates";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

/**
 * サーチクラフト編集UI（/me/search-craft とワークベンチ〈Playground・テンプレートエディタ〉で共通）。
 * 中心となるのは SearchCraftTimingBoard（タイミングブロック型エディタ）。
 * 「指定なし」+ TIMING_META の6種、計7ブロックを常時表示し、各ブロック内でクラフト・
 * 繋ぎ方（Loop）を編集する。timing の変更はブロック間D&D（@dnd-kit）で行うため、
 * 行UI自体（EditableSearchCraftRow・LoopEditorRow）には timing の選択コントロールを持たない。
 * 1エントリは複数のサーチ文字列バリエーション（variations）を持てる。バリエーションごとに
 * withShift を設定できる（エントリ共通ではない）。並べ替えUIはなく、最低1件・上限
 * MAX_SEARCH_VARIATIONS（5）件。
 */

/** 編集UIが必要とする最小のエントリ形状 */
export type SearchCraftDraft = {
  id: string;
  items: string[];
  comment: string | null;
  timing: SearchCraftTiming | null;
  /** 複数サーチ文字列バリエーション（単一の真実。searchStr/withShift スカラーは持たない） */
  variations: SearchCraftVariation[];
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
  const t = useT();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory>("all");

  // mcitemsからクラフト可能なアイテムを取得
  const filteredItems = search
    ? searchItems(search).filter((id) => getCraftableItems().includes(id))
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
                  <ItemIcon itemId={itemId} size={16} />
                  {formatItemName(itemId)}
                  <X className="ml-1 h-3 w-3 text-muted-foreground" />
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
                    <ItemIcon itemId={itemId} size={28} />
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
  getDeleteWarning,
}: {
  craft: T;
  index: number;
  remaps?: RemapInfo[];
  onUpdate: (updated: T) => void;
  onDelete: () => void;
  /** 削除確認ダイアログの説明文を差し替える（Loop 参照時の警告表示等） */
  getDeleteWarning?: (craftId: string) => string | null;
}) {
  const t = useT();
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const rowId = useId();

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

  const updateVariation = (variationIndex: number, patch: Partial<SearchCraftVariation>) => {
    onUpdate({
      ...craft,
      variations: craft.variations.map((v, i) => (i === variationIndex ? { ...v, ...patch } : v)),
    });
  };

  const addVariation = () => {
    if (craft.variations.length >= MAX_SEARCH_VARIATIONS) return;
    onUpdate({ ...craft, variations: [...craft.variations, { str: "", withShift: false }] });
  };

  const removeVariation = (variationIndex: number) => {
    if (craft.variations.length <= 1) return;
    onUpdate({ ...craft, variations: craft.variations.filter((_, i) => i !== variationIndex) });
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
            type="button"
            aria-label={t("meSearchCraft.dragHandle")}
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
                <ItemIcon itemId={itemId} size={20} />
                <span className="text-sm">{formatItemName(itemId)}</span>
                <button
                  type="button"
                  aria-label={t("meSearchCraft.removeItem")}
                  onClick={() => removeItem(itemIndex)}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-opacity"
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

          {/* サーチ文字列バリエーション（1件以上、上限 MAX_SEARCH_VARIATIONS）。並べ替えUIはなし */}
          <div className="space-y-1.5">
            {craft.variations.map((variation, variationIndex) => {
              const checkboxId = `${rowId}-shift-${variationIndex}`;
              return (
                <div key={variationIndex} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground shrink-0">
                      {t("meSearchCraft.searchLabel")}
                    </Label>
                    <Input
                      value={variation.str}
                      onChange={(e) => updateVariation(variationIndex, { str: e.target.value })}
                      placeholder="scr"
                      className="font-mono h-8 w-32"
                    />
                  </div>
                  {/* Shiftを押しながらクラフトするか（バリエーションごと） */}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={checkboxId}
                      checked={variation.withShift}
                      onCheckedChange={(checked) =>
                        updateVariation(variationIndex, { withShift: checked === true })
                      }
                    />
                    <Label
                      htmlFor={checkboxId}
                      className="text-xs text-muted-foreground cursor-pointer"
                    >
                      {t("meSearchCraft.withShift")}
                    </Label>
                  </div>
                  {/* 入力キーのライブプレビュー（リマップ考慮） */}
                  {remaps && variation.str && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground shrink-0">
                        {t("meSearchCraft.keyPreviewLabel")}
                      </Label>
                      <ActualKeyBadges
                        searchStr={variation.str}
                        remaps={remaps}
                        shiftHeld={variation.withShift}
                      />
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
                    disabled={craft.variations.length <= 1}
                    onClick={() => removeVariation(variationIndex)}
                    aria-label={t("meSearchCraft.removeVariation")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              disabled={craft.variations.length >= MAX_SEARCH_VARIATIONS}
              onClick={addVariation}
            >
              <Plus className="h-3 w-3 mr-1" />
              {t("meSearchCraft.addVariation")}
            </Button>
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
                {getDeleteWarning?.(craft.id) ?? t("meSearchCraft.deleteCraftDescription")}
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

// ============================================
// タイミングブロック型エディタ（SearchCraftTimingBoard）
// ============================================

/**
 * 「指定なし」+ TIMING_META の6種、計7ブロックを常時この順で表示する。
 * ブロックの D&D ゾーン id はここでの並び順とは独立（craft.timing / loop.timing で判定する）。
 */
const BLOCK_TIMINGS: (SearchCraftTiming | null)[] = [null, ...TIMING_META.map((m) => m.id)];

const CRAFT_ZONE_PREFIX = "zone:";
const LOOP_ZONE_PREFIX = "loopzone:";

function craftZoneId(timing: SearchCraftTiming | null): string {
  return `${CRAFT_ZONE_PREFIX}${timing ?? "none"}`;
}
function loopZoneId(timing: SearchCraftTiming | null): string {
  return `${LOOP_ZONE_PREFIX}${timing ?? "none"}`;
}
function isCraftZoneId(id: string): boolean {
  return id.startsWith(CRAFT_ZONE_PREFIX);
}
function isLoopZoneId(id: string): boolean {
  return id.startsWith(LOOP_ZONE_PREFIX);
}
function timingFromZoneId(id: string, prefix: string): SearchCraftTiming | null {
  const raw = id.slice(prefix.length);
  return raw === "none" ? null : (raw as SearchCraftTiming);
}

function blockIndex(timing: SearchCraftTiming | null): number {
  const idx = BLOCK_TIMINGS.indexOf(timing);
  return idx === -1 ? BLOCK_TIMINGS.length : idx;
}

/**
 * 「ブロック表示順にグループを連結したフラット配列」へ正規化する（安定ソート、
 * 同一ブロック内の相対順は保持）。D&D・追加・削除・更新など、ユーザー操作の結果を
 * 親へ emit する直前に必ず通す（保存時の sequence がブロック表示順になるようにするため）。
 */
function reorderByBlock<T extends { timing: SearchCraftTiming | null }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = blockIndex(a.item.timing) - blockIndex(b.item.timing);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ item }) => item);
}

type TimingBlockProps<T extends SearchCraftDraft, L extends SearchCraftLoopDraft> = {
  timing: SearchCraftTiming | null;
  crafts: T[];
  loops: L[];
  entries: LoopEditorEntry[];
  remaps?: RemapInfo[];
  getDeleteWarning?: (craftId: string) => string | null;
  totalCraftCount: number;
  isLoopDragging: boolean;
  onUpdateCraft: (id: string, updated: T) => void;
  onDeleteCraft: (id: string) => void;
  onAddCraft: () => void;
  onUpdateLoop: (id: string, updated: L) => void;
  onDeleteLoop: (id: string) => void;
  onAddLoop: () => void;
};

function TimingBlock<T extends SearchCraftDraft, L extends SearchCraftLoopDraft>({
  timing,
  crafts,
  loops,
  entries,
  remaps,
  getDeleteWarning,
  totalCraftCount,
  isLoopDragging,
  onUpdateCraft,
  onDeleteCraft,
  onAddCraft,
  onUpdateLoop,
  onDeleteLoop,
  onAddLoop,
}: TimingBlockProps<T, L>) {
  const t = useT();
  const meta = timing ? TIMING_META.find((m) => m.id === timing) : undefined;
  const label = meta ? timingLabel(t, meta) : t("meSearchCraft.timingNone");

  const { setNodeRef: setCraftZoneRef, isOver: isCraftZoneOver } = useDroppable({
    id: craftZoneId(timing),
  });
  const { setNodeRef: setLoopZoneRef, isOver: isLoopZoneOver } = useDroppable({
    id: loopZoneId(timing),
  });

  const showLoopSection = loops.length > 0 || isLoopDragging;

  return (
    <div className="rounded-xl border border-border/70 bg-background/80">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        {meta && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", meta.dot)} />}
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{crafts.length}</span>
      </div>

      <div className="space-y-3 p-3">
        {/* クラフト一覧（並べ替え・ブロック間移動） */}
        <div ref={setCraftZoneRef}>
          <SortableContext items={crafts.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {crafts.length > 0 ? (
              <div className="divide-y">
                {crafts.map((craft, index) => (
                  <EditableSearchCraftRow
                    key={craft.id}
                    craft={craft}
                    index={index}
                    remaps={remaps}
                    onUpdate={(updated) => onUpdateCraft(craft.id, updated)}
                    onDelete={() => onDeleteCraft(craft.id)}
                    getDeleteWarning={getDeleteWarning}
                  />
                ))}
              </div>
            ) : (
              <div
                className={cn(
                  "rounded-lg border border-dashed border-border/70 py-4 text-center text-xs text-muted-foreground transition-colors",
                  isCraftZoneOver && "border-primary bg-primary/5 text-primary",
                )}
              >
                {t("meSearchCraft.emptyBlockHint")}
              </div>
            )}
          </SortableContext>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={onAddCraft}>
          <Plus className="mr-2 h-4 w-4" />
          {t("meSearchCraft.addCraft")}
        </Button>

        {/* 繋ぎ方（Loop） */}
        {showLoopSection && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Repeat className="h-3.5 w-3.5" />
              {t("meSearchCraft.loopSectionTitle")}
            </div>
            <div ref={setLoopZoneRef}>
              <SortableContext items={loops.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                {loops.length > 0 ? (
                  <div className="divide-y">
                    {loops.map((loop, index) => (
                      <LoopEditorRow
                        key={loop.id}
                        loop={loop}
                        index={index}
                        entries={entries}
                        remaps={remaps}
                        onUpdate={(updated) => onUpdateLoop(loop.id, updated)}
                        onDelete={() => onDeleteLoop(loop.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className={cn(
                      "rounded-lg border border-dashed border-border/70 py-3 text-center text-xs text-muted-foreground transition-colors",
                      isLoopZoneOver && "border-primary bg-primary/5 text-primary",
                    )}
                  >
                    {t("meSearchCraft.loopDropHint")}
                  </div>
                )}
              </SortableContext>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddLoop}
            disabled={totalCraftCount < 2}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("meSearchCraft.addLoop")}
          </Button>
          {totalCraftCount < 2 && (
            <p className="text-xs text-muted-foreground">{t("meSearchCraft.loopNeedTwoEntries")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * サーチクラフト＋繋ぎ方（Loop）のタイミングブロック型エディタ。
 * /me/search-craft・ワークベンチ（Playground・テンプレートエディタ）で共通。
 *
 * - crafts / loops はフラット配列で受け取り、ブロック分けは描画のたびに timing から derive する
 *   （マウント時に配列を再emitしない。初期データはブロック順に並んでいなくても正しく表示される）
 * - ユーザー操作（D&D・追加・削除・更新）の結果のみ、reorderByBlock() で
 *   「ブロック表示順に連結したフラット配列」を onCraftsChange / onLoopsChange に渡す
 * - クラフトと Loop は同一の DndContext を共有する（dnd-kit の useDraggable/useDroppable は
 *   最も近い祖先の DndContext にしか束縛できないため、ブロックカード内でクラフト行と Loop行を
 *   同じ木に混在させたまま「別コンテキスト」に分離することはできない）。互いの干渉は
 *   collisionDetection をドラッグ中の対象と同じドメイン（craft/loop）だけに絞り込むことで防ぐ
 */
export function SearchCraftTimingBoard<T extends SearchCraftDraft, L extends SearchCraftLoopDraft>({
  crafts,
  onCraftsChange,
  loops,
  onLoopsChange,
  remaps,
  getDeleteWarning,
  onAddCraft,
  onAddLoop,
}: {
  crafts: T[];
  onCraftsChange: (next: T[]) => void;
  loops: L[];
  onLoopsChange: (next: L[]) => void;
  /** 指定すると各行に入力キーのライブプレビューを表示する */
  remaps?: RemapInfo[];
  /** 削除確認ダイアログの説明文を差し替える（Loop 参照時の警告表示等） */
  getDeleteWarning?: (craftId: string) => string | null;
  /** 新規クラフトの追加。timing にはクリックしたブロックの値を渡す（オブジェクトの構築は呼び出し側） */
  onAddCraft: (timing: SearchCraftTiming | null) => void;
  /** 新規Loopの追加。timing にはクリックしたブロックの値を渡す */
  onAddLoop: (timing: SearchCraftTiming | null) => void;
}) {
  const dndContextId = useId();
  const [activeDrag, setActiveDrag] = useState<{ type: "craft" | "loop"; id: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const entries: LoopEditorEntry[] = useMemo(
    () => crafts.map((c) => ({ id: c.id, items: c.items, variations: c.variations })),
    [crafts],
  );

  const craftsByBlock = useMemo(() => {
    const map = new Map<SearchCraftTiming | null, T[]>();
    for (const timing of BLOCK_TIMINGS) map.set(timing, []);
    for (const craft of crafts) {
      if (!map.has(craft.timing)) map.set(craft.timing, []);
      map.get(craft.timing)!.push(craft);
    }
    return map;
  }, [crafts]);

  const loopsByBlock = useMemo(() => {
    const map = new Map<SearchCraftTiming | null, L[]>();
    for (const timing of BLOCK_TIMINGS) map.set(timing, []);
    for (const loop of loops) {
      if (!map.has(loop.timing)) map.set(loop.timing, []);
      map.get(loop.timing)!.push(loop);
    }
    return map;
  }, [loops]);

  // ドラッグ中の対象と同じドメイン（craft/loop）の droppable のみを衝突判定の対象にする
  // （crafts と loops を同一 DndContext で扱うための、互いの干渉を防ぐ仕組み）
  const collisionDetectionStrategy: CollisionDetection = useCallback(
    (args) => {
      if (!activeDrag) return closestCenter(args);
      const filtered = args.droppableContainers.filter((container) => {
        const id = String(container.id);
        return activeDrag.type === "loop"
          ? isLoopZoneId(id) || loops.some((l) => l.id === id)
          : isCraftZoneId(id) || crafts.some((c) => c.id === id);
      });
      return closestCenter({ ...args, droppableContainers: filtered });
    },
    [activeDrag, crafts, loops],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      if (loops.some((l) => l.id === id)) {
        setActiveDrag({ type: "loop", id });
      } else if (crafts.some((c) => c.id === id)) {
        setActiveDrag({ type: "craft", id });
      }
    },
    [crafts, loops],
  );

  const handleDragCancel = useCallback(() => setActiveDrag(null), []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!activeDrag) return;
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId) return;

      if (activeDrag.type === "craft") {
        const activeCraft = crafts.find((c) => c.id === activeId);
        if (!activeCraft) return;
        let destTiming: SearchCraftTiming | null;
        let overCraftId: string | null = null;
        if (isCraftZoneId(overId)) {
          destTiming = timingFromZoneId(overId, CRAFT_ZONE_PREFIX);
        } else {
          const overCraft = crafts.find((c) => c.id === overId);
          if (!overCraft) return;
          destTiming = overCraft.timing;
          overCraftId = overCraft.id;
        }
        if (activeCraft.timing === destTiming) return; // 同一ブロック内は onDragEnd の arrayMove に委ねる

        const rest = crafts.filter((c) => c.id !== activeId);
        const moved = { ...activeCraft, timing: destTiming } as T;
        let insertAt: number;
        if (overCraftId) {
          insertAt = rest.findIndex((c) => c.id === overCraftId);
          if (insertAt === -1) insertAt = rest.length;
        } else {
          let lastIdx = -1;
          rest.forEach((c, i) => {
            if (c.timing === destTiming) lastIdx = i;
          });
          insertAt = lastIdx + 1;
        }
        const next = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
        onCraftsChange(reorderByBlock(next));
      } else {
        const activeLoop = loops.find((l) => l.id === activeId);
        if (!activeLoop) return;
        let destTiming: SearchCraftTiming | null;
        let overLoopId: string | null = null;
        if (isLoopZoneId(overId)) {
          destTiming = timingFromZoneId(overId, LOOP_ZONE_PREFIX);
        } else {
          const overLoop = loops.find((l) => l.id === overId);
          if (!overLoop) return;
          destTiming = overLoop.timing;
          overLoopId = overLoop.id;
        }
        if (activeLoop.timing === destTiming) return;

        const rest = loops.filter((l) => l.id !== activeId);
        const moved = { ...activeLoop, timing: destTiming } as L;
        let insertAt: number;
        if (overLoopId) {
          insertAt = rest.findIndex((l) => l.id === overLoopId);
          if (insertAt === -1) insertAt = rest.length;
        } else {
          let lastIdx = -1;
          rest.forEach((l, i) => {
            if (l.timing === destTiming) lastIdx = i;
          });
          insertAt = lastIdx + 1;
        }
        const next = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
        onLoopsChange(reorderByBlock(next));
      }
    },
    [activeDrag, crafts, loops, onCraftsChange, onLoopsChange],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const drag = activeDrag;
      setActiveDrag(null);
      if (!drag) return;
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId) return;

      if (drag.type === "craft") {
        if (isCraftZoneId(overId)) return; // ブロック間移動は onDragOver で処理済み
        const oldIndex = crafts.findIndex((c) => c.id === activeId);
        const newIndex = crafts.findIndex((c) => c.id === overId);
        if (oldIndex === -1 || newIndex === -1) return;
        onCraftsChange(reorderByBlock(arrayMove(crafts, oldIndex, newIndex)));
      } else {
        if (isLoopZoneId(overId)) return;
        const oldIndex = loops.findIndex((l) => l.id === activeId);
        const newIndex = loops.findIndex((l) => l.id === overId);
        if (oldIndex === -1 || newIndex === -1) return;
        onLoopsChange(reorderByBlock(arrayMove(loops, oldIndex, newIndex)));
      }
    },
    [activeDrag, crafts, loops, onCraftsChange, onLoopsChange],
  );

  // クラフト行の更新。
  // - バリエーションの str/withShift を編集した、またはバリエーションが増えた場合:
  //   そのエントリに隣接する Loop 遷移の BS/← 回数を新しい最小値へ再初期化する
  //   （エントリ選択変更時のリセットと同じ「最小回数を初期表示」の規則をバリエーション編集にも適用する）
  // - バリエーションが減った（削除された）場合: remapVariationRefs で参照 index を付け替えてから
  //   同様に遷移回数を再初期化する（削除された index への参照は 0 へ倒る安全網は
  //   remapVariationRefs 自身が担う）
  const handleUpdateCraft = useCallback(
    (id: string, updated: T) => {
      const prevCraft = crafts.find((c) => c.id === id);
      const nextCrafts = reorderByBlock(crafts.map((c) => (c.id === id ? updated : c)));
      onCraftsChange(nextCrafts);
      if (!prevCraft || prevCraft.variations === updated.variations) return;

      const nextEntries: LoopEditorEntry[] = nextCrafts.map((c) => ({
        id: c.id,
        items: c.items,
        variations: c.variations,
      }));

      const variationRemoved = updated.variations.length < prevCraft.variations.length;
      let removedIndex = -1;
      if (variationRemoved) {
        removedIndex = prevCraft.variations.length - 1;
        for (let i = 0; i < prevCraft.variations.length; i++) {
          if (updated.variations[i] !== prevCraft.variations[i]) {
            removedIndex = i;
            break;
          }
        }
      }

      let changed = false;
      const nextLoops = loops.map((loop) => {
        // このクラフトを参照しない Loop は触らない（remapVariationRefs は .map で常に新しい配列
        // を返すため、無関係な Loop まで先に呼ぶと参照が不必要に変わり hasChanges が誤検知する）
        if (!loop.steps.some((s) => s.craftId === id)) return loop;
        let steps = loop.steps;
        if (variationRemoved) {
          steps = remapVariationRefs(steps, id, removedIndex, updated.variations.length);
        }
        steps = resetTransitionCountsForCraft(steps, id, nextEntries);
        changed = true;
        return { ...loop, steps };
      });
      if (changed) onLoopsChange(nextLoops);
    },
    [crafts, loops, onCraftsChange, onLoopsChange],
  );

  const isLoopDragging = activeDrag?.type === "loop";
  const totalCraftCount = crafts.length;

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-4">
        {BLOCK_TIMINGS.map((timing) => (
          <TimingBlock
            key={timing ?? "__none"}
            timing={timing}
            crafts={craftsByBlock.get(timing) ?? []}
            loops={loopsByBlock.get(timing) ?? []}
            entries={entries}
            remaps={remaps}
            getDeleteWarning={getDeleteWarning}
            totalCraftCount={totalCraftCount}
            isLoopDragging={isLoopDragging}
            onUpdateCraft={handleUpdateCraft}
            onDeleteCraft={(id) => onCraftsChange(reorderByBlock(crafts.filter((c) => c.id !== id)))}
            onAddCraft={() => onAddCraft(timing)}
            onUpdateLoop={(id, updated) =>
              onLoopsChange(reorderByBlock(loops.map((l) => (l.id === id ? updated : l))))
            }
            onDeleteLoop={(id) => onLoopsChange(reorderByBlock(loops.filter((l) => l.id !== id)))}
            onAddLoop={() => onAddLoop(timing)}
          />
        ))}
      </div>
    </DndContext>
  );
}

/**
 * 新規追加直後などブロード外で作った配列をブロック表示順に正規化するための公開ヘルパー
 * （SearchCraftTimingBoard 自体は D&D・更新・削除のたびに内部で自動的にこれを適用する）。
 */
export { reorderByBlock };
