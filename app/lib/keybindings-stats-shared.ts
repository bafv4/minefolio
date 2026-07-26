// 操作設定の統計で、集計（サーバー）と描画（クライアント）の両方が参照する値。
//
// `keybindings-stats.server.ts` に置くとクライアントから値として import できない
// （React Router の `.server` モジュールはクライアントバンドルへ入れられず、
// ビルドが "Server-only module referenced by client" で失敗する）。
// 型は `import type` なら消えるので `.server` 側のままでよいが、実行時の値はここに置く。

/** F3 入力キーが未設定の行をまとめるための内部キー（表示前に翻訳へ差し替える） */
export const UNASSIGNED_INPUT_KEY = "__unassigned__";
