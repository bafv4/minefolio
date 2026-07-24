import { describe, it, expect } from "vitest";
import { isHttpVideoUrl } from "../records";

// pbVideoUrl の Stored XSS 対策（http/https スキーム許可リスト）の回帰テスト。
describe("isHttpVideoUrl", () => {
  it("accepts http/https URLs", () => {
    expect(isHttpVideoUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isHttpVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isHttpVideoUrl("http://example.com/clip")).toBe(true);
  });

  it("rejects javascript: and other dangerous schemes", () => {
    expect(isHttpVideoUrl("javascript:alert(document.domain)")).toBe(false);
    expect(isHttpVideoUrl("JavaScript:alert(1)")).toBe(false);
    expect(isHttpVideoUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpVideoUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isHttpVideoUrl("ftp://example.com/file")).toBe(false);
  });

  it("rejects non-URL and schemeless values", () => {
    expect(isHttpVideoUrl("not a url")).toBe(false);
    expect(isHttpVideoUrl("//example.com")).toBe(false);
    expect(isHttpVideoUrl("")).toBe(false);
  });
});
