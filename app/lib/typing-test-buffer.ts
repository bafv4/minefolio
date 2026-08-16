import type { SimulatedKeyOutput } from "./remap-utils";

/**
 * Playground タイピングテスト（`search-craft-workbench.tsx` の `TypingTestArea`）の
 * バッファ編集ロジック。React 状態から分離した純粋関数（reducer 形式）にして、
 * ユニットテストしやすくしてある。
 *
 * 「テキスト＋カーソル位置＋選択範囲」を1つの状態として持ち、Minecraft のサーチ欄の操作
 * （文字入力・Backspace・ArrowLeft・Home・Shift+Home=先頭からカーソル位置までを全選択して
 * 打ち直す）を適用する。対応する操作の意味は `app/lib/search-craft-loops.ts` の
 * `LOOP_TRANSITION_TYPES`（backspace/arrowLeft/selectAll/home）と揃えてある。
 *
 * 選択範囲（selection）は常に `{ start: 0, end: <selectAll 実行時のカーソル位置> }` になる
 * （このモデルでは「先頭から現在位置まで」以外の選択は発生しない。カーソルが末尾なら
 * 結果として全選択になる）。ArrowRight / End / Delete に対応する操作は無い
 * （アプリの遷移モデルに存在しないため）。
 */

export type TypingTestSelection = { start: number; end: number };

export type TypingTestBufferState = {
  text: string;
  cursor: number;
  /** null = 選択なし。選択中は cursor ではなくこちらが表示・編集の基準になる */
  selection: TypingTestSelection | null;
};

export const INITIAL_TYPING_TEST_BUFFER_STATE: TypingTestBufferState = {
  text: "",
  cursor: 0,
  selection: null,
};

export type TypingTestBufferAction =
  | { type: "insert"; text: string }
  | { type: "backspace" }
  | { type: "arrowLeft" }
  | { type: "home" }
  | { type: "selectAll" }
  | { type: "clear" };

/**
 * バッファへの操作適用（reducer）。選択中（`state.selection !== null`）の挙動:
 * - insert: 選択範囲を削除してから挿入する（上書き）
 * - backspace: 選択範囲を削除する
 * - arrowLeft / home: 選択解除してカーソルを移動する（selection.start は常に 0 のため
 *   どちらも同じ結果＝先頭へのカーソル移動になる）
 * - selectAll: 既存の選択があればその end を維持したまま（冪等）、無ければ現在のカーソル
 *   位置を end として `{ start: 0, end }` を選択する
 *
 * 非選択中は通常のカーソル位置への挿入・削除・移動（cursor は 0 未満にならない）。
 */
export function applyTypingTestAction(
  state: TypingTestBufferState,
  action: TypingTestBufferAction,
): TypingTestBufferState {
  switch (action.type) {
    case "insert": {
      if (action.text === "") return state;
      const [start, end] = state.selection
        ? [state.selection.start, state.selection.end]
        : [state.cursor, state.cursor];
      const text = state.text.slice(0, start) + action.text + state.text.slice(end);
      return { text, cursor: start + action.text.length, selection: null };
    }
    case "backspace": {
      if (state.selection) {
        const { start, end } = state.selection;
        return {
          text: state.text.slice(0, start) + state.text.slice(end),
          cursor: start,
          selection: null,
        };
      }
      if (state.cursor === 0) return state;
      const text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
      return { text, cursor: state.cursor - 1, selection: null };
    }
    case "arrowLeft": {
      if (state.selection) {
        return { ...state, cursor: state.selection.start, selection: null };
      }
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    }
    case "home": {
      return { ...state, cursor: 0, selection: null };
    }
    case "selectAll": {
      const end = state.selection ? state.selection.end : state.cursor;
      // カーソルが先頭のときは選択する範囲がない（空選択を作ると表示側の
      // カーソル描画が選択ブランチに切り替わってカーソルが消えるため作らない）
      if (end === 0) return { ...state, selection: null };
      return { ...state, selection: { start: 0, end } };
    }
    case "clear": {
      return INITIAL_TYPING_TEST_BUFFER_STATE;
    }
    default:
      return state;
  }
}

/**
 * `simulateRemapOutput()` の結果をバッファ操作へ分類する（chat 文脈専用）。
 *
 * `outputKeyCode` による制御キー判定（Backspace/ArrowLeft/Home）を最優先する。
 * `simulateRemapOutput()` は物理修飾キーの有無に関わらず `outputKeyCode` を
 * 正規化済みキーコードで返す（例: 物理 `Shift+Home`、リマップで Home に解決される
 * キー、Shift を押しながらリマップで Home に解決されるキーのいずれも `"Home"`）。
 * そのため Home と Shift+Home（全選択）の区別は `outputKeyCode` だけでは付かず、
 * 呼び出し側がそのキー入力の瞬間に Shift が押されていたか（`shiftHeld`。物理
 * `e.shiftKey` をそのまま渡せばよい）を別途渡す必要がある。
 *
 * ArrowRight / End / Delete 等、対応しない制御キーや無効化されたキーは null（無操作）。
 */
export function classifyTypingTestKey(
  result: Pick<SimulatedKeyOutput, "output" | "outputKeyCode">,
  shiftHeld: boolean,
): TypingTestBufferAction | null {
  if (result.outputKeyCode === "Backspace") return { type: "backspace" };
  if (result.outputKeyCode === "ArrowLeft") return { type: "arrowLeft" };
  if (result.outputKeyCode === "Home") {
    return shiftHeld ? { type: "selectAll" } : { type: "home" };
  }
  if (result.output) return { type: "insert", text: result.output };
  return null;
}
