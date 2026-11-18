// 旧 /stats は /keybindings/stats へ統合された。既存のリンク・ブックマークのため 301 で転送する。
import { describe, it, expect } from "vitest";
import { loader } from "../stats";

describe("/stats loader - 旧URLのリダイレクト", () => {
  it("301 で /keybindings/stats へ転送する", () => {
    const res = loader();

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/keybindings/stats");
  });
});
