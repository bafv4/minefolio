// ホームの SSR / `.data` 応答は、ログイン状態・表示設定などの閲覧者依存データを含むため、
// ブラウザ・CDN の共有キャッシュに載せない（Cache-Control: private, no-store）。
import { describe, it, expect } from "vitest";
import { headers } from "../home";

describe("home route headers", () => {
  it("private, no-store を返す", () => {
    expect(headers({} as never)).toEqual({ "Cache-Control": "private, no-store" });
  });
});
