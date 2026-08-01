// 操作設定の統計で、集計（サーバー）と描画（クライアント）の両方が参照する値。
//
// `keybindings-stats.server.ts` に置くとクライアントから値として import できない
// （React Router の `.server` モジュールはクライアントバンドルへ入れられず、
// ビルドが "Server-only module referenced by client" で失敗する）。
// 型は `import type` なら消えるので `.server` 側のままでよいが、実行時の値はここに置く。

import { SENSITIVITY_PERCENT_MAX } from "./mouse-settings";

/** F3 入力キーが未設定の行をまとめるための内部キー（表示前に翻訳へ差し替える） */
export const UNASSIGNED_INPUT_KEY = "__unassigned__";

/**
 * ゲーム内感度の分布区分（表示% 基準・両端とも閉端）。
 * /keybindings の統計タブ（keybindings-stats.server.ts）と /stats（stats.tsx）の
 * 双方がここから区分を組み立てる（ラベルは各消費側でロケールに合わせて生成する）。
 */
export const SENSITIVITY_PERCENT_BINS: { min: number; max: number }[] = [
  { min: 0, max: 19 },
  { min: 20, max: 39 },
  { min: 40, max: 59 },
  { min: 60, max: 79 },
  { min: 80, max: 99 },
  { min: 100, max: 119 },
  { min: 120, max: 139 },
  { min: 140, max: 159 },
  { min: 160, max: 179 },
  { min: 180, max: SENSITIVITY_PERCENT_MAX },
];
