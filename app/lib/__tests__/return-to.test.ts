import { describe, it, expect } from "vitest";
import { sanitizeReturnTo, encodeReturnToForCallback } from "../return-to";

describe("sanitizeReturnTo", () => {
  it("同一オリジンの相対パスをそのまま返す", () => {
    expect(sanitizeReturnTo("/keybindings")).toBe("/keybindings");
    expect(sanitizeReturnTo("/player/x?tab=profile")).toBe("/player/x?tab=profile");
  });

  it("パス・クエリ・ハッシュを含む値も許可する", () => {
    expect(sanitizeReturnTo("/guides/abc#section-2")).toBe("/guides/abc#section-2");
  });

  it("プロトコル相対（//evil.com）は拒否する", () => {
    expect(sanitizeReturnTo("//evil.com")).toBeNull();
  });

  it("バックスラッシュ始まり（/\\evil.com）は拒否する", () => {
    expect(sanitizeReturnTo("/\\evil.com")).toBeNull();
  });

  it("絶対URL（https://evil.com）は拒否する", () => {
    expect(sanitizeReturnTo("https://evil.com")).toBeNull();
  });

  it("スキームのみ（javascript:）は拒否する", () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
  });

  it("/login・/dev/login・/onboarding・/api/* はループ/無意味なので拒否する", () => {
    expect(sanitizeReturnTo("/login")).toBeNull();
    expect(sanitizeReturnTo("/login?returnTo=/keybindings")).toBeNull();
    expect(sanitizeReturnTo("/dev/login")).toBeNull();
    expect(sanitizeReturnTo("/onboarding")).toBeNull();
    expect(sanitizeReturnTo("/api/likes")).toBeNull();
  });

  it("大文字小文字を区別せずブロック対象を判定する", () => {
    expect(sanitizeReturnTo("/LOGIN")).toBeNull();
  });

  it("類似するが別パスのものは拒否しない（/login-history 等）", () => {
    expect(sanitizeReturnTo("/login-history")).toBe("/login-history");
  });

  it("空文字は拒否する", () => {
    expect(sanitizeReturnTo("")).toBeNull();
  });

  it("非文字列は拒否する", () => {
    expect(sanitizeReturnTo(null)).toBeNull();
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo(123)).toBeNull();
    expect(sanitizeReturnTo({})).toBeNull();
    expect(sanitizeReturnTo(["/keybindings"])).toBeNull();
  });

  it("制御文字を含む値は拒否する", () => {
    expect(sanitizeReturnTo("/foo\nbar")).toBeNull();
    expect(sanitizeReturnTo("/foo\tbar")).toBeNull();
  });

  it("先頭が / でない相対値は拒否する", () => {
    expect(sanitizeReturnTo("keybindings")).toBeNull();
  });
});

describe("encodeReturnToForCallback", () => {
  it("通常のパスは encodeURIComponent と同じ結果になる", () => {
    expect(encodeReturnToForCallback("/player/x?tab=profile")).toBe(
      encodeURIComponent("/player/x?tab=profile"),
    );
  });

  it("better-authのcallbackURL許可文字集合からはみ出す記号を追加エスケープする", () => {
    const encoded = encodeReturnToForCallback("/guides/foo?name=a'b(c)!d*e~f");
    expect(encoded).not.toMatch(/[!'()*~]/);
    // 追加エスケープ後も \w \- . + / = & % @ のみで構成される
    expect(encoded).toMatch(/^[\w\-.+/=&%@]*$/);
  });
});
