import { describe, it, expect } from "vitest";
import {
  loadRankingCategories,
  loadRankings,
  parseRankingsParams,
  type RankingsArgs,
} from "../rankings-query.server";
import {
  createTestDb,
  seedUser,
  seedSpeedrunCategory,
  seedPlayerRanking,
  seedCategoryRecord,
} from "./helpers/test-db";

describe("loadRankingCategories", () => {
  it("有効な speedruncom カテゴリのみを displayOrder 昇順で返す", async () => {
    const db = await createTestDb();
    await seedSpeedrunCategory(db, { slug: "second", categoryType: "speedruncom", displayOrder: 2 });
    await seedSpeedrunCategory(db, { slug: "first", categoryType: "speedruncom", displayOrder: 1 });
    await seedSpeedrunCategory(db, { slug: "inactive", categoryType: "speedruncom", isActive: false });
    await seedSpeedrunCategory(db, { slug: "ranked", categoryType: "ranked", displayOrder: 0 });

    const categories = await loadRankingCategories(db);
    expect(categories.map((c) => c.slug)).toEqual(["first", "second"]);
  });
});

describe("loadRankings - speedruncom タブ", () => {
  it("公開ユーザーのみ・タイム昇順で並び、承認済みに順位が付く（未承認は null）", async () => {
    const db = await createTestDb();
    const category = await seedSpeedrunCategory(db, { slug: "any", categoryType: "speedruncom" });

    const fast = await seedUser(db, { slug: "fast", mcid: "Fast", profileVisibility: "public" });
    const slow = await seedUser(db, { slug: "slow", mcid: "Slow", profileVisibility: "public" });
    const hidden = await seedUser(db, { slug: "hidden", mcid: "Hidden", profileVisibility: "private" });

    await seedPlayerRanking(db, fast.id, {
      rankingType: "speedruncom",
      categoryId: category.id,
      timeMs: 100_000,
      verificationStatus: "verified",
    });
    await seedPlayerRanking(db, slow.id, {
      rankingType: "speedruncom",
      categoryId: category.id,
      timeMs: 200_000,
      verificationStatus: "verified",
    });
    // 非公開ユーザーはランキングに出さない
    await seedPlayerRanking(db, hidden.id, {
      rankingType: "speedruncom",
      categoryId: category.id,
      timeMs: 50_000,
      verificationStatus: "verified",
    });

    const cats = await loadRankingCategories(db);
    const args: RankingsArgs = { tab: "speedruncom", categorySlug: "any", rankedType: "pb" };
    const { rankings, selectedCategory } = await loadRankings(db, args, cats);

    expect(selectedCategory?.slug).toBe("any");
    expect(rankings.map((r) => r.slug)).toEqual(["fast", "slow"]);
    expect(rankings.map((r) => r.rank)).toEqual([1, 2]);
    // 非公開ユーザーは含まれない
    expect(rankings.some((r) => r.slug === "hidden")).toBe(false);
  });

  it("承認待ち（new）は順位 null で末尾に置かれ、承認済みのみ連番になる", async () => {
    const db = await createTestDb();
    const category = await seedSpeedrunCategory(db, { slug: "any", categoryType: "speedruncom" });
    const verified = await seedUser(db, { slug: "v", mcid: "V", profileVisibility: "public" });
    const pending = await seedUser(db, { slug: "n", mcid: "N", profileVisibility: "public" });

    await seedPlayerRanking(db, verified.id, {
      rankingType: "speedruncom",
      categoryId: category.id,
      timeMs: 100_000,
      verificationStatus: "verified",
    });
    await seedPlayerRanking(db, pending.id, {
      rankingType: "speedruncom",
      categoryId: category.id,
      timeMs: 90_000, // 速いが未承認
      verificationStatus: "new",
    });

    const cats = await loadRankingCategories(db);
    const { rankings } = await loadRankings(
      db,
      { tab: "speedruncom", categorySlug: "any", rankedType: "pb" },
      cats,
    );

    const byslug = Object.fromEntries(rankings.map((r) => [r.slug, r.rank]));
    expect(byslug["v"]).toBe(1);
    expect(byslug["n"]).toBeNull();
  });

  it("本人が非表示にした記録（isVisible=false）は除外する", async () => {
    const db = await createTestDb();
    const category = await seedSpeedrunCategory(db, { slug: "any", categoryType: "speedruncom" });
    const user = await seedUser(db, { slug: "u", mcid: "U", profileVisibility: "public" });

    await seedPlayerRanking(db, user.id, {
      rankingType: "speedruncom",
      categoryId: category.id,
      timeMs: 100_000,
      verificationStatus: "verified",
    });
    await seedCategoryRecord(db, user.id, {
      categoryRefId: category.id,
      isVisible: false,
    });

    const cats = await loadRankingCategories(db);
    const { rankings } = await loadRankings(
      db,
      { tab: "speedruncom", categorySlug: "any", rankedType: "pb" },
      cats,
    );
    expect(rankings).toEqual([]);
  });
});

describe("loadRankings - ranked タブ", () => {
  it("pb: showRankedStats=true の公開ユーザーをタイム昇順で並べる", async () => {
    const db = await createTestDb();
    const fast = await seedUser(db, { slug: "fast", mcid: "Fast", showRankedStats: true });
    const slow = await seedUser(db, { slug: "slow", mcid: "Slow", showRankedStats: true });
    const hiddenStats = await seedUser(db, { slug: "off", mcid: "Off", showRankedStats: false });

    await seedPlayerRanking(db, fast.id, { rankingType: "ranked_pb", timeMs: 100_000 });
    await seedPlayerRanking(db, slow.id, { rankingType: "ranked_pb", timeMs: 200_000 });
    await seedPlayerRanking(db, hiddenStats.id, { rankingType: "ranked_pb", timeMs: 50_000 });

    const { rankings } = await loadRankings(
      db,
      { tab: "ranked", categorySlug: null, rankedType: "pb" },
      [],
    );
    expect(rankings.map((r) => r.slug)).toEqual(["fast", "slow"]);
    expect(rankings.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("elo: Elo 降順で並べる", async () => {
    const db = await createTestDb();
    const high = await seedUser(db, { slug: "high", mcid: "High", showRankedStats: true });
    const low = await seedUser(db, { slug: "low", mcid: "Low", showRankedStats: true });

    await seedPlayerRanking(db, high.id, { rankingType: "ranked_elo", eloRate: 2000 });
    await seedPlayerRanking(db, low.id, { rankingType: "ranked_elo", eloRate: 1000 });

    const { rankings } = await loadRankings(
      db,
      { tab: "ranked", categorySlug: null, rankedType: "elo" },
      [],
    );
    expect(rankings.map((r) => r.slug)).toEqual(["high", "low"]);
    expect(rankings.map((r) => r.eloRate)).toEqual([2000, 1000]);
  });
});

describe("parseRankingsParams", () => {
  it("既定値（tab=speedruncom / rankedType=pb / category=null）", () => {
    const parsed = parseRankingsParams(new URLSearchParams());
    expect(parsed.tab).toBe("speedruncom");
    expect(parsed.rankedType).toBe("pb");
    expect(parsed.categorySlug).toBeNull();
  });

  it("クエリからタブ・カテゴリ・rankedType を解釈する", () => {
    const sp = new URLSearchParams({ tab: "ranked", category: "any", rankedType: "elo" });
    const parsed = parseRankingsParams(sp);
    expect(parsed.tab).toBe("ranked");
    expect(parsed.categorySlug).toBe("any");
    expect(parsed.rankedType).toBe("elo");
  });
});
