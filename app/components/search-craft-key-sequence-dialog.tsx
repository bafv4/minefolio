import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Keyboard, Pause, Play, Repeat, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { VirtualKeyboard, type FingerAssignment } from "@/components/virtual-keyboard";
import {
  renderVisibleSpaces,
  KeyBadge,
  ControlKeyBadgeView,
  CraftMarker,
  getFingerForKeyCode,
} from "@/components/search-craft-badges";
import type { KeyboardLayout } from "@/lib/keybindings";
import type { RemapInfo, UiRemapInfo } from "@/lib/remap-utils";
import {
  buildCraftKeySequence,
  buildLoopKeySequence,
  buildKeyAnnotations,
  physicalKeyForStep,
  stepDurationMs,
  PLAYBACK_SPEED_MIN,
  PLAYBACK_SPEED_MAX,
  PLAYBACK_SPEED_STEP,
  PLAYBACK_SPEED_DEFAULT,
  type KeySequence,
  type KeySequenceStep,
} from "@/lib/search-craft-key-sequence";
import type { ResolvedLoopStep } from "@/lib/search-craft-loops";
import { useT } from "@/hooks/use-locale";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * サーチクラフトの各クラフト（バリエーション）・繋ぎ方（Loop）の「キーを押す順番」を
 * バーチャルキーボード上で可視化するモーダル。表示ビュー（プロフィール・テンプレート詳細・
 * /me）・編集UI（/me/search-craft・Playground・テンプレートエディタ）の両方から
 * `CraftKeySequenceButton` / `LoopKeySequenceButton` として呼ぶ（トリガーボタン+ダイアログを
 * 1コンポーネントに束ねる。app/components/keybindings/keyboard-export-dialog.tsx と同じ構成）。
 *
 * 下部シーケンス表示のバッジ（`SequenceStepBadge`）は `app/components/search-craft-badges.tsx`
 * の葉モジュール（`KeyBadge` / `ControlKeyBadgeView` / `CraftMarker`）をそのまま使う。
 * これらは循環import回避のため `search-craft-template-view.tsx` / `search-craft-loop-view.tsx`
 * のどちらにも依存していない（本ファイルは逆にそれらから import される側）ため、
 * このファイルからも安全に import できる。
 */

const EMPTY_SEQUENCE: KeySequence = { steps: [], heldKeys: [] };

type SequenceDisplayMode = "static" | "animate";

// ============================================
// 下部シーケンス表示（キーバッジ列）
// ============================================

function SequenceStepBadge({
  step,
  fingerAssignments,
  isCurrent,
}: {
  step: KeySequenceStep;
  fingerAssignments?: FingerAssignment;
  isCurrent: boolean;
}) {
  let badge: ReactNode;
  switch (step.kind) {
    case "type":
      badge = (
        <KeyBadge
          keyCode={step.info.keyCode}
          label={step.info.displayLabel}
          finger={getFingerForKeyCode(step.info.keyCode, fingerAssignments)}
          isRemapped={step.info.isRemapped}
          needsShift={step.info.needsShift}
          remapDetail={step.info.remapDetail}
        />
      );
      break;
    case "backspace":
    case "arrowLeft":
    case "home":
    case "selectAll":
      badge = <ControlKeyBadgeView kind={step.kind} info={step.info} count={step.count} />;
      break;
    case "craft":
      badge = (
        <CraftMarker
          items={step.craft.items}
          content={
            step.craft.searchStr ? renderVisibleSpaces(step.craft.searchStr, "text-muted-foreground/70") : null
          }
        />
      );
      break;
  }

  return (
    <span className="relative inline-flex items-center">
      {/* 押す順番（craft マーカーは持たない） */}
      {step.order !== null && (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -left-1.5 z-10 min-w-4 rounded-full bg-primary px-1 py-0.5 text-center text-[10px] font-semibold leading-none text-primary-foreground"
        >
          {step.order}
        </span>
      )}
      <span
        className={cn(
          "rounded-md transition-shadow",
          isCurrent && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        {badge}
      </span>
    </span>
  );
}

// ============================================
// ダイアログ本体（静止 / アニメーション表示の切替・再生制御）
// ============================================

function KeySequencePlayer({
  sequence,
  layout,
  remaps,
  fingerAssignments,
}: {
  sequence: KeySequence;
  /** 未指定時は VirtualKeyboard 自身の既定値（"US"）にフォールバックする */
  layout?: KeyboardLayout;
  remaps: RemapInfo[] | UiRemapInfo[];
  fingerAssignments?: FingerAssignment;
}) {
  const t = useT();
  // prefers-reduced-motion 環境ではアニメーション表示自体を無効化する（静止表示は常に利用可能）
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [mode, setMode] = useState<SequenceDisplayMode>("static");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(PLAYBACK_SPEED_DEFAULT);

  const totalSteps = sequence.steps.length;

  // 再生中はステップごとの持続時間（stepDurationMs。craft は基本間隔の2倍）だけ待って1ステップ進める
  // setInterval ではなく setTimeout の連鎖にしているのは、ステップごとに待機時間が変わるため。
  // 末尾に達したら loop が ON なら先頭へ巻き戻して継続、OFF なら停止する（ハイライトは最後のまま残す）。
  // このコンポーネントは Radix Dialog が閉じるとアンマウントされる（sequence が変わっても
  // 状態を明示的にリセットする useEffect は不要 — 再度開いたときは useState の初期値から始まる）。
  // currentIndex >= totalSteps のガードのみ、シーケンス差し替わりへの防御として残す
  // （sequence.steps[currentIndex] を undefined のまま stepDurationMs に渡さないため）
  useEffect(() => {
    if (!playing || totalSteps === 0) return;
    if (currentIndex < 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= totalSteps) return;
    const duration = stepDurationMs(sequence.steps[currentIndex], speed);
    const timer = setTimeout(() => {
      setCurrentIndex((prev) => {
        const next = prev + 1;
        if (next >= totalSteps) {
          if (loop) return 0;
          setPlaying(false);
          return prev;
        }
        return next;
      });
    }, duration);
    return () => clearTimeout(timer);
  }, [playing, currentIndex, totalSteps, speed, loop, sequence]);

  const handleModeChange = (next: SequenceDisplayMode) => {
    setMode(next);
    setPlaying(false);
    if (next === "static") setCurrentIndex(-1);
  };

  const handlePlayPause = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (currentIndex >= totalSteps - 1) setCurrentIndex(0);
    setPlaying(true);
  };

  const handleReset = () => {
    setPlaying(false);
    setCurrentIndex(-1);
  };

  const annotations = useMemo(() => buildKeyAnnotations(sequence), [sequence]);
  // 静止表示用: 押すキー（シーケンス中の全物理キー + 押しっぱなしの Shift 成分）以外はグレーで
  // 減光する。アニメーション未再生時（currentIndex === -1）もこの全体強調にフォールバックする
  const staticEmphasizedKeys = useMemo(() => {
    const keys = new Set(sequence.heldKeys);
    for (const step of sequence.steps) {
      const key = physicalKeyForStep(step);
      if (key) keys.add(key);
    }
    return Array.from(keys);
  }, [sequence]);
  const currentStep = mode === "animate" && currentIndex >= 0 ? sequence.steps[currentIndex] : null;

  // キーボード表示用の派生値（heldKeys/emphasizedKeys/highlightedKeys）をまとめて1つの useMemo
  // で計算する。再生位置が有効なとき（currentStep がある）だけ「現在押している瞬間のキーだけ
  // 色付き」表現に切り替える: 現在ステップの物理キー（physicalKeyForStep。1回だけ計算し
  // held/highlighted の両方に使い回す）＋そのステップの heldKeys（withShift/needsShift/⇧Home
  // の Shift 成分）を強調対象にし、それ以外は全部グレーにする。craft ステップ中は物理キーを
  // 持たないため highlightedKeys は空（＝全キーグレー）になる。静止モード、およびアニメモード
  // でも未再生（currentIndex === -1）のときは全体強調のまま（staticEmphasizedKeys）
  const { keyboardHeldKeys, keyboardEmphasizedKeys, highlightedKeys } = useMemo(() => {
    if (!currentStep) {
      return {
        keyboardHeldKeys: sequence.heldKeys,
        keyboardEmphasizedKeys: staticEmphasizedKeys,
        highlightedKeys: [] as string[],
      };
    }
    const heldKeys = currentStep.heldKeys;
    const physicalKey = physicalKeyForStep(currentStep);
    const emphasizedKeys = new Set(heldKeys);
    if (physicalKey) emphasizedKeys.add(physicalKey);
    return {
      keyboardHeldKeys: heldKeys,
      keyboardEmphasizedKeys: Array.from(emphasizedKeys),
      highlightedKeys: physicalKey ? [physicalKey] : [],
    };
  }, [currentStep, sequence.heldKeys, staticEmphasizedKeys]);

  return (
    // ダイアログ内でスクロールするのはキーボードビューのラッパ（min-h-0 overflow-auto）のみ。
    // それ以外（モード切替・シーケンスバッジ列）は shrink-0 で常に全体を表示する
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label={t("searchCraftKeySequence.modeLabel")}
          className="flex rounded-lg border bg-card p-0.5 gap-0.5"
        >
          <button
            type="button"
            aria-pressed={mode === "static"}
            onClick={() => handleModeChange("static")}
            className={cn(
              "flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "static"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("searchCraftKeySequence.modeStatic")}
          </button>
          <button
            type="button"
            aria-pressed={mode === "animate"}
            disabled={prefersReducedMotion}
            onClick={() => handleModeChange("animate")}
            className={cn(
              "flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
              mode === "animate"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("searchCraftKeySequence.modeAnimate")}
          </button>
        </div>

        {mode === "animate" && (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant={loop ? "secondary" : "outline"}
              size="icon-sm"
              onClick={() => setLoop((prev) => !prev)}
              disabled={totalSteps === 0}
              aria-pressed={loop}
              aria-label={t("searchCraftKeySequence.loop")}
            >
              <Repeat className="size-4" />
            </Button>
            <div role="group" aria-label={t("searchCraftKeySequence.speedLabel")} className="flex items-center gap-2">
              <Slider
                className="w-28"
                min={PLAYBACK_SPEED_MIN}
                max={PLAYBACK_SPEED_MAX}
                step={PLAYBACK_SPEED_STEP}
                value={[speed]}
                onValueChange={([value]) => setSpeed(value)}
                disabled={totalSteps === 0}
              />
              <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">{speed}×</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={handlePlayPause}
              disabled={totalSteps === 0}
              aria-label={playing ? t("searchCraftKeySequence.pause") : t("searchCraftKeySequence.play")}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleReset}
              disabled={currentIndex < 0}
              aria-label={t("searchCraftKeySequence.reset")}
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="custom-scrollbar min-h-0 overflow-auto pb-2">
        <VirtualKeyboard
          layout={layout}
          remaps={remaps}
          showRemaps={remaps.length > 0}
          fingerAssignments={fingerAssignments}
          showFingerAssignments={!!fingerAssignments}
          hideNumpad
          heldKeys={keyboardHeldKeys}
          keyAnnotations={mode === "static" ? annotations : undefined}
          emphasizedKeys={keyboardEmphasizedKeys}
          highlightedKeys={highlightedKeys}
        />
      </div>

      {totalSteps > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {sequence.steps.map((step, idx) => (
            <Fragment key={idx}>
              <SequenceStepBadge
                step={step}
                fingerAssignments={fingerAssignments}
                isCurrent={mode === "animate" && idx === currentIndex}
              />
              {/* Loop のクラフト間の矢印（LoopKeySequence と同じ区切り表現） */}
              {step.kind === "craft" && idx < sequence.steps.length - 1 && (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
            </Fragment>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("searchCraftKeySequence.empty")}</p>
      )}
    </div>
  );
}

// ============================================
// トリガー + ダイアログ（クラフト用 / Loop 用）
// ============================================

function TriggerButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground", className)}
          onClick={onClick}
        >
          <Keyboard className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("searchCraftKeySequence.triggerLabel")}</TooltipContent>
    </Tooltip>
  );
}

/**
 * トリガーボタン＋ダイアログの共通外殻（クラフト用/Loop用で丸コピーだった約40行を集約）。
 * `sequence`（`buildCraftKeySequence`/`buildLoopKeySequence` の結果）と `open`/`onOpenChange`
 * は各ボタン側が持つ（`sequence` の useMemo をここに引き取ると、buildSequence をコールバックで
 * 渡す形になり毎レンダー新関数で memo が壊れるため、ボタン側に残す）。
 */
function KeySequenceDialogShell({
  open,
  onOpenChange,
  sequence,
  layout,
  remaps,
  fingerAssignments,
  triggerClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sequence: KeySequence;
  /** 未指定時は VirtualKeyboard 自身の既定値（"US"）にフォールバックする */
  layout?: KeyboardLayout;
  remaps: RemapInfo[] | UiRemapInfo[];
  fingerAssignments?: FingerAssignment;
  triggerClassName?: string;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TriggerButton onClick={() => onOpenChange(true)} className={triggerClassName} />
      {/* スクロールはキーボードビューのエリア（KeySequencePlayer 内の overflow-auto ラッパ）だけに
          閉じ、ダイアログ全体では発生させない（grid 基底を flex 縦積みに上書きして min-h-0 を効かせる） */}
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("searchCraftKeySequence.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("searchCraftKeySequence.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <KeySequencePlayer
          sequence={sequence}
          layout={layout}
          remaps={remaps}
          fingerAssignments={fingerAssignments}
        />
      </DialogContent>
    </Dialog>
  );
}

/** 単一クラフト（バリエーション）のキー押下順を可視化するトリガー+ダイアログ */
export function CraftKeySequenceButton({
  searchStr,
  withShift,
  remaps,
  layout,
  fingerAssignments,
  className,
}: {
  searchStr: string;
  withShift: boolean;
  remaps: RemapInfo[] | UiRemapInfo[];
  /** 未指定時は VirtualKeyboard 自身の既定値（"US"）にフォールバックする */
  layout?: KeyboardLayout;
  fingerAssignments?: FingerAssignment;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // ダイアログを開いたときだけ導出する（多数のクラフト行が並ぶ一覧で、初期描画時に
  // 全行分の逆引きを走らせないようにする）
  const sequence = useMemo(
    () => (open ? buildCraftKeySequence(t, searchStr, remaps, withShift) : EMPTY_SEQUENCE),
    [open, t, searchStr, remaps, withShift],
  );

  return (
    <KeySequenceDialogShell
      open={open}
      onOpenChange={setOpen}
      sequence={sequence}
      layout={layout}
      remaps={remaps}
      fingerAssignments={fingerAssignments}
      triggerClassName={className}
    />
  );
}

/** 繋ぎ方（Loop）1件分のキー押下順を可視化するトリガー+ダイアログ */
export function LoopKeySequenceButton({
  steps,
  getCraft,
  remaps,
  layout,
  fingerAssignments,
  className,
}: {
  steps: ResolvedLoopStep[];
  getCraft: (craftId: string) => { items: string[] } | undefined;
  remaps: RemapInfo[] | UiRemapInfo[];
  /** 未指定時は VirtualKeyboard 自身の既定値（"US"）にフォールバックする */
  layout?: KeyboardLayout;
  fingerAssignments?: FingerAssignment;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const sequence = useMemo(
    () => (open ? buildLoopKeySequence(t, steps, getCraft, remaps) : EMPTY_SEQUENCE),
    [open, t, steps, getCraft, remaps],
  );

  return (
    <KeySequenceDialogShell
      open={open}
      onOpenChange={setOpen}
      sequence={sequence}
      layout={layout}
      remaps={remaps}
      fingerAssignments={fingerAssignments}
      triggerClassName={className}
    />
  );
}
