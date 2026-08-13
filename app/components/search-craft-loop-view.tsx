import { Fragment, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ItemIcon } from "@/components/item-icon";
import {
  ActualKeyBadges,
  TIMING_META,
  timingLabel,
} from "@/components/search-craft-template-view";
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
import { getKeyLabel, getKeyCombinationLabel, type FingerType } from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { AlertTriangle, ChevronRight, Hammer, Repeat } from "lucide-react";

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
 * 半角スペースを ␣（U+2423）として可視化しつつテキスト片を描画する
 * （search-craft-template-view.tsx の SearchStringText と同じロジック。全角スペースは対象外）。
 */
function renderVisibleSpaces(text: string, spaceClassName: string) {
  const parts = text.split(/( +)/);
  return parts.map((part, i) =>
    part.length > 0 && part[0] === " " ? (
      <span key={i} className={spaceClassName}>
        {"␣".repeat(part.length)}
      </span>
    ) : (
      part
    ),
  );
}

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
 */
export function ControlKeyBadge({
  kind,
  count,
}: {
  kind: "backspace" | "arrowLeft" | "selectAll" | "home";
  /** backspace / arrowLeft のときのみ意味を持つ。2以上のときだけ右肩に ×n を表示する */
  count?: number;
}) {
  const t = useT();
  const keyCode =
    kind === "backspace" ? "Backspace" : kind === "arrowLeft" ? "ArrowLeft" : kind === "home" ? "Home" : "Shift+Home";
  const label = kind === "backspace" ? "BS" : kind === "arrowLeft" ? "←" : kind === "home" ? "Home" : "⇧Home";
  const tooltipText = keyCode.includes("+")
    ? getKeyCombinationLabel(t, keyCode)
    : getKeyLabel(t, keyCode);
  return (
    <span className="relative inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded border-2 border-info/50 bg-info/10 px-1.5 font-mono text-sm font-semibold text-info">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
      {(kind === "backspace" || kind === "arrowLeft") && (count ?? 0) > 1 && (
        // aria-hidden を付けない: スクリーンリーダーにも「BS ×2」のように回数が伝わるようにする
        <span className="absolute -top-1.5 -right-1.5 rounded-full bg-muted-foreground px-1 py-0.5 text-[9px] font-semibold leading-none text-background">
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
 * クラフト実行マーカー（ItemIcon＋Hammer の破線チップ）。
 * そのステップのサーチ文字列を ItemIcon の後ろに小さく表示する（typedCharSegments() の
 * 結果を渡すと、実際にタイプしない残存部分は薄く表示される）。
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
  const itemId = craft?.items[0];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded border border-dashed border-border bg-secondary/20 px-2">
          <Hammer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {itemId && <ItemIcon itemId={itemId} size={20} />}
          {searchStr && (
            <code className="font-mono text-sm">
              <SegmentedSearchString value={searchStr} segments={segments} />
            </code>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("playerProfile.loopCraftMarker")}</TooltipContent>
    </Tooltip>
  );
}

/** 遷移1件分のキー操作列（backspace/selectAll/home は制御キーバッジ、type は ActualKeyBadges） */
function TransitionOpsBadges({
  ops,
  remaps,
  fingerAssignments,
}: {
  ops: LoopKeyOp[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
}) {
  return (
    <>
      {ops.map((op, idx) => {
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
            return (
              <ActualKeyBadges
                key={idx}
                searchStr={op.text}
                remaps={remaps}
                fingerAssignments={fingerAssignments}
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
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((step, idx) => {
        const craft = getCraft(step.craftId);
        // 表示文字列は必ず ResolvedLoopStep（variationIndex 考慮済み）から取る。
        // getCraft の再引きは常に「そのクラフトの生データ」しか返さないため、
        // ここで craft?.searchStr のような再導出をすると variationIndex を無視した
        // 固定表示（実質バリエーション0固定）になるバグを埋め込むことになる。
        const segments = typedCharSegments(
          idx > 0 ? steps[idx - 1].searchStr : null,
          step.searchStr ?? "",
          step.transition,
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
              ) : (
                <InvalidSegmentBadge />
              )
            ) : step.derived?.valid ? (
              <TransitionOpsBadges
                ops={step.derived.ops}
                remaps={remaps}
                fingerAssignments={fingerAssignments}
              />
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
        return craft ? { searchStrs: craft.variations.map((v) => v.str) } : undefined;
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
            <span className={cn("h-2 w-2 rounded-full", timingMeta.dot)} />
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
    <div className="border-t border-border/60 pt-3">
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

/** Loop 一覧（カード形式）。loops が空なら何も描画しない */
export function SearchCraftLoopList({
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
  if (loops.length === 0) return null;
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="divide-y">
          {loops.map((loop) => (
            <SearchCraftLoopRow
              key={loop.id}
              loop={loop}
              crafts={crafts}
              remaps={remaps}
              fingerAssignments={fingerAssignments}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
