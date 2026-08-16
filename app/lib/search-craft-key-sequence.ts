/**
 * サーチクラフトのクラフト（バリエーション）・繋ぎ方（Loop）から、
 * 「キーを押す順番」をバーチャルキーボード上で可視化するための押下シーケンスを導出する純粋関数群。
 *
 * `app/components/search-craft-key-sequence-dialog.tsx` の唯一の入力源。`.server` にはしない
 * （app/lib/remap-utils.ts・app/lib/search-craft-loops.ts と同じ位置付け。クライアント側から
 * 直接呼ぶ）。既存の逆引きロジック（`getActualKeyInfos` / `getActualControlKeyInfo`）を
 * 再利用するだけで、リマップ解決自体はここでは行わない。
 *
 * 設計方針:
 * - 1ステップ＝1回のキー操作（既存の `KeyBadge` / `ControlKeyBadge` が表示する1バッジと対応）。
 *   BS×n / ←×n は既存バッジと同様「1ステップ + count」で表現し、n個には展開しない。
 * - 修飾キー込みの keyCode（例: "Shift+KeyA"）は、キーボード上のハイライト・順番注釈の対象を
 *   「ベースキー（最後のセグメント）」のみに絞る（`physicalKeyForStep`）。修飾キー成分は
 *   バッジのラベル・ツールチップ（既存の KeyBadge/ControlKeyBadge がそのまま担う）でのみ表現し、
 *   キーボード上には現さない。既存の `needsShift` バッジ表現（ベースキー1つの色替えバッジ）と
 *   同じ簡略化方針を踏襲する。
 * - 例外は Shift が「押しっぱなし」の意味を持つ2ケース（クラフト単位の withShift、
 *   繋ぎ方の ⇧Home の Shift 成分）。これらは番号を振らず、`KeySequence.heldKeys`
 *   （持続的な warning トーンのハイライト対象）に集約する。
 */

import type { Translator } from "@/lib/messages";
import {
  getActualKeyInfos,
  getActualControlKeyInfo,
  type ActualKeyInfo,
  type ActualControlKeyInfo,
  type RemapInfo,
  type UiRemapInfo,
} from "./remap-utils";
import type { ResolvedLoopStep } from "./search-craft-loops";

/** クラフト実行マーカー（Loop のステップ境界）の表示に使う最小限の情報 */
export type KeySequenceCraftInfo = {
  items: string[];
  /** このマーカー時点での検索文字列（参照切れ・空なら null） */
  searchStr: string | null;
};

export type KeySequenceStep =
  | { kind: "type"; order: number; info: ActualKeyInfo; heldKeys: string[] }
  | {
      kind: "backspace" | "arrowLeft" | "home" | "selectAll";
      order: number;
      info: ActualControlKeyInfo;
      /** backspace/arrowLeft のときのみ意味を持つ（home/selectAll は常に undefined） */
      count?: number;
      /**
       * このステップの間、持続的に押されている（held）修飾キー。アニメーション再生で
       * 「現在押している瞬間のキーだけ色付き」にする際、withShift/⇧Home のような
       * Shift 同時押し状態をそのステップの間だけ維持するために使う。
       * - type: withShift（クラフト/繋ぎ方遷移の Shift 押しっぱなし）または needsShift
       *   （withShift なしの単発大文字）で `[HELD_SHIFT_KEY_CODE]`、それ以外は空配列
       * - selectAll（⇧Home）: `heldKeyForSelectAllKeyCode()` で取り出した Shift 成分
       * - backspace/arrowLeft/home: 常に空配列（修飾キーを伴わない単発操作のため）
       */
      heldKeys: string[];
    }
  | {
      kind: "craft";
      order: null;
      craft: KeySequenceCraftInfo;
      /** craft マーカーはキーボード上で何も押していない扱いのため常に空配列。他の kind と
       * 同じ `heldKeys` フィールドを持たせることで、呼び出し側は分岐関数を介さず
       * `step.heldKeys` を直接参照できる（craft だけ欠けている型だと都度の分岐が要る）。 */
      heldKeys: string[];
    };

/** バーチャルキーボードで可視化する押下シーケンス全体 */
export type KeySequence = {
  steps: KeySequenceStep[];
  /**
   * シーケンス全体を通して「押しっぱなし」の持続表現（warning トーン）で示す物理キー
   * （Shiftを押しながらクラフトする withShift・⇧Home の Shift 成分）。番号は振らない。
   */
  heldKeys: string[];
};

/** Shift を「押しっぱなし」表現する際の代表物理キー。
 * 既存の `ShiftKeyGroup`（search-craft-template-view.tsx）も左右を区別せず「⇧」1つで
 * 表現しているのと同じ簡略化方針で、常に ShiftLeft を使う（リマップによる実キー解決はしない）。 */
const HELD_SHIFT_KEY_CODE = "ShiftLeft";

const CONTROL_TARGET_KEY_CODE: Record<"backspace" | "arrowLeft" | "home", string> = {
  backspace: "Backspace",
  arrowLeft: "ArrowLeft",
  home: "Home",
};

/**
 * キーコード（"Shift+KeyA" のような修飾キー込み表記を含む）から、キーボード上でハイライト・
 * 注釈すべき物理キーを取り出す（最後のセグメント＝ベースキー）。修飾キー成分は対象外
 * （バッジのラベル・ツールチップでのみ表現する）。craft マーカーは対象キーを持たないため null。
 */
export function physicalKeyForStep(step: KeySequenceStep): string | null {
  if (step.kind === "craft") return null;
  const keyCode = step.info.keyCode;
  const idx = keyCode.lastIndexOf("+");
  return idx === -1 ? keyCode : keyCode.slice(idx + 1);
}

/**
 * ⇧Home（selectAll）ステップの Shift 成分（"押しっぱなし" 表現の対象）を、実キーコード
 * （"ShiftLeft+Home" のような組み合わせ）から取り出す。修飾キーを伴わない場合は null。
 */
function heldKeyForSelectAllKeyCode(keyCode: string): string | null {
  const idx = keyCode.lastIndexOf("+");
  return idx === -1 ? null : keyCode.slice(0, idx);
}

/**
 * type ステップ（`buildCraftKeySequence`/`buildLoopKeySequence` の `pushType` 共通）の
 * ステップ単位 `heldKeys` を判定する。`getActualKeyInfos` の shiftHeld 仕様により、
 * withShift 時は個々のキーの `needsShift` は常に false になるため、
 * 「withShift か、その文字単体が needsShift（withShift なしの単発大文字）か」の
 * 2条件で排他的に判定できる。
 */
function typeStepHeldKeys(withShift: boolean, info: ActualKeyInfo): string[] {
  return withShift || info.needsShift ? [HELD_SHIFT_KEY_CODE] : [];
}

/**
 * 単一クラフト（バリエーション）の検索文字列から押下シーケンスを導出する。
 * `withShift` が true の場合、個々のキーには ⇧ を付けず（`getActualKeyInfos` の shiftHeld
 * 仕様どおり）、Shift 自体は `heldKeys`（持続的な held 表現）に集約する。
 */
export function buildCraftKeySequence(
  t: Translator,
  searchStr: string,
  remaps: RemapInfo[] | UiRemapInfo[],
  withShift: boolean,
): KeySequence {
  const infos = getActualKeyInfos(t, searchStr, remaps, { shiftHeld: withShift });
  const steps: KeySequenceStep[] = infos.map((info, idx) => ({
    kind: "type",
    order: idx + 1,
    info,
    heldKeys: typeStepHeldKeys(withShift, info),
  }));
  return { steps, heldKeys: withShift && infos.length > 0 ? [HELD_SHIFT_KEY_CODE] : [] };
}

/**
 * 繋ぎ方（Loop）の参照解決済みステップ列（`resolveLoopSteps()` の戻り値）から押下シーケンスを
 * 導出する。先頭ステップは自身の検索文字列をそのまま打鍵するシーケンス、以降は
 * `step.derived.ops`（`deriveTransition()` の結果）をそのまま押下操作へ変換する。
 * 各ステップの終わりにクラフト実行マーカー（order: null）を挿入する
 * （`LoopKeySequence` と同じ「打鍵 → クラフト実行 → 次の打鍵」の流れ）。
 * 遷移が無効（`derived.valid === false`）なステップは、そのステップの打鍵操作を生成しない
 * （クラフトマーカー自体は引き続き挿入する）。
 */
export function buildLoopKeySequence(
  t: Translator,
  resolvedSteps: ResolvedLoopStep[],
  getCraft: (craftId: string) => { items: string[] } | undefined,
  remaps: RemapInfo[] | UiRemapInfo[],
): KeySequence {
  const steps: KeySequenceStep[] = [];
  const heldKeys = new Set<string>();
  let order = 0;

  const pushType = (searchStr: string, withShift: boolean) => {
    const infos = getActualKeyInfos(t, searchStr, remaps, { shiftHeld: withShift });
    for (const info of infos) {
      order += 1;
      steps.push({ kind: "type", order, info, heldKeys: typeStepHeldKeys(withShift, info) });
    }
    if (withShift && infos.length > 0) heldKeys.add(HELD_SHIFT_KEY_CODE);
  };

  const pushControl = (kind: "backspace" | "arrowLeft" | "home", count?: number) => {
    order += 1;
    const info = getActualControlKeyInfo(t, CONTROL_TARGET_KEY_CODE[kind], remaps);
    steps.push({ kind, order, info, count, heldKeys: [] });
  };

  const pushSelectAll = () => {
    order += 1;
    const info = getActualControlKeyInfo(t, "Home", remaps, { shiftHeld: true });
    const heldKey = heldKeyForSelectAllKeyCode(info.keyCode);
    steps.push({ kind: "selectAll", order, info, heldKeys: heldKey ? [heldKey] : [] });
    if (heldKey) heldKeys.add(heldKey);
  };

  const pushCraftMarker = (craftId: string, searchStr: string | null) => {
    const craft = getCraft(craftId);
    steps.push({ kind: "craft", order: null, craft: { items: craft?.items ?? [], searchStr }, heldKeys: [] });
  };

  resolvedSteps.forEach((step, idx) => {
    if (idx === 0) {
      if (step.searchStr) pushType(step.searchStr, step.withShift);
      pushCraftMarker(step.craftId, step.searchStr);
      return;
    }
    if (step.derived?.valid) {
      for (const op of step.derived.ops) {
        switch (op.kind) {
          case "backspace":
            pushControl("backspace", op.count);
            break;
          case "arrowLeft":
            pushControl("arrowLeft", op.count);
            break;
          case "selectAll":
            pushSelectAll();
            break;
          case "home":
            pushControl("home");
            break;
          case "type":
            pushType(op.text, step.withShift);
            break;
        }
      }
    }
    pushCraftMarker(step.craftId, step.searchStr);
  });

  return { steps, heldKeys: Array.from(heldKeys) };
}

/** アニメーション再生時、1ステップあたりの基本待機時間（ms）。速度1×・craft 以外のステップ基準 */
export const ANIMATION_BASE_STEP_MS = 600;

/** craft ステップ（クラフト実行マーカー）が基本間隔の何倍の時間を取るか
 * （「アイテムを選んでクラフトする」という時間的な区切りを伝えるため、通常のキーステップより長く取る）。 */
export const ANIMATION_CRAFT_STEP_MULTIPLIER = 2;

/** アニメーション再生速度（スライダーで選択。範囲・刻み幅・既定値） */
export const PLAYBACK_SPEED_MIN = 0.5;
export const PLAYBACK_SPEED_MAX = 2;
export const PLAYBACK_SPEED_STEP = 0.25;
export const PLAYBACK_SPEED_DEFAULT = 1;

/**
 * アニメーション再生時、指定ステップを表示し続ける時間（ms）を返す純粋関数。
 * craft（クラフト実行マーカー）ステップは `ANIMATION_CRAFT_STEP_MULTIPLIER` 倍長く取る。
 * `speed` は再生速度の倍率（`PLAYBACK_SPEED_MIN`〜`PLAYBACK_SPEED_MAX` の範囲の数値。
 * 大きいほど速い＝待機時間は短くなる）。
 */
export function stepDurationMs(step: KeySequenceStep, speed: number): number {
  const base =
    step.kind === "craft" ? ANIMATION_BASE_STEP_MS * ANIMATION_CRAFT_STEP_MULTIPLIER : ANIMATION_BASE_STEP_MS;
  return base / speed;
}

/**
 * 静止表示用: 物理キーコード → 押す順番の注釈文字列（"1" または "1,4" のようなカンマ区切り）の
 * マップを構築する。`heldKeys` に含まれるキー（Shift 押しっぱなし成分）は対象外
 * （持続表現を優先し、番号は振らない）。`VirtualKeyboard` の `keyAnnotations` にそのまま渡せる。
 */
export function buildKeyAnnotations(sequence: KeySequence): Record<string, string> {
  const orders = new Map<string, number[]>();
  for (const step of sequence.steps) {
    if (step.order === null) continue;
    const keyCode = physicalKeyForStep(step);
    if (!keyCode || sequence.heldKeys.includes(keyCode)) continue;
    const list = orders.get(keyCode);
    if (list) {
      list.push(step.order);
    } else {
      orders.set(keyCode, [step.order]);
    }
  }
  const result: Record<string, string> = {};
  for (const [keyCode, list] of orders) {
    result[keyCode] = list.join(",");
  }
  return result;
}
