import { Fragment, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ItemIcon } from "@/components/item-icon";
import {
  KeyBadge,
  ActualKeyBadges,
  SearchStringText,
  TIMING_META,
  timingLabel,
} from "@/components/search-craft-template-view";
import {
  resolveLoopSteps,
  type LoopStepData,
  type LoopKeyOp,
  type ResolvedLoopStep,
} from "@/lib/search-craft-loops";
import type { UiRemapInfo, RemapInfo } from "@/lib/remap-utils";
import type { FingerType } from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { AlertTriangle, ChevronRight, Hammer } from "lucide-react";

/**
 * サーチクラフトの「繋ぎ方（Loop）」表示コンポーネント群。
 * プレイヤープロフィールのサーチクラフトタブ・テンプレート詳細ページ・
 * /me/search-craft・Playground（編集プレビュー経由）で共用する。
 */

/** Loop の参照解決に必要な最小限のクラフト情報（表示用） */
export type LoopCraftInfo = {
  id: string;
  items: string[];
  searchStr: string | null;
};

/** 表示用の Loop 行データ */
export type SearchCraftLoopRowData = {
  id: string;
  steps: LoopStepData[];
  comment: string | null;
  timing: string | null;
};

// ============================================
// 制御キーバッジ
// ============================================

/**
 * 制御キー（Backspace / ArrowLeft / Home / Shift+Home）のバッジ。
 * getActualKeyInfos は文字列専用のため KeyBadge を直接再利用する。
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
  const keyCode =
    kind === "backspace" ? "Backspace" : kind === "arrowLeft" ? "ArrowLeft" : kind === "home" ? "Home" : "Shift+Home";
  const label = kind === "backspace" ? "BS" : kind === "arrowLeft" ? "←" : kind === "home" ? "Home" : "⇧Home";
  return (
    <span className="relative inline-flex">
      <KeyBadge keyCode={keyCode} label={label} />
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

/** クラフト実行マーカー（ItemIcon＋Hammer の破線チップ） */
function CraftMarker({ craft }: { craft: LoopCraftInfo | undefined }) {
  const t = useT();
  const itemId = craft?.items[0];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-dashed border-border bg-secondary/20 px-1.5">
          <Hammer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {itemId && <ItemIcon itemId={itemId} size={18} />}
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
        return (
          <Fragment key={idx}>
            {idx === 0 ? (
              craft?.searchStr ? (
                <ActualKeyBadges
                  searchStr={craft.searchStr}
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
            <CraftMarker craft={craft} />
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

/** Loop 1件分の行（サマリー＋キー操作列＋コメント） */
export function SearchCraftLoopRow({
  loop,
  crafts,
  remaps,
  fingerAssignments,
}: {
  loop: SearchCraftLoopRowData;
  crafts: LoopCraftInfo[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
}) {
  const t = useT();
  const craftsById = useMemo(() => new Map(crafts.map((c) => [c.id, c])), [crafts]);
  const resolved = useMemo(
    () =>
      resolveLoopSteps(loop.steps, (id) => {
        const craft = craftsById.get(id);
        return craft ? { searchStr: craft.searchStr } : undefined;
      }),
    [loop.steps, craftsById],
  );
  const timingMeta = loop.timing ? TIMING_META.find((m) => m.id === loop.timing) : undefined;

  return (
    <div className="py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!resolved.valid && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("playerProfile.loopInvalidTransition")}</TooltipContent>
          </Tooltip>
        )}

        {/* ステップ連鎖サマリー */}
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {resolved.steps.map((step, idx) => {
            const craft = craftsById.get(step.craftId);
            return (
              <Fragment key={idx}>
                <span className="inline-flex items-center gap-1 rounded bg-secondary/50 px-1.5 py-0.5">
                  {craft?.items[0] && <ItemIcon itemId={craft.items[0]} size={18} />}
                  <code className="font-mono text-xs">
                    {craft?.searchStr ? <SearchStringText value={craft.searchStr} /> : "—"}
                  </code>
                </span>
                {idx < resolved.steps.length - 1 && (
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </Fragment>
            );
          })}
        </div>

        {timingMeta && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", timingMeta.dot)} />
            {timingLabel(t, timingMeta)}
          </span>
        )}

        <Badge variant="secondary" className="ml-auto shrink-0 text-xs sm:ml-0">
          {t("playerProfile.loopStepCount", { count: loop.steps.length })}
        </Badge>
      </div>

      <LoopKeySequence
        steps={resolved.steps}
        getCraft={(id) => craftsById.get(id)}
        remaps={remaps}
        fingerAssignments={fingerAssignments}
      />

      {loop.comment && <p className="text-sm text-muted-foreground">{loop.comment}</p>}
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
