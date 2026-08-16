import type { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ItemIcon, getLocalizedItemName } from "@/components/item-icon";
import { FINGER_KEY_COLORS } from "@/components/virtual-keyboard";
import { KeyLabelText, ShiftMark } from "@/components/shift-mark";
import { getKeyLabel, getKeyCombinationLabel, type FingerType } from "@/lib/keybindings";
import {
  getActualControlKeyInfo,
  type ActualControlKeyInfo,
  type RemapDetail,
  type RemapInfo,
  type UiRemapInfo,
} from "@/lib/remap-utils";
import { useT, useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * サーチクラフトのキーバッジ系コンポーネントの葉モジュール。
 * `search-craft-template-view.tsx`（表示・実入力キー）・`search-craft-loop-view.tsx`
 * （Loop の制御キー・クラフト実行マーカー）・`search-craft-key-sequence-dialog.tsx`
 * （キー入力順ダイアログ）が共通で使う。依存は ui/tooltip・shift-mark・item-icon・
 * virtual-keyboard（FINGER_KEY_COLORS）・lib/keybindings・lib/remap-utils のみで、
 * 上記3ファイルのいずれにも依存しない（＝どこから import しても循環importにならない）。
 * `.claude/rules/ui.md`「キーバッジ」節と同じ規格。見た目を変える場合はこのファイルだけを直せばよい。
 */

// ============================================
// 半角スペース可視化・サーチ文字列表示
// ============================================

/**
 * 半角スペースの連続を「␣」（U+2423）に置き換えて可視化しつつ、テキスト片を描画する
 * （全角スペースは対象外）。可視化用の span は常に aria-hidden にする（呼び出し側で
 * 読み上げテキストを別途 aria-label 等で提供すること）。
 */
export function renderVisibleSpaces(text: string, spaceClassName: string): ReactNode[] {
  const parts = text.split(/( +)/);
  return parts.map((part, i) =>
    part.length > 0 && part[0] === " " ? (
      <span key={i} aria-hidden="true" className={spaceClassName}>
        {"␣".repeat(part.length)}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * サーチ文字列を表示する。半角スペースは視認できるよう「␣」（U+2423）に置き換えて
 * 描画する（全角スペースは対象外）。描画テキストは実データと異なるため、
 * コピー機能は必ず元の searchStr 文字列を使うこと（DOM のテキストから取らない）。
 * スクリーンリーダーには aria-label で元の文字列を提供する。
 */
export function SearchStringText({ value }: { value: string }) {
  return <span aria-label={value}>{renderVisibleSpaces(value, "text-muted-foreground/70")}</span>;
}

// ============================================
// 実入力キーのバッジ
// ============================================

/** 実入力キーのバッジ（指割り当て色・リマップring・Shift琥珀・ツールチップ付き） */
export function KeyBadge({
  keyCode,
  label,
  finger,
  isRemapped,
  needsShift,
  remapDetail,
}: {
  keyCode: string;
  label: string;
  finger?: FingerType;
  isRemapped?: boolean;
  needsShift?: boolean;
  /** リマップされている場合のツールチップ詳細（「リマップ: 物理 → 出力」表示用） */
  remapDetail?: RemapDetail;
}) {
  const t = useT();
  const fingerClass = finger ? FINGER_KEY_COLORS[finger] : "";

  // ツールチップのテキスト。物理キーボードのキー情報ツールチップ（key-info-trigger.tsx）と
  // 同じ「リマップ: 物理 → 出力」形式（フル名称。⇧ 等の短縮記号は使わない）
  const getTooltipContent = (): ReactNode => {
    if (isRemapped && remapDetail) {
      return t("playerProfile.remapped", { source: remapDetail.sourceLabel, target: remapDetail.targetLabel });
    }
    if (keyCode.includes("+")) {
      // 修飾キー組み合わせの場合
      return getKeyCombinationLabel(t, keyCode);
    }
    return getKeyLabel(t, keyCode);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center justify-center rounded border-2 font-mono font-semibold text-sm min-w-7 h-7 px-1.5",
            finger
              ? fingerClass
              : "bg-secondary/50 border-border/50 text-muted-foreground",
            isRemapped && "ring-2 ring-primary ring-offset-1 ring-offset-background",
            needsShift && !isRemapped && "border-warning/50 bg-warning/10"
          )}
        >
          <KeyLabelText label={label} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{getTooltipContent()}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 「Shiftを押しながら」入力するキー列全体を囲むラッパー。
 * 独立したバッジとして先頭に置くのではなく、先頭のコンパクトな「⇧」マーク + children
 * （実入力キーの `KeyBadge` 列など）をひとつの枠（角丸ネスト規則: 内側の `rounded` チップの
 * 1段上＝`rounded-lg`）で囲む。children を省略すると（バリエーションにサーチ文字列が無い等）
 * ラベル単独の表示になる。
 */
export function ShiftKeyGroup({ children }: { children?: ReactNode }) {
  const t = useT();
  return (
    // px-2 py-1.5: リマップ済みバッジのリング（ring-2 + ring-offset-1 ≒ 外側へ約3px）が
    // 枠に触れない余白を確保する（px-1.5 py-1 だとリングと枠の角丸が至近で並び不協和に見える）。
    // ラベルは ⇧ マークのみ（ShiftMark 内部の sr-only "Shift" と Tooltip が意味を補う）
    <span className="inline-flex flex-wrap items-center gap-1 rounded-lg border-2 border-warning/50 bg-warning/10 px-2 py-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center text-warning">
            <ShiftMark className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("playerProfile.withShiftTooltip")}</TooltipContent>
      </Tooltip>
      {children}
    </span>
  );
}

/**
 * キーコード（"Shift+KeyA" のような修飾キー込み表記を含む）から、指割り当てを検索する
 * （ベースキー＝最後のセグメントで引く。大文字小文字ゆらぎも吸収）。
 * `fingerAssignments` 未指定なら常に undefined。
 */
export function getFingerForKeyCode(
  keyCode: string,
  fingerAssignments?: Record<string, FingerType[]>,
): FingerType | undefined {
  if (!fingerAssignments) return undefined;
  const baseKeyCode = keyCode.includes("+") ? (keyCode.split("+").pop() ?? keyCode) : keyCode;
  const fingers = fingerAssignments[baseKeyCode] || fingerAssignments[baseKeyCode.toLowerCase()];
  return fingers?.[0];
}

// ============================================
// 制御キーのバッジ
// ============================================

export type ControlKeyKind = "backspace" | "arrowLeft" | "selectAll" | "home";

/** kind ごとの表示・逆引き設定を1箇所にまとめる（keyCode・バッジ短縮ラベル・逆引き対象キー） */
export const CONTROL_KEY_META: Record<
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

/** リマップなし扱いのフォールバック。ControlKeyBadge に remaps を渡さない呼び出し側
 * （search-craft-key-sequence-dialog.tsx は呼び出し時点で解決済みの info を直接渡すため使わない）用。 */
const NON_REMAPPED_CONTROL_INFO: ActualControlKeyInfo = {
  keyCode: "",
  displayLabel: "",
  tooltipLabel: "",
  isRemapped: false,
  remapDetails: [],
};

/**
 * 制御キー（Backspace / ArrowLeft / Home / Shift+Home）のバッジ本体。解決済みの
 * `ActualControlKeyInfo` を直接受け取って描画するだけで、リマップ逆引きは行わない
 * （呼び出し側で解決済みの info をそのまま渡すこと。二重解決をしない）。
 * 文字入力キー（KeyBadge、secondary系の塗り）と区別できるよう info トーンで表示する
 * （⇧ Shift バッジ=warning・クラフト実行マーカー=破線チップと同じ「役割ごとに色調を変える」規則）。
 * BS×n / ←×n はバッジを n 個並べず、右肩に ×n を併記する（モバイル幅対策）。
 *
 * info.isRemapped の場合のみ複合ピルにする —
 * **主ラベル＝実際に押すキー**（外側、既存の単一ピルと同じ text-sm・info トーン）、
 * その中に「チップの中のチップ」として**出力操作**（BS 等）をミニチップ（text-[10px]）で添える。
 * 既存のリマップ用リング（ring-2 ring-primary ring-offset-1 ring-offset-background）を付け、
 * Tooltip も主従の入れ替えに合わせた文言に差し替える。
 */
export function ControlKeyBadgeView({
  kind,
  info,
  count,
}: {
  kind: ControlKeyKind;
  info: ActualControlKeyInfo;
  /** backspace / arrowLeft のときのみ意味を持つ。2以上のときだけ右肩に ×n を表示する */
  count?: number;
}) {
  const t = useT();
  const meta = CONTROL_KEY_META[kind];

  // 操作名のフル表記（⇧ 等の短縮記号を使わない。Tooltip 専用。Shift+Home も省略しない）
  const opFullLabel = meta.keyCode.includes("+")
    ? getKeyCombinationLabel(t, meta.keyCode)
    : getKeyLabel(t, meta.keyCode);

  // 物理キーボードのキー情報ツールチップ（key-info-trigger.tsx）と同じ「リマップ: 物理 → 出力」形式。
  // 1行目は実際に押すキー（フル名称）— 操作名、2行目以降は成分ごとのリマップ詳細（⇧Home は最大2行）
  const tooltipContent = info.isRemapped ? (
    <div className="space-y-1">
      <p>{t("playerProfile.controlKeyActualTooltip", { key: info.tooltipLabel, op: opFullLabel })}</p>
      <div className="space-y-0.5 border-t border-border/40 pt-1">
        {info.remapDetails.map((detail, i) => (
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
          {info.isRemapped ? (
            // 複合ピル: 主ラベル＝実際に押すキー（既存の単一ピルと同じ text-sm）、
            // その中に「チップの中のチップ」として出力操作（BS 等）をミニチップで添える
            <span className="inline-flex h-7 items-center gap-1 rounded-full border-2 border-info/50 bg-info/10 py-0.5 pl-2.5 pr-1.5 font-mono font-semibold text-info ring-2 ring-primary ring-offset-1 ring-offset-background">
              <span className="text-sm">
                <KeyLabelText label={info.displayLabel} />
              </span>
              <span className="rounded-full border border-info/40 bg-info/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-info">
                <KeyLabelText label={meta.label} shiftClassName="size-2.5" />
              </span>
            </span>
          ) : (
            // 文字入力キー（角丸 rounded）と一目で区別できるよう、制御キーは rounded-full のピル形状にする
            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-info/50 bg-info/10 px-2.5 font-mono text-sm font-semibold text-info">
              <KeyLabelText label={meta.label} />
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

/**
 * 制御キーのバッジ（remaps から解決するラッパー）。`remaps` を渡すと、その制御キーの
 * 出力になっているリマップを逆引きする（`getActualControlKeyInfo()`）。リマップが無い場合
 * （大多数）・`remaps` 省略時は非リマップ時と完全に同一の単一ピル表示のまま
 * （描画本体は `ControlKeyBadgeView` に委譲）。
 */
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
  const meta = CONTROL_KEY_META[kind];
  const info = remaps
    ? getActualControlKeyInfo(t, meta.targetKeyCode, remaps, { shiftHeld: kind === "selectAll" })
    : NON_REMAPPED_CONTROL_INFO;
  return <ControlKeyBadgeView kind={kind} info={info} count={count} />;
}

// ============================================
// クラフト実行マーカー
// ============================================

/**
 * クラフト実行マーカー（通常のアイテムチップと同じ見た目のチップ。ItemIcon 24px＋サーチ文字列）。
 * 高さはキー系バッジ（h-7）に揃える。アイコン類（Hammer 等）は置かず、
 * 「ここでクラフトを実行する」ことの説明は Tooltip と凡例（KeyBadgeLegend）が担う。
 *
 * `content` はサーチ文字列部分の描画済み ReactNode（呼び出し側が `renderVisibleSpaces` /
 * セグメント分割表示など、用途に応じて用意する。null なら文字列を表示しない）。
 */
export function CraftMarker({
  items,
  content,
  showItemBreakdown = false,
}: {
  items: string[];
  content: ReactNode | null;
  /**
   * true の場合のみ、複数アイテム（2件以上）のときに Tooltip へアイテム名（UI ロケール依存の
   * 表示名。`getLocalizedItemName`）の内訳を追加する。省略時（false）は内訳なしの単純な
   * 「ここでクラフトを実行」表示のまま — search-craft-key-sequence-dialog.tsx（キー入力順
   * ダイアログ）はこちらの既存動作を維持する。search-craft-loop-view.tsx の LoopKeySequence は
   * true を渡す。
   */
  showItemBreakdown?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const tooltipContent =
    showItemBreakdown && items.length > 1
      ? `${t("playerProfile.loopCraftMarker")}（${items.map((id) => getLocalizedItemName(id, locale)).join(" / ")}）`
      : t("playerProfile.loopCraftMarker");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded bg-secondary/50 px-2">
          {items.map((itemId, idx) => (
            <ItemIcon key={idx} itemId={itemId} size={24} />
          ))}
          {content && <code className="font-mono text-sm">{content}</code>}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipContent}</TooltipContent>
    </Tooltip>
  );
}
