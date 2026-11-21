import { describe, it, expect } from "vitest";
import { resolveRankingsParams } from "../rankings-params";

describe("resolveRankingsParams", () => {
  it("既定値（カテゴリあり: tab=speedruncom / rankedType=pb / category=null）", () => {
    const parsed = resolveRankingsParams(new URLSearchParams(), { hasCategories: true });
    expect(parsed.tab).toBe("speedruncom");
    expect(parsed.rankedType).toBe("pb");
    expect(parsed.categorySlug).toBeNull();
  });

  it("クエリからタブ・カテゴリ・rankedType を解釈する", () => {
    const sp = new URLSearchParams({ tab: "ranked", category: "any", rankedType: "elo" });
    const parsed = resolveRankingsParams(sp, { hasCategories: true });
    expect(parsed.tab).toBe("ranked");
    expect(parsed.categorySlug).toBe("any");
    expect(parsed.rankedType).toBe("elo");
  });

  it("不正な tab / rankedType は既定へ戻す", () => {
    const parsed = resolveRankingsParams(new URLSearchParams({ tab: "foo", rankedType: "bar" }), { hasCategories: true });
    expect(parsed.tab).toBe("speedruncom");
    expect(parsed.rankedType).toBe("pb");
  });

  it("カテゴリが0件で tab の指定が無い（不正）ときは Ranked へ落とす。rankedType は URL のまま", () => {
    expect(resolveRankingsParams(new URLSearchParams(), { hasCategories: false })).toMatchObject({ tab: "ranked", rankedType: "pb" });
    expect(resolveRankingsParams(new URLSearchParams({ rankedType: "elo" }), { hasCategories: false })).toMatchObject({
      tab: "ranked",
      rankedType: "elo",
    });
    expect(resolveRankingsParams(new URLSearchParams({ tab: "foo" }), { hasCategories: false }).tab).toBe("ranked");
  });

  it("tab=speedruncom の明示はカテゴリが0件でも尊重する", () => {
    expect(resolveRankingsParams(new URLSearchParams({ tab: "speedruncom" }), { hasCategories: false }).tab).toBe("speedruncom");
  });
});
