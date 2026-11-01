import { describe, it, expect } from "vitest";
import { applyGuideTranslation } from "../guide-translation-list";

const row = { id: "g1", title: "原題", summary: "原文の要約", slug: "s" };

describe("applyGuideTranslation", () => {
  it("訳文が無い行は原文のまま autoTranslated=false", () => {
    expect(applyGuideTranslation(row, new Map())).toEqual({ ...row, autoTranslated: false });
  });

  it("訳文があれば title / summary を差し替えて autoTranslated=true、他の列は保つ", () => {
    const map = new Map([["g1", { title: "Title", summary: "Summary", sourceLocale: "ja" as const }]]);
    expect(applyGuideTranslation(row, map)).toEqual({
      ...row,
      title: "Title",
      summary: "Summary",
      autoTranslated: true,
    });
  });

  it("訳文の summary が null なら原文の summary を残す", () => {
    const map = new Map([["g1", { title: "Title", summary: null, sourceLocale: "ja" as const }]]);
    expect(applyGuideTranslation(row, map).summary).toBe("原文の要約");
  });
});
