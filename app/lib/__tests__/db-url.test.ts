import { describe, it, expect } from "vitest";
import { isLocalDbUrl } from "../db-url";

// 接続先分離運用（.env は常に file:local.db 固定）のガード判定点。
// リモート URL を誤ってローカル扱いしない＝データ取り違え事故を防ぐ回帰。
describe("isLocalDbUrl", () => {
  it("file: スキームのローカル SQLite はローカルと判定する", () => {
    expect(isLocalDbUrl("file:local.db")).toBe(true);
    expect(isLocalDbUrl("file:./local.db")).toBe(true);
    expect(isLocalDbUrl("file:C:/data/test.db")).toBe(true);
  });

  it("リモート Turso（libsql://）はローカルではない", () => {
    expect(isLocalDbUrl("libsql://example.turso.io")).toBe(false);
  });

  it("https:// のリモート URL はローカルではない", () => {
    expect(isLocalDbUrl("https://example.turso.io")).toBe(false);
  });

  it("先頭が file: でなければ（部分一致でも）ローカル扱いしない", () => {
    // 「file:」が途中に含まれるだけの URL を誤検出しない（startsWith 判定）
    expect(isLocalDbUrl("libsql://host/?src=file:local.db")).toBe(false);
    expect(isLocalDbUrl("")).toBe(false);
  });
});
