// DB 接続先 URL の種別判定。ローカル/リモート分離運用（docs/local-development.md）の単一判定点。
// アプリ本体（/dev/login ゲート）・一回限りスクリプト（scripts/lib/db-env.ts）・
// drizzle 設定（drizzle.config.ts / drizzle.remote.config.ts）のすべてがこれを参照する。
// 「ローカル」の形が増える場合（:memory:、turso dev の http://127.0.0.1 等）はここだけ直す。

/** ローカル DB（SQLite ファイル）を指す URL か。リモート（libsql:// 等）は false */
export function isLocalDbUrl(url: string): boolean {
  return url.startsWith("file:");
}
