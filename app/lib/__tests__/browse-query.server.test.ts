import { describe, it, expect } from "vitest";
import {
  loadBrowsePage,
  parseBrowseSearchParams,
  BROWSE_ITEMS_PER_PAGE,
  type BrowseQueryArgs,
} from "../browse-query.server";
import { createTestDb, seedUser, seedPageViewStat } from "./helpers/test-db";

// BrowseQueryArgs のデフォルト（各テストで必要な項目だけ上書き）
function args(overrides: Partial<BrowseQueryArgs> = {}): BrowseQueryArgs {
  return {
    q: "",
    sort: "updatedAt",
    page: 1,
    roles: [],
    editions: [],
    inputMethods: [],
    platforms: [],
    ...overrides,
  };
}

describe("loadBrowsePage - 可視性フィルタ（セキュリティ回帰）", () => {
  it("public のユーザーのみ返し、unlisted / private は一覧に出さない", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "pub", mcid: "Pub", role: "runner", profileVisibility: "public" });
    await seedUser(db, { slug: "unl", mcid: "Unl", role: "runner", profileVisibility: "unlisted" });
    await seedUser(db, { slug: "prv", mcid: "Prv", role: "runner", profileVisibility: "private" });

    const result = await loadBrowsePage(db, args(), []);

    const slugs = result.players.map((p) => p.slug);
    expect(slugs).toEqual(["pub"]);
    expect(result.totalCount).toBe(1);
  });
});

describe("loadBrowsePage - LIKE 検索（セキュリティ回帰）", () => {
  it("q は mcid / displayName の部分一致で拾う（大小文字を無視）", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "d", mcid: "Dream", role: "runner" });
    await seedUser(db, { slug: "a", mcid: "Bob", role: "runner" });
    await seedUser(db, { slug: "n", mcid: "NoMatch", displayName: "ドレイク", role: "runner" });

    const byMcid = await loadBrowsePage(db, args({ q: "dre" }), []);
    expect(byMcid.players.map((p) => p.slug).sort()).toEqual(["d"]);

    // displayName にマッチ（mcid には "dora" が無いが displayName "ドレ..." ではなく別ケースを確認）
    const byDisplay = await loadBrowsePage(db, args({ q: "ドレイク" }), []);
    expect(byDisplay.players.map((p) => p.slug)).toEqual(["n"]);
  });

  it("% / _ はエスケープされリテラル扱いになる（LIKE ワイルドカードとして解釈しない）", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "pct", mcid: "PctUser", displayName: "a%b", role: "runner" });
    await seedUser(db, { slug: "axb", mcid: "AxbUser", displayName: "axb", role: "runner" });

    // "a%b" は a%b にリテラル一致する（% をワイルドカードにしない）
    const literal = await loadBrowsePage(db, args({ q: "a%b" }), []);
    expect(literal.players.map((p) => p.slug)).toEqual(["pct"]);

    // % がワイルドカードなら "axb" にもヒットするはずだが、リテラル扱いなのでヒットしない
    const notWildcard = await loadBrowsePage(db, args({ q: "axb" }), []);
    expect(notWildcard.players.map((p) => p.slug)).toEqual(["axb"]);
  });

  it("_ は 1 文字ワイルドカードにならずリテラル一致する", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "u", mcid: "a_b", role: "runner" });
    await seedUser(db, { slug: "x", mcid: "aXb", role: "runner" });

    const literal = await loadBrowsePage(db, args({ q: "a_b" }), []);
    expect(literal.players.map((p) => p.slug)).toEqual(["u"]);
  });

  it("正規表現メタ文字はリテラル扱い（regex 機能は廃止）。該当なしでもエラー・ハングしない", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "ab", mcid: "aab", role: "runner" });

    const result = await loadBrowsePage(db, args({ q: "(a|a)+b" }), []);
    expect(result.players).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});

describe("loadBrowsePage - フィルタ", () => {
  it("role フィルタ未指定時は viewer を除外する（runner / null は含む）", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "runner", mcid: "R", role: "runner" });
    await seedUser(db, { slug: "viewer", mcid: "V", role: "viewer" });
    await seedUser(db, { slug: "norole", mcid: "N", role: null });

    const result = await loadBrowsePage(db, args(), []);
    expect(result.players.map((p) => p.slug).sort()).toEqual(["norole", "runner"]);
  });

  it("role=viewer を明示指定した場合は viewer のみ返す", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "runner", mcid: "R", role: "runner" });
    await seedUser(db, { slug: "viewer", mcid: "V", role: "viewer" });

    const result = await loadBrowsePage(db, args({ roles: ["viewer"] }), []);
    expect(result.players.map((p) => p.slug)).toEqual(["viewer"]);
  });

  it("edition / inputMethod / platform で絞り込む", async () => {
    const db = await createTestDb();
    await seedUser(db, {
      slug: "match",
      mcid: "M",
      role: "runner",
      mainEdition: "java",
      inputMethodBadge: "keyboard_mouse",
      mainPlatform: "pc_windows",
    });
    await seedUser(db, {
      slug: "other",
      mcid: "O",
      role: "runner",
      mainEdition: "bedrock",
      inputMethodBadge: "controller",
      mainPlatform: "switch",
    });

    expect(
      (await loadBrowsePage(db, args({ editions: ["java"] }), [])).players.map((p) => p.slug),
    ).toEqual(["match"]);
    expect(
      (await loadBrowsePage(db, args({ inputMethods: ["keyboard_mouse"] }), [])).players.map(
        (p) => p.slug,
      ),
    ).toEqual(["match"]);
    expect(
      (await loadBrowsePage(db, args({ platforms: ["switch"] }), [])).players.map((p) => p.slug),
    ).toEqual(["other"]);
  });
});

describe("loadBrowsePage - ソート", () => {
  it("mcid 昇順で並ぶ", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "c", mcid: "Charlie", role: "runner" });
    await seedUser(db, { slug: "a", mcid: "Alice", role: "runner" });
    await seedUser(db, { slug: "b", mcid: "Bob", role: "runner" });

    const result = await loadBrowsePage(db, args({ sort: "mcid" }), []);
    expect(result.players.map((p) => p.mcid)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("displayName 昇順で並ぶ", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "c", mcid: "C", displayName: "Zeta", role: "runner" });
    await seedUser(db, { slug: "a", mcid: "A", displayName: "Alpha", role: "runner" });
    await seedUser(db, { slug: "b", mcid: "B", displayName: "Mu", role: "runner" });

    const result = await loadBrowsePage(db, args({ sort: "displayName" }), []);
    expect(result.players.map((p) => p.displayName)).toEqual(["Alpha", "Mu", "Zeta"]);
  });

  it("mcid 未登録（NULL）のユーザーは末尾に置く", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "@none1", mcid: null, role: "runner" });
    await seedUser(db, { slug: "b", mcid: "Bob", role: "runner" });
    await seedUser(db, { slug: "@none2", mcid: null, role: "runner" });
    await seedUser(db, { slug: "a", mcid: "Alice", role: "runner" });

    const result = await loadBrowsePage(db, args({ sort: "mcid" }), []);
    expect(result.players.map((p) => p.mcid)).toEqual(["Alice", "Bob", null, null]);
  });

  it("displayName 未設定（NULL）のユーザーは末尾に置く", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "n", mcid: "None", displayName: null, role: "runner" });
    await seedUser(db, { slug: "z", mcid: "Z", displayName: "Zeta", role: "runner" });
    await seedUser(db, { slug: "a", mcid: "A", displayName: "Alpha", role: "runner" });

    const result = await loadBrowsePage(db, args({ sort: "displayName" }), []);
    expect(result.players.map((p) => p.displayName)).toEqual(["Alpha", "Zeta", null]);
  });

  it("お気に入り優先は NULL 末尾より強い（お気に入りなら未設定でも先頭）", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "@fav", mcid: null, role: "runner" });
    await seedUser(db, { slug: "a", mcid: "Alice", role: "runner" });

    const result = await loadBrowsePage(db, args({ sort: "mcid" }), ["@fav"]);
    expect(result.players.map((p) => p.slug)).toEqual(["@fav", "a"]);
  });

  it("updatedAt 降順（新しい順）で並ぶ", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "old", mcid: "Old", role: "runner", updatedAt: new Date("2020-01-01") });
    await seedUser(db, { slug: "new", mcid: "New", role: "runner", updatedAt: new Date("2026-01-01") });
    await seedUser(db, { slug: "mid", mcid: "Mid", role: "runner", updatedAt: new Date("2023-01-01") });

    const result = await loadBrowsePage(db, args({ sort: "updatedAt" }), []);
    expect(result.players.map((p) => p.slug)).toEqual(["new", "mid", "old"]);
  });
});

describe("loadBrowsePage - 人気順（popular）", () => {
  it("直近のプロフィール閲覧数（page_view_stats）が多い順に並ぶ", async () => {
    const db = await createTestDb();
    // 更新日時は閲覧数と逆順にして、ページビューが第一キーであることを分かるようにする
    const hot = await seedUser(db, {
      slug: "hot",
      mcid: "Hot",
      role: "runner",
      updatedAt: new Date("2020-01-01"),
    });
    const warm = await seedUser(db, {
      slug: "warm",
      mcid: "Warm",
      role: "runner",
      updatedAt: new Date("2023-01-01"),
    });
    await seedUser(db, {
      slug: "cold",
      mcid: "Cold",
      role: "runner",
      updatedAt: new Date("2026-01-01"),
    });
    await seedPageViewStat(db, "profile", hot.id, 100);
    await seedPageViewStat(db, "profile", warm.id, 10);

    const result = await loadBrowsePage(db, args({ sort: "popular" }), []);
    expect(result.players.map((p) => p.slug)).toEqual(["hot", "warm", "cold"]);
  });

  it("集計がまだ無ければ（全件0）更新日時の新しい順へ落ちる（並びが破綻しない）", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "old", mcid: "Old", role: "runner", updatedAt: new Date("2020-01-01") });
    await seedUser(db, { slug: "new", mcid: "New", role: "runner", updatedAt: new Date("2026-01-01") });
    await seedUser(db, { slug: "mid", mcid: "Mid", role: "runner", updatedAt: new Date("2023-01-01") });

    const result = await loadBrowsePage(db, args({ sort: "popular" }), []);
    expect(result.players.map((p) => p.slug)).toEqual(["new", "mid", "old"]);
  });

  it("お気に入り優先は人気順より強い（閲覧数 0 でも先頭）", async () => {
    const db = await createTestDb();
    const hot = await seedUser(db, {
      slug: "hot",
      mcid: "Hot",
      role: "runner",
      updatedAt: new Date("2026-01-01"),
    });
    await seedUser(db, {
      slug: "fav",
      mcid: "Fav",
      role: "runner",
      updatedAt: new Date("2020-01-01"),
    });
    await seedPageViewStat(db, "profile", hot.id, 100);

    const result = await loadBrowsePage(db, args({ sort: "popular" }), ["fav"]);
    expect(result.players.map((p) => p.slug)).toEqual(["fav", "hot"]);
  });
});

describe("loadBrowsePage - お気に入り優先", () => {
  it("favoriteSlugs に含まれるユーザーが通常ソートより先頭に来る", async () => {
    const db = await createTestDb();
    // normal を新しく、fav を古くしても、お気に入りが先頭に来ることを確認
    await seedUser(db, { slug: "normal", mcid: "Normal", role: "runner", updatedAt: new Date("2026-01-01") });
    await seedUser(db, { slug: "fav", mcid: "Fav", role: "runner", updatedAt: new Date("2020-01-01") });

    const withoutFav = await loadBrowsePage(db, args({ sort: "updatedAt" }), []);
    expect(withoutFav.players.map((p) => p.slug)).toEqual(["normal", "fav"]);

    const withFav = await loadBrowsePage(db, args({ sort: "updatedAt" }), ["fav"]);
    expect(withFav.players.map((p) => p.slug)).toEqual(["fav", "normal"]);
  });
});

describe("loadBrowsePage - ページング", () => {
  it("1 ページ 12 件・totalCount / totalPages / hasMore が正しい", async () => {
    const db = await createTestDb();
    for (let i = 0; i < 13; i++) {
      await seedUser(db, {
        slug: `u${i}`,
        mcid: `User${String(i).padStart(2, "0")}`,
        role: "runner",
      });
    }

    const page1 = await loadBrowsePage(db, args({ sort: "mcid", page: 1 }), []);
    expect(page1.players).toHaveLength(BROWSE_ITEMS_PER_PAGE);
    expect(page1.totalCount).toBe(13);
    expect(page1.totalPages).toBe(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await loadBrowsePage(db, args({ sort: "mcid", page: 2 }), []);
    expect(page2.players).toHaveLength(1);
    expect(page2.players[0].mcid).toBe("User12");
    expect(page2.hasMore).toBe(false);
  });
});

describe("parseBrowseSearchParams", () => {
  it("q / sort とフィルタ配列（getAll）を解釈する", () => {
    const sp = new URLSearchParams();
    sp.set("q", "dream");
    sp.set("sort", "mcid");
    sp.append("role", "runner");
    sp.append("role", "viewer");
    sp.append("edition", "java");
    sp.append("input", "controller");
    sp.append("platform", "switch");

    const parsed = parseBrowseSearchParams(sp);
    expect(parsed.q).toBe("dream");
    expect(parsed.sort).toBe("mcid");
    expect(parsed.roles).toEqual(["runner", "viewer"]);
    expect(parsed.editions).toEqual(["java"]);
    expect(parsed.inputMethods).toEqual(["controller"]);
    expect(parsed.platforms).toEqual(["switch"]);
  });

  it("未指定は既定値（q='' / sort='updatedAt' / page=1 / 空配列）", () => {
    const parsed = parseBrowseSearchParams(new URLSearchParams());
    expect(parsed.q).toBe("");
    expect(parsed.sort).toBe("updatedAt");
    expect(parsed.page).toBe(1);
    expect(parsed.roles).toEqual([]);
  });

  it("許可リスト外の sort は既定（updatedAt）へ正規化する", () => {
    const mk = (sort: string) => parseBrowseSearchParams(new URLSearchParams({ sort })).sort;
    expect(mk("bogus")).toBe("updatedAt");
    expect(mk("")).toBe("updatedAt");
    // 許可済みの値はそのまま通る
    expect(mk("popular")).toBe("popular");
  });

  it("page は 1 未満・非数値を 1 にクランプし、巨大値は上限で頭打ちにする", () => {
    const mk = (page: string) => parseBrowseSearchParams(new URLSearchParams({ page })).page;
    expect(mk("0")).toBe(1);
    expect(mk("-5")).toBe(1);
    expect(mk("abc")).toBe(1);
    expect(mk("999999999")).toBe(100_000);
    expect(mk("3")).toBe(3);
  });
});
