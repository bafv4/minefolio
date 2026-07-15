import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyVercelSignature, buildReleaseDescription } from "../release-notify.server";

const SECRET = "test-secret";

function sign(body: string): string {
  return createHmac("sha1", SECRET).update(body).digest("hex");
}

describe("verifyVercelSignature", () => {
  it("正しい署名を受理する", () => {
    const body = JSON.stringify({ type: "deployment.succeeded" });
    expect(verifyVercelSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("署名がない場合は拒否する", () => {
    expect(verifyVercelSignature("{}", null, SECRET)).toBe(false);
  });

  it("改ざんされたボディを拒否する", () => {
    const body = JSON.stringify({ type: "deployment.succeeded" });
    expect(verifyVercelSignature(body + " ", sign(body), SECRET)).toBe(false);
  });

  it("長さの異なる署名を拒否する", () => {
    expect(verifyVercelSignature("{}", "abc", SECRET)).toBe(false);
  });
});

describe("buildReleaseDescription", () => {
  const md = [
    "## v1.2.0（2026/07/15）",
    "",
    "### 新機能",
    "- 機能Aを追加しました。",
    "",
    "### 修正",
    "- バグBを修正しました。",
    "",
    "## v1.1.0（2026/07/01）",
    "",
    "### その他",
    "- 古い内容。",
  ].join("\n");

  it("該当バージョンのセクションを抽出し ### 見出しを太字に変換する", () => {
    const desc = buildReleaseDescription(md, "v1.2.0", "https://example.com/changelog");
    expect(desc).toContain("**新機能**");
    expect(desc).toContain("- 機能Aを追加しました。");
    expect(desc).toContain("**修正**");
    expect(desc).not.toContain("###");
    expect(desc).not.toContain("古い内容");
  });

  it("該当バージョンがない場合はチェンジログへのリンク文を返す", () => {
    const desc = buildReleaseDescription(md, "v9.9.9", "https://example.com/changelog");
    expect(desc).toContain("https://example.com/changelog");
  });

  it("長すぎる本文は embed 上限内に切り詰める", () => {
    const longMd = ["## v1.0.0（2026/01/01）", "", "### 変更", ...Array.from({ length: 500 }, (_, i) => `- 変更点その${i}です。`)].join("\n");
    const desc = buildReleaseDescription(longMd, "v1.0.0", "https://example.com/changelog");
    expect(desc.length).toBeLessThanOrEqual(3900);
  });
});
