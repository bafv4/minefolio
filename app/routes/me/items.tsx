import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useState, useEffect, useId, useRef, useMemo, useCallback, memo, type ReactNode } from "react";
import { useLoaderData, useFetcher, Link, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/items";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, itemLayouts, configPresets } from "@/lib/schema";
import { eq, asc, and } from "drizzle-orm";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createId } from "@paralleldrive/cuid2";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import {
  Package,
  Plus,
  Trash2,
  Edit,
  AlertCircle,
  Copy,
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
  searchItems,
  getCategoryName,
  ITEM_CATEGORIES,
  getItemsByCategory,
  type ItemCategory,
} from "@bafv4/mcitems/1.16/react";
import { ItemIcon, getLocalizedItemName } from "@/components/item-icon";
import { ItemHotbar, type Slot } from "@/components/item-hotbar";
import { EmptyState } from "@/components/empty-state";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { Combobox } from "@/components/ui/combobox";
import { useT, useLocale } from "@/hooks/use-locale";
import { syncActivePresetSnapshot, assertPresetIsActive, PresetMismatchError, type PresetItemLayoutData } from "@/lib/preset-utils";
import { configHistory } from "@/lib/schema";
import { PresetSelector } from "@/components/preset-selector";
import { PresetSwitchLock } from "@/components/preset-switch-lock";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meItems.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate, formAction, currentUrl, nextUrl }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  // /me/presets でのアクション（プリセット切替・作成・削除）の後は再検証する
  if (formAction === "/me/presets") {
    return true;
  }
  // PresetSelector の focus 再検証（別タブでのプリセット切替検知）を通すため、
  // revalidator 起点（アクション無し・URL 不変）の再検証は既定の判断に任せる
  if (!formAction && currentUrl.href === nextUrl.href) {
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

type ItemLayout = {
  id: string;
  segment: string;
  slots: Slot[];
  offhand: string[];
  notes: string | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      itemLayouts: {
        orderBy: [asc(itemLayouts.displayOrder)],
      },
      configPresets: {
        columns: {
          id: true,
          name: true,
          isActive: true,
          isMain: true,
          itemLayoutsData: true,
        },
      },
    },
  });

  if (!user) {
    throw new Response(t("meItems.userNotFound"), { status: 404 });
  }

  // Parse JSON fields
  const layouts: ItemLayout[] = user.itemLayouts.map((layout) => ({
    id: layout.id,
    segment: layout.segment,
    slots: JSON.parse(layout.slots) as Slot[],
    offhand: layout.offhand ? JSON.parse(layout.offhand) : [],
    notes: layout.notes,
  }));

  // 全プリセットを取得（コピー機能用）
  const allPresets = user.configPresets;

  // アクティブなプリセットを取得
  const activePreset = allPresets.find((p) => p.isActive);

  return {
    userId: user.id,
    layouts,
    activePreset: activePreset ? { id: activePreset.id, name: activePreset.name } : null,
    hasPresets: allPresets.length > 0,
    presets: allPresets.map((p) => ({
      id: p.id,
      name: p.name,
      isActive: p.isActive,
      isMain: p.isMain,
      hasItemLayouts: !!p.itemLayoutsData,
      itemLayoutsData: p.itemLayoutsData,
    })),
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  const t = useT();
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <div className="rounded-xl border border-border/70 bg-background/80">
        <div className="divide-y divide-border/60">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 shrink-0" />
                <Skeleton className="h-8 flex-1" />
                <div className="flex gap-1 shrink-0">
                  <Skeleton className="h-8 w-8" />
                  <Skeleton className="h-8 w-8" />
                  <Skeleton className="h-8 w-8" />
                </div>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto mt-3">
                <Skeleton className="w-10 h-10 sm:w-12 sm:h-12 shrink-0" />
                <div className="w-px h-10 bg-border shrink-0" />
                {Array.from({ length: 9 }).map((_, j) => (
                  <Skeleton key={j} className="w-10 h-10 sm:w-12 sm:h-12 shrink-0" />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border/60 px-4 py-3">
          <Skeleton className="h-8 w-32" />
        </div>
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
    return { error: t("meItems.userNotFound") };
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

  // アイテム配置はプリセットのスナップショットに含まれるデータのため、
  // アクティブなプリセットが無い状態では保存できない（UIのグレーアウトだけでなくサーバー側でも拒否）。
  // プリセットが無いまま書き込むと syncActivePresetSnapshot が無言でスキップされ、
  // どのプリセットにも属さないデータになってしまう。
  const activePresetRow = await db.query.configPresets.findFirst({
    where: and(eq(configPresets.userId, user.id), eq(configPresets.isActive, true)),
    columns: { id: true },
  });
  if (!activePresetRow) {
    return { error: t("meItems.presetRequired") };
  }

  if (actionType === "saveAll") {
    const layoutsJson = formData.get("layouts") as string;

    try {
      const layouts = JSON.parse(layoutsJson) as ItemLayout[];

      const now = new Date();
      await db.transaction(async (tx) => {
        // 既存のレイアウトを全削除
        await tx.delete(itemLayouts).where(eq(itemLayouts.userId, user.id));

        // 新しいレイアウトを挿入
        for (let i = 0; i < layouts.length; i++) {
          const layout = layouts[i];
          await tx.insert(itemLayouts).values({
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
      });

      // アクティブプリセットスナップショット同期
      await syncActivePresetSnapshot(db, user.id, ["itemLayouts"]);

      // 変更履歴を記録
      await db.insert(configHistory).values({
        id: createId(),
        userId: user.id,
        changeType: "game_setting",
        changeDescription: t("meItems.itemLayoutChangeHistory"),
        createdAt: now,
      });

      return { success: true };
    } catch (error) {
      console.error("Save error:", error);
      return { error: t("meItems.saveFailed") };
    }
  }

  return { error: t("meItems.unknownAction") };
}

// アイテム選択ダイアログ付きのホットバースロット trigger（ItemHotbar の renderSlotWrapper として使用）
function ItemSlotEditButton({
  slotKey,
  items,
  tile,
  onItemsChange,
}: {
  slotKey: number | "offhand";
  items: string[];
  tile: ReactNode;
  onItemsChange: (items: string[]) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory>("all");
  // mcitems の lang 引数（"en_us" / "ja_jp"）。getLocalizedItemName と同じ判定基準
  const langCode = locale === "en" ? "en_us" : "ja_jp";

  // mcitemsから検索（表示ロケールに追従）
  const filteredItems = search
    ? searchItems(search, langCode)
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
          aria-label={t("meItems.slotItems", {
            name: slotKey === "offhand" ? t("meItems.offhand") : t("meItems.slot", { slot: slotKey }),
          })}
          className="group rounded touch-manipulation"
        >
          {tile}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("meItems.slotItems", {
              name: slotKey === "offhand" ? t("meItems.offhand") : t("meItems.slot", { slot: slotKey }),
            })}
          </DialogTitle>
          <DialogDescription>
            {t("meItems.chooseItems")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder={t("meItems.searchItems")}
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
                    {getCategoryName(cat.id, langCode) ?? cat.name}
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
                  <ItemIcon itemId={itemId} size={16} />
                  {getLocalizedItemName(itemId, locale)}
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
                    className={`w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded border-2 transition-colors ${
                      isItemSelected(itemId)
                        ? "border-primary bg-primary/20"
                        : "border-transparent hover:border-border hover:bg-secondary/50"
                    }`}
                  >
                    <ItemIcon itemId={itemId} size={28} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{getLocalizedItemName(itemId, locale)}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <DialogFooter>
            <Button variant="outline" onClick={() => onItemsChange([])}>
            {t("meItems.clear")}
          </Button>
          <DialogClose asChild>
            <Button>{t("meItems.complete")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const t = useT();
  // 未使用のプリセットのみ表示（existingSegments には自分自身の値も含まれうるが、
  // `preset === value` で常に残すため除外は不要）
  const availablePresets = SEGMENT_PRESETS.filter(
    (preset) => preset === value || !existingSegments.includes(preset)
  );

  const options = availablePresets.map((preset) => ({
    value: preset,
    label: preset,
  }));

  return (
    <Combobox
      options={options}
      value={value}
      onValueChange={onChange}
      placeholder={t("meItems.segmentPlaceholder")}
      searchPlaceholder={t("meItems.segmentSearch")}
      emptyText={t("meItems.noPresetItems")}
      allowCustomValue={true}
    />
  );
}

/**
 * 行ヘッダーの中身（セグメント名 Combobox + 操作ボタン群）。
 *
 * ドラッグ中、dnd-kit は over（ホバー中のドロップ先）が変わるたびに useSortable を呼ぶ
 * 全行を再レンダーする。重い中身をそこに直接置くと行数分の Combobox / ItemIcon /
 * ダイアログが巻き込まれてカクつくため、useSortable を持つシェル（EditableLayoutRow）から
 * 分離して memo 化する。props は id ベースのパッチ更新（onUpdate(id, patch)）にして
 * 親のコールバックをそのまま渡せる形にしてあり、行の値が変わらない限り再レンダーされない。
 */
const LayoutRowHeader = memo(function LayoutRowHeader({
  layoutId,
  segment,
  existingSegments,
  onToggleExpanded,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  layoutId: string;
  segment: string;
  existingSegments: string[];
  onToggleExpanded: () => void;
  onUpdate: (id: string, patch: Partial<ItemLayout>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const t = useT();

  return (
    <>
      <div className="min-w-0 flex-1">
        <SegmentNameInput
          value={segment}
          onChange={(next) => onUpdate(layoutId, { segment: next })}
          existingSegments={existingSegments}
        />
      </div>
      <div className="flex shrink-0 gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDuplicate(layoutId)}
              aria-label={t("meItems.duplicate")}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("meItems.duplicate")}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="sm" onClick={onToggleExpanded}>
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
              <AlertDialogTitle>{t("meItems.deleteLayoutTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("meItems.deleteLayoutDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("meItems.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(layoutId)}>
                {t("meItems.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
});

/**
 * 行のホットバー + メモ（memo 化）。LayoutRowHeader と同じ理由で分離してある。
 * セグメント名の編集でホットバー（ItemIcon × 10スロット）まで再レンダーしないよう、
 * layout オブジェクトではなく必要なフィールドだけを受け取る。
 */
const LayoutRowBody = memo(function LayoutRowBody({
  layoutId,
  slots,
  offhand,
  notes,
  isExpanded,
  onUpdate,
}: {
  layoutId: string;
  slots: Slot[];
  offhand: string[];
  notes: string | null;
  isExpanded: boolean;
  onUpdate: (id: string, patch: Partial<ItemLayout>) => void;
}) {
  const t = useT();

  const updateSlot = (slotNum: number, items: string[]) => {
    const newSlots = slots.map((s) => (s.slot === slotNum ? { ...s, items } : s));
    // スロットが存在しない場合は追加
    if (!slots.find((s) => s.slot === slotNum)) {
      newSlots.push({ slot: slotNum, items });
    }
    onUpdate(layoutId, { slots: newSlots });
  };

  return (
    <div className="mt-3">
      {/* ホットバー編集 */}
      <ItemHotbar
        slots={slots}
        offhand={offhand}
        offhandLabel={t("meItems.off")}
        renderSlotWrapper={({ slotKey, items, tile }) => (
          <ItemSlotEditButton
            slotKey={slotKey}
            items={items}
            tile={tile}
            onItemsChange={(newItems) => {
              if (slotKey === "offhand") onUpdate(layoutId, { offhand: newItems });
              else updateSlot(slotKey, newItems);
            }}
          />
        )}
      />

      {/* 展開時にメモ表示 */}
      {isExpanded && (
        <div className="mt-4 space-y-2">
          <Label htmlFor={`notes-${layoutId}`}>{t("meItems.notesOptional")}</Label>
          <Textarea
            id={`notes-${layoutId}`}
            value={notes || ""}
            onChange={(e) => onUpdate(layoutId, { notes: e.target.value || null })}
            placeholder={t("meItems.notesPlaceholder")}
            rows={2}
          />
        </div>
      )}

      {/* メモがある場合は折りたたみ時も表示 */}
      {!isExpanded && notes && <p className="text-xs text-muted-foreground mt-2">{notes}</p>}
    </div>
  );
});

/**
 * インライン編集可能なレイアウト行（単一カード内の divide-y リスト行。操作行→ホットバー→メモ）。
 * useSortable・並べ替えハンドル・isDragging の見た目だけを持つ薄いシェルで、
 * 重い中身は memo 化した LayoutRowHeader / LayoutRowBody に委ねる。
 */
function EditableLayoutRow({
  layout,
  onUpdate,
  onDelete,
  onDuplicate,
  existingSegments,
}: {
  layout: ItemLayout;
  onUpdate: (id: string, patch: Partial<ItemLayout>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  existingSegments: string[];
}) {
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setIsExpanded((prev) => !prev), []);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layout.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("px-4 py-3", isDragging && "opacity-50")}
    >
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          type="button"
          aria-label={t("meItems.dragHandle")}
          className="flex shrink-0 items-center justify-center text-muted-foreground touch-none cursor-grab hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <LayoutRowHeader
          layoutId={layout.id}
          segment={layout.segment}
          existingSegments={existingSegments}
          onToggleExpanded={toggleExpanded}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      </div>

      <LayoutRowBody
        layoutId={layout.id}
        slots={layout.slots}
        offhand={layout.offhand}
        notes={layout.notes}
        isExpanded={isExpanded}
        onUpdate={onUpdate}
      />
    </div>
  );
}

/**
 * プリセット未作成時に、アイテム配置が編集できない旨を案内する。
 * 既存データは読み取り専用で表示される。
 */
function PresetRequiredNotice() {
  const t = useT();
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center gap-1">
        <span>{t("meItems.presetRequiredNotice")}</span>
        <Link to="/me/presets" className="underline underline-offset-2">
          {t("meItems.presetRequiredLink")}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

export default function ItemLayoutsPage() {
  const t = useT();
  const { layouts: initialLayouts, activePreset, hasPresets, presets } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [layouts, setLayouts] = useState<ItemLayout[]>(initialLayouts);
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  // プリセット切替（apply-preset）中は入力欄をロックする
  const [presetSwitching, setPresetSwitching] = useState(false);

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
      toast.success(t("meItems.saveSuccess"));
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  // 変更検知
  const hasChanges = useMemo(() => {
    if (layouts.length !== initialLayouts.length) return true;
    return JSON.stringify(layouts) !== JSON.stringify(initialLayouts);
  }, [layouts, initialLayouts]);

  // 行コンポーネントの memo を効かせるため、index クロージャではなく id ベースの
  // 安定コールバック（依存なし）にして、そのまま行へ渡す
  const handleUpdateLayout = useCallback((id: string, patch: Partial<ItemLayout>) => {
    setLayouts((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const handleDeleteLayout = useCallback((id: string) => {
    setLayouts((prev) => prev.filter((l) => l.id !== id));
  }, []);

  // セグメント名を空にして直後に複製を挿入する（保存時の必須・重複バリデーションが命名を強制する）
  const handleDuplicateLayout = useCallback((id: string) => {
    setLayouts((prev) => {
      const index = prev.findIndex((l) => l.id === id);
      if (index === -1) return prev;
      const cloned: ItemLayout = {
        ...structuredClone(prev[index]),
        // "new-" プレフィックスは action の新規判定に使う。連続クリックでも衝突しないよう cuid2 を使う
        id: `new-${createId()}`,
        segment: "",
      };
      const next = [...prev];
      next.splice(index + 1, 0, cloned);
      return next;
    });
  }, []);

  const handleAddLayout = useCallback(() => {
    const newLayout: ItemLayout = {
      id: `new-${createId()}`,
      segment: "",
      slots: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ slot: n, items: [] })),
      offhand: [],
      notes: null,
    };
    setLayouts((prev) => [...prev, newLayout]);
  }, []);

  // DndContext の id は明示する。未指定だと dnd-kit が自動採番するため、
  // aria-describedby が SSR とクライアントでずれて hydration mismatch になる
  const dndContextId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLayouts((prev) => {
      const oldIndex = prev.findIndex((l) => l.id === active.id);
      const newIndex = prev.findIndex((l) => l.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const handleSave = useCallback(() => {
    // バリデーション
    const emptySegments = layouts.filter((l) => !l.segment.trim());
    if (emptySegments.length > 0) {
      toast.error(t("meItems.segmentRequired"));
      return;
    }

    // 重複チェック
    const segments = layouts.map((l) => l.segment.trim().toLowerCase());
    const duplicates = segments.filter((s, i) => segments.indexOf(s) !== i);
    if (duplicates.length > 0) {
      toast.error(t("meItems.duplicateSegment"));
      return;
    }

    const formData = new FormData();
    formData.set("_action", "saveAll");
    formData.set("layouts", JSON.stringify(layouts));
    if (activePreset) {
      formData.set("presetId", activePreset.id);
    }
    fetcher.submit(formData, { method: "post" });
  }, [layouts, fetcher, activePreset]);

  const handleReset = useCallback(() => {
    setLayouts(initialLayouts);
  }, [initialLayouts]);

  // プリセットからコピー
  const handleCopyFromPreset = useCallback((presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || !preset.itemLayoutsData) {
      toast.error(t("meItems.copyNoData"));
      return;
    }

    try {
      // itemLayoutsData（serializeItemLayouts の出力）は slots / offhand が入れ子の JSON 文字列のまま。
      // state の ItemLayout はパース済み配列を持つ形なので、ここで展開してから入れる
      const itemLayoutsDataParsed = JSON.parse(preset.itemLayoutsData) as PresetItemLayoutData[];
      setLayouts(itemLayoutsDataParsed.map((layout) => ({
        id: `new-${createId()}`,
        segment: layout.segment,
        slots: JSON.parse(layout.slots) as Slot[],
        offhand: layout.offhand ? (JSON.parse(layout.offhand) as string[]) : [],
        notes: layout.notes ?? null,
      })));
      toast.success(t("meItems.copiedFromPreset", { name: preset.name }));
    } catch (e) {
      console.error("Failed to parse item layouts data:", e);
      toast.error(t("meItems.parseFailed"));
    }

    setCopyDialogOpen(false);
  }, [presets]);

  // 行へ渡す props は memo が効くよう identity を安定させる（毎レンダー新配列にしない）
  const existingSegments = useMemo(() => layouts.map((l) => l.segment), [layouts]);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("meItems.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("meItems.pageDescription")}
          </p>
        </div>
      </div>

      {/* プリセットセレクター */}
      <PresetSelector
        presets={presets.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive, isMain: p.isMain }))}
        activePresetId={activePreset?.id ?? null}
        hasChanges={hasChanges}
        onSwitchingChange={setPresetSwitching}
        onCopyFromOther={presets.length > 1 ? () => setCopyDialogOpen(true) : undefined}
      />

      {/* プリセット未作成時の案内（リンクを押せるようゲート外に置く） */}
      {!hasPresets && <PresetRequiredNotice />}

      {/* プリセット切替中はロックする */}
      <PresetSwitchLock locked={presetSwitching}>
      <div className={cn(!hasPresets && "pointer-events-none opacity-50")}>
      {layouts.length > 0 ? (
        <div className="rounded-xl border border-border/70 bg-background/80">
          <DndContext
            id={dndContextId}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={layouts.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-border/60">
                {layouts.map((layout) => (
                  <EditableLayoutRow
                    key={layout.id}
                    layout={layout}
                    onUpdate={handleUpdateLayout}
                    onDelete={handleDeleteLayout}
                    onDuplicate={handleDuplicateLayout}
                    existingSegments={existingSegments}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <div className="border-t border-border/60 px-4 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddLayout}
              disabled={!hasPresets}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("meItems.addLayout")}
            </Button>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Package className="h-12 w-12" />}
          title={t("meItems.emptyTitle")}
          description={t("meItems.emptyDescription")}
          action={
            <Button onClick={handleAddLayout}>
              <Plus className="mr-2 h-4 w-4" />
              {t("meItems.addLayout")}
            </Button>
          }
        />
      )}
      </div>
      </PresetSwitchLock>

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
            <DialogTitle>{t("meItems.copyDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("meItems.copyDialogDescription")}
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
                    disabled={!preset.hasItemLayouts}
                    onClick={() => handleCopyFromPreset(preset.id)}
                  >
                    <div className="flex flex-col items-start gap-1">
                      <span className="font-medium">{preset.name}</span>
                      <div className="flex gap-1 flex-wrap">
                        {preset.hasItemLayouts ? (
                          <Badge variant="secondary" className="text-xs">
                            <Package className="h-3 w-3 mr-1" />
                            {t("meItems.itemLayouts")}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {t("meItems.noData")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Button>
                ))}
              {presets.filter((p) => p.id !== activePreset?.id).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("meItems.noOtherPresets")}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
              {t("meItems.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
            <h2 className="text-2xl font-bold">{t("meItems.errorTitle")}</h2>
            <p className="text-muted-foreground">
              {t("meItems.errorDescription")}
            </p>
            <Button onClick={() => window.location.reload()}>
              {t("meItems.reloadPage")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
