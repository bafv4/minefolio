import { Fragment, useMemo, type ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatItemName } from "@bafv4/mcitems/1.16/react";
import { ItemIcon } from "@/components/item-icon";
import {
  ActualKeyBadges,
  TIMING_META,
  timingLabel,
  renderVisibleSpaces,
} from "@/components/search-craft-template-view";
import {
  resolveLoopSteps,
  typedCharSegments,
  type LoopStepData,
  type LoopKeyOp,
  type ResolvedLoopStep,
  type TypedCharSegment,
} from "@/lib/search-craft-loops";
import { getActualControlKeyInfo, type UiRemapInfo, type RemapInfo } from "@/lib/remap-utils";
import type { SearchCraftVariation } from "@/lib/search-craft-variations";
import { getKeyLabel, getKeyCombinationLabel, type FingerType } from "@/lib/keybindings";
import { KeyLabelText } from "@/components/shift-mark";
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

// ============================================
// 制御キーバッジ
// ============================================

/**
 * 制御キー（Backspace / ArrowLeft / Home / Shift+Home）のバッジ。
 * 文字入力キー（KeyBadge、secondary系の塗り）と区別できるよう info トーンで表示する
 * （⇧ Shift バッジ=warning・クラフト実行マーカー=破線チップと同じ「役割ごとに色調を変える」規則）。
 * BS×n / ←×n はバッジを n 個並べず、右肩に ×n を併記する（モバイル幅対策）。
 * ← のラベルは app/lib/keybindings.ts の KEY_LABELS.ArrowLeft と同じ "←" を使う。
 *
 * remaps を渡すと、その制御キーの出力になっているリマップを逆引きする
 * （getActualControlKeyInfo()）。リマップが無い場合（大多数）は非リマップ時と完全に同一の
 * 単一ピル表示のまま。リマップが見つかった場合のみ複合ピルにする —
 * **主ラベル＝実際に押すキー**（外側、既存の単一ピルと同じ text-sm・info トーン）、
 * その中に「チップの中のチップ」として**出力操作**（BS 等）をミニチップ（text-[10px]）で添える。
 * 既存のリマップ用リング（ring-2 ring-primary ring-offset-1 ring-offset-background）を付け、
 * Tooltip も主従の入れ替えに合わせた文言に差し替える。
 */
type ControlKeyKind = "backspace" | "arrowLeft" | "selectAll" | "home";

/** kind ごとの表示・逆引き設定を1箇所にまとめる（keyCode・バッジ短縮ラベル・逆引き対象キー） */
const CONTROL_KEY_META: Record<
  ControlKeyKind,
  { keyCode: string; label: string; targetKeyCode: string }
> = {
  backspace: { keyCode: "Backspace", label: "BS", targetKeyCode: "Backspace" },
  arrowLeft: { keyCode: "ArrowLeft", label: "←", targetKeyCode: "ArrowLeft" },
  home: { keyCode: "Home", label: "Home", targetKeyCode: "Home" },
  // ⇧Home は「1キーの出力」に単一化されないため、逆引きは Home 成分のみ渡し
  // getActualControlKeyInfo 側の shiftHeld オプションで Shift 成分と合成する
  selectAll: { keyCode: "Shift+Home", label: "⇧Home", targetKeyCode: "Home" },
};

export function ControlKeyBadge({
  kind,
  count,
  remaps,
}: {
  kind: ControlKeyKind;
  /** backspace / arrowLeft のときのみ意味を持つ。2以上のときだけ右肩に ×n を表示する */
  count?: number;
  /** 指定すると、この制御キーの出力になっているリマップを逆引きして複合ピル表示にする */
  remaps?: UiRemapInfo[] | RemapInfo[];
}) {
  const t = useT();
  const { keyCode, label, targetKeyCode } = CONTROL_KEY_META[kind];

  const actual = remaps
    ? getActualControlKeyInfo(t, targetKeyCode, remaps, { shiftHeld: kind === "selectAll" })
    : null;

  // 操作名のフル表記（⇧ 等の短縮記号を使わない。Tooltip 専用。Shift+Home も省略しない）
  const opFullLabel = keyCode.includes("+") ? getKeyCombinationLabel(t, keyCode) : getKeyLabel(t, keyCode);

  // 物理キーボードのキー情報ツールチップ（key-info-trigger.tsx）と同じ「リマップ: 物理 → 出力」形式。
  // 1行目は実際に押すキー（フル名称）— 操作名、2行目以降は成分ごとのリマップ詳細（⇧Home は最大2行）
  const tooltipContent = actual?.isRemapped ? (
    <div className="space-y-1">
      <p>{t("playerProfile.controlKeyActualTooltip", { key: actual.tooltipLabel, op: opFullLabel })}</p>
      <div className="space-y-0.5 border-t border-border/40 pt-1">
        {actual.remapDetails.map((detail, i) => (
          <p key={i} className="text-muted-foreground">
            {t("playerProfile.remapped", { source: detail.sourceLabel, target: detail.targetLabel })}
          </p>
        ))}
      </div>
    </div>
  ) : (
    opFullLabel
  );

  return (
    <span className="relative inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          {actual?.isRemapped ? (
            // 複合ピル: 主ラベル＝実際に押すキー（既存の単一ピルと同じ text-sm）、
            // その中に「チップの中のチップ」として出力操作（BS 等）をミニチップで添える
            <span className="inline-flex h-7 items-center gap-1 rounded-full border-2 border-info/50 bg-info/10 py-0.5 pl-2.5 pr-1.5 font-mono font-semibold text-info ring-2 ring-primary ring-offset-1 ring-offset-background">
              <span className="text-sm">
                <KeyLabelText label={actual.displayLabel} />
              </span>
              <span className="rounded-full border border-info/40 bg-info/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-info">
                <KeyLabelText label={label} shiftClassName="size-2.5" />
              </span>
            </span>
          ) : (
            // 文字入力キー（角丸 rounded）と一目で区別できるよう、制御キーは rounded-full のピル形状にする
            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-info/50 bg-info/10 px-2.5 font-mono text-sm font-semibold text-info">
              <KeyLabelText label={label} />
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
      {(kind === "backspace" || kind === "arrowLeft") && (count ?? 0) > 1 && (
        // aria-hidden を付けない: スクリーンリーダーにも「BS ×2」のように回数が伝わるようにする
        <span className="absolute -top-1.5 -right-1.5 rounded-full bg-muted-foreground px-1 py-0.5 text-[10px] font-semibold leading-none text-background">
          ×{count}
        </span>
      )}
    </span>
  );
}

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
 * クラフト実行マーカー（通常のアイテムチップと同じ見た目のチップ。ItemIcon 24px＋サーチ文字列）。
 * 高さはキー系バッジ（h-7）に揃える。アイコン類（Hammer 等）は置かず、
 * 「ここでクラフトを実行する」ことの説明は Tooltip と凡例（KeyBadgeLegend）が担う。
 * サーチ文字列は typedCharSegments() の結果を渡すと、実際にタイプしない残存部分が薄く表示される。
 */
function CraftMarker({
  craft,
  searchStr,
  segments,
}: {
  craft: LoopCraftInfo | undefined;
  /** このステップで実際に参照されるバリエーションの searchStr（ResolvedLoopStep.searchStr） */
  searchStr: string | null;
  segments: TypedCharSegment[];
}) {
  const t = useT();
  const items = craft?.items ?? [];
  // 同じサーチ文字列で複数アイテムが出せるクラフト（items 2件以上）は、
  // 最初の1アイテムだけでなく全アイテムのアイコンを並べる（チップは h-7 のまま横に伸びる）。
  // Tooltip も複数件のときだけ内訳（アイテム名の列挙）を添えて識別できるようにする。
  const tooltipContent =
    items.length > 1
      ? `${t("playerProfile.loopCraftMarker")}（${items.map((id) => formatItemName(id)).join(" / ")}）`
      : t("playerProfile.loopCraftMarker");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded bg-secondary/50 px-2">
          {items.map((itemId, idx) => (
            <ItemIcon key={idx} itemId={itemId} size={24} />
          ))}
          {searchStr && (
            <code className="font-mono text-sm">
              <SegmentedSearchString value={searchStr} segments={segments} />
            </code>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipContent}</TooltipContent>
    </Tooltip>
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
}: {
  shiftHeld,
  ops: LoopKeyOp[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
}) {
  /** 遷移先ステップの withShift。type op のキー列にのみ適用する */
  shiftHeld?: boolean;
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
              />
                shiftHeld={shiftHeld}
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
                />
                  shiftHeld={step.withShift}
              ) : (
                <InvalidSegmentBadge />
              )
            ) : step.derived?.valid ? (
              <TransitionOpsBadges
                ops={step.derived.ops}
                remaps={remaps}
                fingerAssignments={fingerAssignments}
              />
                shiftHeld={step.withShift}
            ) : (
              <InvalidSegmentBadge />
            )}
            <CraftMarker craft={craft} searchStr={step.searchStr} segments={segments} />
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
  showTiming = true,
}: {
  loop: SearchCraftLoopRowData;
  crafts: LoopCraftInfo[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  /** タイミンググループカード内に埋め込む場合は false（グループ見出しと重複するため） */
  showTiming?: boolean;
}) {
  const t = useT();
  const craftsById = useMemo(() => new Map(crafts.map((c) => [c.id, c])), [crafts]);
  const resolved = useMemo(
    () =>
      resolveLoopSteps(loop.steps, (id) => {
        const craft = craftsById.get(id);
        return craft
          ? {
              searchStrs: craft.variations.map((v) => v.str),
              withShifts: craft.variations.map((v) => v.withShift),
            }
          : undefined;
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
            getCraft={(id) => craftsById.get(id)}
            remaps={remaps}
            fingerAssignments={fingerAssignments}
          />
        </div>

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
}: {
  loops: SearchCraftLoopRowData[];
  crafts: LoopCraftInfo[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
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
}: {
  loops: SearchCraftLoopRowData[];
  crafts: LoopCraftInfo[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
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
      />
    ) : null;
  };
}
