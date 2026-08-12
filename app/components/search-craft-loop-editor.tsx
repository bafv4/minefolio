import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Minus, X, Trash2, GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatItemName } from "@bafv4/mcitems/1.16/react";
import { ItemIcon } from "@/components/item-icon";
import { ActualKeyBadges } from "@/components/search-craft-template-view";
import {
  ControlKeyBadge,
  LoopKeySequence,
  type LoopCraftInfo,
} from "@/components/search-craft-loop-view";
import {
  resolveLoopSteps,
  deriveTransition,
  minBackspaceCount,
  minArrowLeftCount,
  LOOP_TRANSITION_TYPES,
  type LoopStepData,
  type LoopTransition,
  type LoopTransitionType,
} from "@/lib/search-craft-loops";
import type { RemapInfo } from "@/lib/remap-utils";
import type { SearchCraftTiming } from "@/lib/search-craft-templates";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";

/**
 * サーチクラフトの「繋ぎ方（Loop）」編集UI（/me/search-craft・ワークベンチ・テンプレートエディタで共通）。
 * 行単体（LoopEditorRow）は app/components/search-craft-editor.tsx の
 * SearchCraftTimingBoard（タイミングブロック型エディタ）から再利用される。
 * timing の変更はブロック間D&Dで行うため、行ヘッダーに timing Select は持たない。
 */

/** 編集UIが必要とする最小のLoop形状 */
export type SearchCraftLoopDraft = {
  id: string;
  steps: LoopStepData[];
  comment: string | null;
  timing: SearchCraftTiming | null;
};

/** ステップのエントリ選択に使う、参照可能なサーチクラフトエントリ */
export type LoopEditorEntry = LoopCraftInfo;

/** Select の「未選択」を表す value（craftId "" と相互変換する） */
const UNSELECTED_ENTRY = "__unselected__";

/** 新規ステップ追加時の初期 transition（前後のエントリが未選択のため bsCount は 0 から始める） */
function defaultTransition(): LoopTransition {
  return { type: "backspace", bsCount: 0 };
}

/**
 * 指定インデックスの遷移（steps[idx].transition）を、両隣のエントリから求めた
 * 新しい最小回数にリセットする（backspace は minBs、arrowLeft は minArrowLeftCount。
 * 見つからなければ 1 のまま invalid 表示に倒す）。selectAll/home は回数を持たないため対象外。
 * エントリの選択変更で前後の searchStr が変わった直後に呼ぶ。
 */
function resetTransitionCountAt(steps: LoopStepData[], idx: number, entries: LoopEditorEntry[]): LoopStepData[] {
  if (idx <= 0 || idx >= steps.length) return steps;
  const transition = steps[idx].transition;
  if (!transition) return steps;

  const prev = entries.find((e) => e.id === steps[idx - 1].craftId);
  const next = entries.find((e) => e.id === steps[idx].craftId);
  if (!prev?.searchStr || !next?.searchStr) return steps;

  const result = [...steps];
  if (transition.type === "backspace") {
    const minBs = minBackspaceCount(prev.searchStr, next.searchStr);
    result[idx] = { ...result[idx], transition: { type: "backspace", bsCount: minBs } };
    return result;
  }
  if (transition.type === "arrowLeft") {
    const minArrow = minArrowLeftCount(prev.searchStr, next.searchStr) ?? 1;
    result[idx] = { ...result[idx], transition: { type: "arrowLeft", arrowCount: minArrow } };
    return result;
  }
  return steps;
}

/**
 * 指定 craftId に隣接する（前後いずれかのステップが参照する）全遷移の回数を、
 * 現在の searchStr に基づく最小値へリセットする。エントリのサーチ文字列を編集した直後に、
 * SearchCraftTimingBoard 側から呼ぶ（エントリ選択変更時の resetTransitionCountAt と同じ趣旨。
 * BS/← の回数は常に「最小回数を初期表示」し、ユーザーがそこから調整する）。
 * 変更が無ければ元の配列をそのまま返す。
 */
export function resetTransitionCountsForCraft(
  steps: LoopStepData[],
  craftId: string,
  entries: LoopEditorEntry[],
): LoopStepData[] {
  let result = steps;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i - 1].craftId === craftId || steps[i].craftId === craftId) {
      result = resetTransitionCountAt(result, i, entries);
    }
  }
  return result;
}

/** 先頭ステップの transition は常に null という不変条件を保つ */
function normalizeFirstStep(steps: LoopStepData[]): LoopStepData[] {
  if (steps.length === 0 || steps[0].transition === null) return steps;
  const result = [...steps];
  result[0] = { ...result[0], transition: null };
  return result;
}

function invalidTransitionMessage(
  t: Translator,
  prev: LoopEditorEntry | undefined,
  next: LoopEditorEntry | undefined,
  transition: LoopTransition,
): string | null {
  if (!prev || !next) return t("meSearchCraft.loopInvalidEntryMissing");
  if (!prev.searchStr || !next.searchStr) return t("meSearchCraft.loopInvalidEmptySearchStr");
  const derived = deriveTransition(prev.searchStr, next.searchStr, transition);
  if (derived.valid) return null;
  switch (derived.reason) {
    case "not_extension":
      return t("meSearchCraft.loopInvalidHome");
    case "not_insertion":
      return t("meSearchCraft.loopInvalidArrowLeft");
    case "arrow_out_of_range":
      return t("meSearchCraft.loopInvalidArrowRange");
    case "bs_out_of_range":
    case "prefix_mismatch":
      return t("meSearchCraft.loopInvalidBsRange");
    case "missing_search_str":
      return t("meSearchCraft.loopInvalidEmptySearchStr");
    default:
      // TransitionInvalidReason 追加時にここでコンパイルエラーにする（黙ってBS文言に落とさない）
      return derived.reason satisfies never;
  }
}

// ============================================
// エントリ選択（ステップ行）
// ============================================

function EntrySelect({
  craftId,
  entries,
  onChange,
}: {
  craftId: string;
  entries: LoopEditorEntry[];
  onChange: (craftId: string) => void;
}) {
  const t = useT();
  return (
    // エントリ数が少ないうちは Select で十分。数十件規模に増えたら
    // 検索可能な @/components/ui/combobox.tsx への差替えを検討する
    <Select
      value={craftId || UNSELECTED_ENTRY}
      onValueChange={(v) => onChange(v === UNSELECTED_ENTRY ? "" : v)}
    >
      <SelectTrigger className="h-8 min-w-0 flex-1">
        <SelectValue placeholder={t("meSearchCraft.loopSelectEntryPlaceholder")} />
      </SelectTrigger>
      <SelectContent>
        {entries.map((entry) => (
          <SelectItem key={entry.id} value={entry.id}>
            <span className="flex min-w-0 items-center gap-1.5">
              {entry.items[0] && <ItemIcon itemId={entry.items[0]} size={16} />}
              <span className="truncate">
                {entry.items[0] ? formatItemName(entry.items[0]) : "—"}
              </span>
              {entry.searchStr && (
                <code className="text-xs text-muted-foreground">({entry.searchStr})</code>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ============================================
// 遷移行（ステップ2以降）
// ============================================

function TransitionRow({
  prev,
  next,
  transition,
  onChange,
  remaps,
}: {
  prev: LoopEditorEntry | undefined;
  next: LoopEditorEntry | undefined;
  transition: LoopTransition;
  onChange: (transition: LoopTransition) => void;
  remaps?: RemapInfo[];
}) {
  const t = useT();

  const bounds = useMemo(() => {
    if (!prev?.searchStr || !next?.searchStr) return null;
    return {
      minBs: minBackspaceCount(prev.searchStr, next.searchStr),
      maxBs: prev.searchStr.length,
      // arrowLeft は妥当な k が連続しているとは限らないため、範囲自体は固定で 1〜prev.length。
      // minArrow は方式切替時の初期値としてのみ使う（見つからなければ既定 1 のまま invalid 表示）
      minArrow: minArrowLeftCount(prev.searchStr, next.searchStr) ?? 1,
      maxArrow: prev.searchStr.length,
    };
  }, [prev, next]);

  const invalidMessage = invalidTransitionMessage(t, prev, next, transition);
  const derived =
    prev?.searchStr && next?.searchStr ? deriveTransition(prev.searchStr, next.searchStr, transition) : null;

  const handleTypeChange = (type: LoopTransitionType) => {
    if (type === "backspace") {
      onChange({ type: "backspace", bsCount: bounds?.minBs ?? 0 });
    } else if (type === "arrowLeft") {
      onChange({ type: "arrowLeft", arrowCount: bounds?.minArrow ?? 1 });
    } else {
      onChange({ type });
    }
  };

  const handleBsChange = (nextCount: number) => {
    if (transition.type !== "backspace") return;
    onChange({ type: "backspace", bsCount: nextCount });
  };

  const handleArrowChange = (nextCount: number) => {
    if (transition.type !== "arrowLeft") return;
    onChange({ type: "arrowLeft", arrowCount: nextCount });
  };

  return (
    <div className="ml-6 space-y-1.5 border-l-2 border-dashed border-border/60 py-1 pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="shrink-0 text-xs text-muted-foreground">
          {t("meSearchCraft.loopTransitionLabel")}
        </Label>
        <Select value={transition.type} onValueChange={(v) => handleTypeChange(v as LoopTransitionType)}>
          <SelectTrigger className="h-8 w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOOP_TRANSITION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(
                  type === "backspace"
                    ? "meSearchCraft.loopTransitionBackspace"
                    : type === "arrowLeft"
                      ? "meSearchCraft.loopTransitionArrowLeft"
                      : type === "selectAll"
                        ? "meSearchCraft.loopTransitionSelectAll"
                        : "meSearchCraft.loopTransitionHome",
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {transition.type === "backspace" && (
          <div className="flex items-center gap-1">
            <Label className="shrink-0 text-xs text-muted-foreground">
              {t("meSearchCraft.loopBsCountLabel")}
            </Label>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={bounds !== null && transition.bsCount <= bounds.minBs}
              onClick={() => handleBsChange(Math.max(0, transition.bsCount - 1))}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-6 text-center font-mono text-sm">{transition.bsCount}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={bounds !== null && transition.bsCount >= bounds.maxBs}
              onClick={() => handleBsChange(transition.bsCount + 1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        )}
        {transition.type === "arrowLeft" && (
          <div className="flex items-center gap-1">
            <Label className="shrink-0 text-xs text-muted-foreground">
              {t("meSearchCraft.loopArrowCountLabel")}
            </Label>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={transition.arrowCount <= 1}
              onClick={() => handleArrowChange(Math.max(1, transition.arrowCount - 1))}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-6 text-center font-mono text-sm">{transition.arrowCount}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={bounds !== null && transition.arrowCount >= bounds.maxArrow}
              onClick={() => handleArrowChange(transition.arrowCount + 1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* ライブプレビュー */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("meSearchCraft.loopPreviewLabel")}:
        </span>
        {invalidMessage ? (
          <span className="text-xs text-destructive">{invalidMessage}</span>
        ) : (
          derived?.valid &&
          derived.ops.map((op, idx) => {
            switch (op.kind) {
              case "backspace":
                return <ControlKeyBadge key={idx} kind="backspace" count={op.count} />;
              case "arrowLeft":
                return <ControlKeyBadge key={idx} kind="arrowLeft" count={op.count} />;
              case "selectAll":
                return <ControlKeyBadge key={idx} kind="selectAll" />;
              case "home":
                return <ControlKeyBadge key={idx} kind="home" />;
              case "type":
                return <ActualKeyBadges key={idx} searchStr={op.text} remaps={remaps ?? []} />;
              default:
                return null;
            }
          })
        )}
      </div>
    </div>
  );
}

// ============================================
// Loop 1件分の編集行
// ============================================

export function LoopEditorRow<T extends SearchCraftLoopDraft>({
  loop,
  index,
  entries,
  remaps,
  onUpdate,
  onDelete,
}: {
  loop: T;
  index: number;
  entries: LoopEditorEntry[];
  remaps?: RemapInfo[];
  onUpdate: (updated: T) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: loop.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const entriesById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const updateSteps = (steps: LoopStepData[]) => {
    onUpdate({ ...loop, steps: normalizeFirstStep(steps) });
  };

  const handleChangeCraftId = (stepIndex: number, craftId: string) => {
    let steps = loop.steps.map((s, i) => (i === stepIndex ? { ...s, craftId } : s));
    // このステップの前後、両方の遷移が影響を受ける（自分への遷移＝入、次への遷移＝出）
    steps = resetTransitionCountAt(steps, stepIndex, entries);
    steps = resetTransitionCountAt(steps, stepIndex + 1, entries);
    updateSteps(steps);
  };

  const handleChangeTransition = (stepIndex: number, next: LoopTransition) => {
    const steps = loop.steps.map((s, i) => (i === stepIndex ? { ...s, transition: next } : s));
    updateSteps(steps);
  };

  const handleAddStep = () => {
    const steps: LoopStepData[] = [...loop.steps, { craftId: "", transition: defaultTransition() }];
    updateSteps(steps);
  };

  const handleRemoveStep = (stepIndex: number) => {
    let steps = loop.steps.filter((_, i) => i !== stepIndex);
    // 除去で前後がつながり直した位置（旧 stepIndex+1 が詰めて stepIndex に来る）の遷移を、
    // 新しい前後ペアに合わせて最小回数へリセットする（handleChangeCraftId と同様の対称性）
    steps = resetTransitionCountAt(steps, stepIndex, entries);
    updateSteps(steps);
  };

  const resolved = useMemo(
    () =>
      resolveLoopSteps(loop.steps, (id) => {
        const entry = entriesById.get(id);
        return entry ? { searchStr: entry.searchStr } : undefined;
      }),
    [loop.steps, entriesById],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "py-3 space-y-3",
        isDragging && "opacity-50 bg-secondary/30 rounded-lg shadow-lg",
      )}
    >
      {/* ヘッダ */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          type="button"
          aria-label={t("meSearchCraft.dragHandle")}
          className="flex items-center justify-center text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground/60">
          {index + 1}
        </span>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="ml-auto shrink-0">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("meSearchCraft.deleteLoopTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("meSearchCraft.deleteLoopDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("meSearchCraft.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>{t("meSearchCraft.delete")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* ステップ */}
      <div className="space-y-2 pl-7">
        {loop.steps.map((step, stepIndex) => (
          <div key={stepIndex} className="space-y-1.5">
            {stepIndex > 0 && step.transition && (
              <TransitionRow
                prev={entriesById.get(loop.steps[stepIndex - 1].craftId)}
                next={entriesById.get(step.craftId)}
                transition={step.transition}
                onChange={(next) => handleChangeTransition(stepIndex, next)}
                remaps={remaps}
              />
            )}
            <div className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground/60">
                {stepIndex + 1}
              </span>
              <EntrySelect
                craftId={step.craftId}
                entries={entries}
                onChange={(craftId) => handleChangeCraftId(stepIndex, craftId)}
              />
              <button
                type="button"
                aria-label={t("meSearchCraft.removeStep")}
                onClick={() => handleRemoveStep(stepIndex)}
                disabled={loop.steps.length <= 2}
                className="shrink-0 p-1.5 rounded text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" size="sm" className="h-7" onClick={handleAddStep}>
          <Plus className="mr-1 h-3 w-3" />
          {t("meSearchCraft.loopAddStep")}
        </Button>
      </div>

      {/* Loop 全体プレビュー */}
      <div className="pl-7">
        <Label className="mb-1 block text-xs text-muted-foreground">
          {t("meSearchCraft.loopPreviewLabel")}
        </Label>
        <LoopKeySequence
          steps={resolved.steps}
          getCraft={(id) => entriesById.get(id)}
          remaps={remaps ?? []}
        />
      </div>

      {/* コメント */}
      <div className="pl-7">
        <Input
          value={loop.comment || ""}
          onChange={(e) => onUpdate({ ...loop, comment: e.target.value || null })}
          placeholder={t("meSearchCraft.commentOptional")}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}
