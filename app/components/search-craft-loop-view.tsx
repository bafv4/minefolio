import { Fragment, useCallback, useMemo, type ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  ActualKeyBadges,
  TIMING_META,
  timingLabel,
} from "@/components/search-craft-template-view";
import {
  renderVisibleSpaces,
  ControlKeyBadge,
  CraftMarker,
} from "@/components/search-craft-badges";
import {
  resolveLoopSteps,
  typedCharSegments,
  type LoopStepData,
  type LoopKeyOp,
  type ResolvedLoopStep,
  type TypedCharSegment,
} from "@/lib/search-craft-loops";
import type { UiRemapInfo, RemapInfo } from "@/lib/remap-utils";
import type { SearchCraftVariation } from "@/lib/search-craft-variations";
import type { FingerType, KeyboardLayout } from "@/lib/keybindings";
import { LoopKeySequenceButton } from "@/components/search-craft-key-sequence-dialog";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { AlertTriangle, ChevronRight, Repeat } from "lucide-react";

/**
 * サーチクラフトの「繋ぎ方（Loop）」表示コンポーネント群。
 * プレイヤープロフィールのサーチクラフトタブ・テンプレート詳細ページ・
 * /me/search-craft・Playground（編集プレビュー経由）で共用する。
 */

/** Loop の参照解決に必要な最小限のクラフト情報（表示用） */
export type LoopCraftInfo = {
  id: string;
  items: string[];
  /** 複数サーチ文字列バリエーション。表示文字列は必ず ResolvedLoopStep（.searchStr）経由で取ること */
  variations: SearchCraftVariation[];
};

/** 表示用の Loop 行データ */
export type SearchCraftLoopRowData = {
  id: string;
  steps: LoopStepData[];
  comment: string | null;
  timing: string | null;
};

// ============================================
// セグメント分割された文字列表示
// ============================================

/**
 * typedCharSegments() の結果を描画する。そのステップで実際にタイプしない
 * （前ステップから検索欄に残存するだけの）セグメントは text-muted-foreground/70 で薄く表示する
 * （SearchStringText のスペース可視化と同じトーン）。半角スペースの ␣ 可視化はセグメント内でも維持する。
 * 読み上げ用に元の文字列全体を aria-label で渡し、セグメント描画自体は aria-hidden にする
 * （SearchStringText と同じ方針）。
 */
function SegmentedSearchString({
  value,
  segments,
}: {
  value: string;
  segments: TypedCharSegment[];
}) {
  const DIM_CLASS = "text-muted-foreground/70";
  return (
    <span aria-label={value}>
      {segments.map((segment, i) => (
        <span key={i} aria-hidden="true" className={segment.typed ? undefined : DIM_CLASS}>
          {renderVisibleSpaces(segment.text, DIM_CLASS)}
        </span>
      ))}
    </span>
  );
}

// 制御キーバッジ（ControlKeyBadge）は app/components/search-craft-badges.tsx が単一ソース
// （既存 importer を無改修で保つための re-export。上部の import 済みバインディングを再公開する）
export { ControlKeyBadge };

/** 遷移・参照が無効なセグメントのプレースホルダーバッジ */
function InvalidSegmentBadge() {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded border-2 border-destructive/50 bg-destructive/10 px-1.5 font-mono text-sm font-semibold text-destructive">
          [?]
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("playerProfile.loopInvalidTransition")}</TooltipContent>
    </Tooltip>
  );
}

/**
 * クラフト実行マーカーを表示する（実体は app/components/search-craft-badges.tsx の
 * `CraftMarker`）。サーチ文字列部分は typedCharSegments() の結果（`SegmentedSearchString`）を
 * 渡し、実際にタイプしない残存部分を薄く表示する。複数アイテム時の Tooltip 内訳は
 * `showItemBreakdown` で有効化する（UI ロケール依存の表示名 = `getLocalizedItemName`）。
 */
function LoopCraftMarker({
  craft,
  searchStr,
  segments,
}: {
  craft: LoopCraftInfo | undefined;
  /** このステップで実際に参照されるバリエーションの searchStr（ResolvedLoopStep.searchStr） */
  searchStr: string | null;
  segments: TypedCharSegment[];
}) {
  return (
    <CraftMarker
      items={craft?.items ?? []}
      content={searchStr ? <SegmentedSearchString value={searchStr} segments={segments} /> : null}
      showItemBreakdown
    />
  );
}

/** 遷移1件分のキー操作列（backspace/selectAll/home は制御キーバッジ、type は ActualKeyBadges）。
 * 編集UI（search-craft-loop-editor.tsx の TransitionRow）のライブプレビューとも共用する。
 * shiftHeld は「遷移先ステップ（=このステップ自身）」の withShift を渡す想定で、type op の
 * キー列だけを ShiftKeyGroup で囲む（制御キー・クラフト実行マーカーは対象外）。 */
export function TransitionOpsBadges({
  ops,
  remaps,
  fingerAssignments,
  shiftHeld,
}: {
  ops: LoopKeyOp[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  /** 遷移先ステップの withShift。type op のキー列にのみ適用する */
  shiftHeld?: boolean;
}) {
  return (
    <>
      {ops.map((op, idx) => {
        switch (op.kind) {
          case "backspace":
            return <ControlKeyBadge key={idx} kind="backspace" count={op.count} remaps={remaps} />;
          case "arrowLeft":
            return <ControlKeyBadge key={idx} kind="arrowLeft" count={op.count} remaps={remaps} />;
          case "selectAll":
            return <ControlKeyBadge key={idx} kind="selectAll" remaps={remaps} />;
          case "home":
            return <ControlKeyBadge key={idx} kind="home" remaps={remaps} />;
          case "type":
            return (
              <ActualKeyBadges
                key={idx}
                searchStr={op.text}
                remaps={remaps}
                fingerAssignments={fingerAssignments}
                shiftHeld={shiftHeld}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}

/**
 * 参照解決済みの Loop ステップ列からキー操作の連鎖を描画する。
 * 先頭ステップは自身の searchStr をそのままタイプするキー列、
 * 以降は derived（deriveTransition の結果）のキー操作列を描画し、
 * ステップの間にクラフト実行マーカー＋ChevronRight を挟む。
 */
export function LoopKeySequence({
  steps,
  getCraft,
  remaps,
  fingerAssignments,
}: {
  steps: ResolvedLoopStep[];
  getCraft: (craftId: string) => LoopCraftInfo | undefined;
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
}) {
  return (
    // gap-2: 制御キー・打鍵キー・クラフトチップの各セグメント間に若干の間隔を置く
    // （個々のキー同士は ActualKeyBadges 内部の gap-1 のまま）
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((step, idx) => {
        const craft = getCraft(step.craftId);
        // 表示文字列は必ず ResolvedLoopStep（variationIndex 考慮済み）から取る。
        // getCraft の再引きは常に「そのクラフトの生データ」しか返さないため、
        // ここで craft?.searchStr のような再導出をすると variationIndex を無視した
        // 固定表示（実質バリエーション0固定）になるバグを埋め込むことになる。
        // derived は resolveLoopSteps 側で計算済み（ResolvedLoopStep.derived）のため、
        // ここでは渡すだけで内部の deriveTransition 再計算をスキップする
        const segments = typedCharSegments(
          idx > 0 ? steps[idx - 1].searchStr : null,
          step.searchStr ?? "",
          step.transition,
          step.derived,
        );
        return (
          <Fragment key={idx}>
            {idx === 0 ? (
              step.searchStr ? (
                <ActualKeyBadges
                  searchStr={step.searchStr}
                  remaps={remaps}
                  fingerAssignments={fingerAssignments}
                  shiftHeld={step.withShift}
                />
              ) : (
                <InvalidSegmentBadge />
              )
            ) : step.derived?.valid ? (
              <TransitionOpsBadges
                ops={step.derived.ops}
                remaps={remaps}
                fingerAssignments={fingerAssignments}
                shiftHeld={step.withShift}
              />
            ) : (
              <InvalidSegmentBadge />
            )}
            <LoopCraftMarker craft={craft} searchStr={step.searchStr} segments={segments} />
            {idx < steps.length - 1 && (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ============================================
// Loop 一覧
// ============================================

/**
 * Loop 1件分の行。キー操作列（LoopKeySequence）単体に統合された1行表示で、
 * 各ステップのアイテム＋サーチ文字列はクラフト実行マーカー内に表示される
 * （独立したステップ連鎖サマリー行は持たない）。
 */
export function SearchCraftLoopRow({
  loop,
  crafts,
  remaps,
  fingerAssignments,
  keyboardLayout,
  showTiming = true,
}: {
  loop: SearchCraftLoopRowData;
  crafts: LoopCraftInfo[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  /** キー入力順ダイアログのバーチャルキーボードに使うレイアウト（未指定時のフォールバックは
   * LoopKeySequenceButton → VirtualKeyboard の既定値 "US" に委ねる） */
  keyboardLayout?: KeyboardLayout;
  /** タイミンググループカード内に埋め込む場合は false（グループ見出しと重複するため） */
  showTiming?: boolean;
}) {
  const t = useT();
  const craftsById = useMemo(() => new Map(crafts.map((c) => [c.id, c])), [crafts]);
  // craftsById が変わらない限り同一の関数を保つ（LoopKeySequenceButton 側の
  // sequence useMemo が親の無関係な再レンダーで失効しないようにするため）
  const getCraft = useCallback((id: string) => craftsById.get(id), [craftsById]);
  const resolved = useMemo(
    () =>
      resolveLoopSteps(loop.steps, (id) => {
        const craft = craftsById.get(id);
        return craft ? { variations: craft.variations } : undefined;
      }),
    [loop.steps, craftsById],
  );
  const timingMeta = loop.timing ? TIMING_META.find((m) => m.id === loop.timing) : undefined;

  return (
    <div className="py-3 space-y-2">
      {/* キー操作列に統合された1行表示（アイテム＋文字列はクラフト実行マーカー内に表示される） */}
      <div className="flex flex-wrap items-center gap-2">
        {!resolved.valid && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("playerProfile.loopInvalidTransition")}</TooltipContent>
          </Tooltip>
        )}

        <div className="min-w-0 flex-1">
          <LoopKeySequence
            steps={resolved.steps}
            getCraft={getCraft}
            remaps={remaps}
            fingerAssignments={fingerAssignments}
          />
        </div>

        <LoopKeySequenceButton
          steps={resolved.steps}
          getCraft={getCraft}
          remaps={remaps}
          layout={keyboardLayout}
          fingerAssignments={fingerAssignments}
        />

        {showTiming && timingMeta && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("h-2.5 w-2.5 rounded-full", timingMeta.dot)} />
            {timingLabel(t, timingMeta)}
          </span>
        )}
      </div>

      {loop.comment && <p className="text-sm text-muted-foreground">{loop.comment}</p>}
    </div>
  );
}

/**
 * タイミンググループカード内に埋め込む Loop サブセクション（Card なし）。
 * SearchCraftGroupedList の renderGroupExtra から呼ぶ想定で、見出し（Repeat アイコン＋
 * 「繋ぎ方（Loop）」）＋行リストを描画する。グループ見出しと重複するため各行の
 * timing 表記は出さない。loops が空なら何も描画しない。
 */
export function SearchCraftLoopGroupSection({
  loops,
  crafts,
  remaps,
  fingerAssignments,
  keyboardLayout,
}: {
  loops: SearchCraftLoopRowData[];
  crafts: LoopCraftInfo[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  keyboardLayout?: KeyboardLayout;
}) {
  const t = useT();
  if (loops.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Repeat className="h-3.5 w-3.5" />
        {t("playerProfile.loopSectionTitle")}
      </div>
      <div className="divide-y">
        {loops.map((loop) => (
          <SearchCraftLoopRow
            key={loop.id}
            loop={loop}
            crafts={crafts}
            remaps={remaps}
            fingerAssignments={fingerAssignments}
            keyboardLayout={keyboardLayout}
            showTiming={false}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Loop を timing ごとにグループ化する（SearchCraftGroupedList の renderGroupExtra /
 * extraTimings 用）。プロフィール・テンプレート詳細ページで共通のグルーピング配線。
 */
export function groupLoopsByTiming(
  loops: SearchCraftLoopRowData[],
): Map<string | null, SearchCraftLoopRowData[]> {
  const map = new Map<string | null, SearchCraftLoopRowData[]>();
  for (const loop of loops) {
    const key = loop.timing;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(loop);
  }
  return map;
}

/**
 * SearchCraftGroupedList の `renderGroupExtra` にそのまま渡せる `(timing) => ReactNode` を作る。
 * 内部で groupLoopsByTiming() を使い、該当 timing の loops が空なら何も描画しない
 * （SearchCraftLoopGroupSection 自身も同じ判定を持つが、Map 未ヒット時の `?? []` はここで吸収する）。
 */
export function makeLoopGroupExtra({
  loops,
  crafts,
  remaps,
  fingerAssignments,
  keyboardLayout,
}: {
  loops: SearchCraftLoopRowData[];
  crafts: LoopCraftInfo[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  keyboardLayout?: KeyboardLayout;
}): (timing: string | null) => ReactNode {
  const byTiming = groupLoopsByTiming(loops);
  return (timing) => {
    const groupLoops = byTiming.get(timing) ?? [];
    return groupLoops.length > 0 ? (
      <SearchCraftLoopGroupSection
        loops={groupLoops}
        crafts={crafts}
        remaps={remaps}
        fingerAssignments={fingerAssignments}
        keyboardLayout={keyboardLayout}
      />
    ) : null;
  };
}
