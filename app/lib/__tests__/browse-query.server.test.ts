import { describe, it, expect } from "vitest";
import * as schema from "../schema";
import {
  countBrowse,
  countBrowseLanguages,
  getFavoriteSlugsByDiscordId,
  loadBrowsePage,
  parseBrowseSearchParams,
  BROWSE_ITEMS_PER_PAGE,
  type BrowseQueryArgs,
} from "../browse-query.server";
import { createTestDb, seedUser, seedPageViewStat, seedPlayerConfig, seedConfigPreset } from "./helpers/test-db";

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
    languages: [],
    ...overrides,
  };
}

describe("getFavoriteSlugsByDiscordId", () => {
  it("ユーザー不在は null、お気に入り0件は []", async () => {
    const db = await createTestDb();
    await seedUser(db, { discordId: "d-none" });
    expect(await getFavoriteSlugsByDiscordId(db, "d-missing")).toBeNull();
    expect(await getFavoriteSlugsByDiscordId(db, "d-none")).toEqual([]);
  });

  it("favoriteSlug の辞書順で返す（登録順ではない）", async () => {
    const db = await createTestDb();
    const me = await seedUser(db, { discordId: "d-me" });
    const base = Date.now();
    // 登録順は c → a → b、辞書順は a → b → c
    for (const [i, slug] of ["c", "a", "b"].entries()) {
      await db.insert(schema.favorites).values({
        userId: me.id,
        favoriteSlug: slug,
        createdAt: new Date(base + i * 1000),
      });
    }
    expect(await getFavoriteSlugsByDiscordId(db, "d-me")).toEqual(["a", "b", "c"]);
  });
});

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

describe("countBrowse - 一覧と同じ条件解釈", () => {
  it("さまざまな条件で loadBrowsePage の totalCount と一致する（非公開・視聴者既定除外含む）", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "a", mcid: "Alpha", role: "runner", mainEdition: "java", inputMethod: "keyboard_mouse", mainPlatform: "pc_windows" });
    await seedUser(db, { slug: "b", mcid: "Beta", role: null, mainEdition: "bedrock", inputMethod: "controller", mainPlatform: "switch" });
    await seedUser(db, { slug: "v", mcid: "Viewer", role: "viewer", mainEdition: "java" });
    await seedUser(db, { slug: "p", mcid: "Priv", role: "runner", profileVisibility: "private" });

    const cases: Partial<BrowseQueryArgs>[] = [
      {},
      { roles: ["viewer"] },
      { roles: ["runner", "viewer"] },
      { editions: ["bedrock"] },
      { inputMethods: ["controller"] },
      { platforms: ["pc_windows", "switch"] },
      { q: "alp" },
      { q: "zzz" },
      { roles: ["runner"], editions: ["java"], q: "a" },
    ];
    for (const c of cases) {
      const a = args(c);
      const list = await loadBrowsePage(db, a, []);
      expect(await countBrowse(db, a)).toBe(list.totalCount);
    }
    expect(await countBrowse(db, args())).toBe(2);
    expect(await countBrowse(db, args({ roles: ["viewer"] }))).toBe(1);
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
      inputMethod: "keyboard_mouse",
      mainPlatform: "pc_windows",
    });
    await seedUser(db, {
      slug: "other",
      mcid: "O",
      role: "runner",
      mainEdition: "bedrock",
      inputMethod: "controller",
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

  it("既定値（Java / Windows / キーボード＆マウス）で絞るときは未設定（NULL）も含める。既定値以外は含めない", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "unset", mcid: "U", role: "runner", mainEdition: null, inputMethod: null, mainPlatform: null });
    await seedUser(db, {
      slug: "bedrock",
      mcid: "B",
      role: "runner",
      mainEdition: "bedrock",
      inputMethod: "controller",
      mainPlatform: "switch",
    });

    const slugs = async (a: Partial<BrowseQueryArgs>) =>
      (await loadBrowsePage(db, args(a), [])).players.map((p) => p.slug);
    expect(await slugs({ editions: ["java"] })).toEqual(["unset"]);
    expect(await slugs({ inputMethods: ["keyboard_mouse"] })).toEqual(["unset"]);
    expect(await slugs({ platforms: ["pc_windows"] })).toEqual(["unset"]);
    expect(await slugs({ editions: ["bedrock"] })).toEqual(["bedrock"]);
    expect(await slugs({ platforms: ["pc_mac"] })).toEqual([]);
  });

  it("?input= は users.inputMethod 列のみを見る（廃止済みの inputMethodBadge 由来では絞られない）", async () => {
    const db = await createTestDb();
    // inputMethod が controller のユーザーだけが対象。inputMethodBadge の値は無視される。
    await seedUser(db, {
      slug: "by-input-method",
      mcid: "ByInputMethod",
      role: "runner",
      inputMethod: "controller",
      inputMethodBadge: null,
    });
    // inputMethodBadge にのみ controller が入っていて inputMethod が別値・未設定の場合はヒットしない。
    await seedUser(db, {
      slug: "badge-only",
      mcid: "BadgeOnly",
      role: "runner",
      inputMethod: null,
      inputMethodBadge: "controller",
    });
    await seedUser(db, {
      slug: "badge-mismatch",
      mcid: "BadgeMismatch",
      role: "runner",
      inputMethod: "keyboard_mouse",
      inputMethodBadge: "controller",
    });

    const result = await loadBrowsePage(db, args({ inputMethods: ["controller"] }), []);
    expect(result.players.map((p) => p.slug)).toEqual(["by-input-method"]);
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

  it("lang は許可リストで正規化し、未知の値・重複を捨てる", () => {
    const sp = new URLSearchParams();
    sp.append("lang", "JA_JP");
    sp.append("lang", "ja_jp");
    sp.append("lang", "xx_bogus");
    sp.append("lang", "en_us");
    expect(parseBrowseSearchParams(sp).languages).toEqual(["ja_jp", "en_us"]);
    expect(parseBrowseSearchParams(new URLSearchParams()).languages).toEqual([]);
  });
});

describe("loadBrowsePage - ゲーム内言語の絞り込み", () => {
  async function seedLangUsers() {
    const db = await createTestDb();
    const ja = await seedUser(db, { slug: "ja", mcid: "Ja", role: "runner" });
    await seedPlayerConfig(db, ja.id, { gameLanguage: "ja_jp" });
    const en = await seedUser(db, { slug: "en", mcid: "En", role: "runner" });
    await seedPlayerConfig(db, en.id, { gameLanguage: "en_us" });
    const none = await seedUser(db, { slug: "none", mcid: "None", role: "runner" });
    await seedPlayerConfig(db, none.id, { gameLanguage: null });
    await seedUser(db, { slug: "noconfig", mcid: "NoConfig", role: "runner" });
    return db;
  }
  const slugsOf = async (db: Awaited<ReturnType<typeof createTestDb>>, a: Partial<BrowseQueryArgs>) =>
    (await loadBrowsePage(db, args(a), [])).players.map((p) => p.slug).sort();

  it("言語で絞れる。未設定（設定行なし・NULL）は絞り込み中は出ず、無指定では出る", async () => {
    const db = await seedLangUsers();
    expect(await slugsOf(db, { languages: ["ja_jp"] })).toEqual(["ja"]);
    expect(await slugsOf(db, { languages: ["ja_jp", "en_us"] })).toEqual(["en", "ja"]);
    expect(await slugsOf(db, {})).toEqual(["en", "ja", "none", "noconfig"].sort());
    expect(await countBrowse(db, args({ languages: ["en_us"] }))).toBe(1);
  });

  it("保存値の大文字・前後空白は無視して一致する", async () => {
    const db = await createTestDb();
    const u = await seedUser(db, { slug: "u", mcid: "U", role: "runner" });
    await seedPlayerConfig(db, u.id, { gameLanguage: " JA_JP " });
    expect(await slugsOf(db, { languages: ["ja_jp"] })).toEqual(["u"]);
  });

  it("ほかの絞り込み・検索と AND で組み合わさる", async () => {
    const db = await createTestDb();
    const a = await seedUser(db, { slug: "a", mcid: "Alpha", role: "runner", mainEdition: "java" });
    await seedPlayerConfig(db, a.id, { gameLanguage: "ja_jp" });
    const b = await seedUser(db, { slug: "b", mcid: "Beta", role: "runner", mainEdition: "bedrock" });
    await seedPlayerConfig(db, b.id, { gameLanguage: "ja_jp" });
    expect(await slugsOf(db, { languages: ["ja_jp"], editions: ["bedrock"] })).toEqual(["b"]);
    expect(await slugsOf(db, { languages: ["ja_jp"], q: "alp" })).toEqual(["a"]);
    // 視聴者は既定で除外されたまま
    const v = await seedUser(db, { slug: "v", mcid: "V", role: "viewer" });
    await seedPlayerConfig(db, v.id, { gameLanguage: "ja_jp" });
    expect(await slugsOf(db, { languages: ["ja_jp"] })).toEqual(["a", "b"]);
  });

  it("メインが編集中でないプリセットなら、プロフィールの表示と同じくそのスナップショットの言語を使う", async () => {
    const db = await createTestDb();
    const u = await seedUser(db, { slug: "u", mcid: "U", role: "runner" });
    // ライブ（編集中プリセット）は en_us、公開用（メイン・非編集中）のスナップショットは ja_jp
    await seedPlayerConfig(db, u.id, { gameLanguage: "en_us" });
    await seedConfigPreset(db, u.id, { name: "edit", isActive: true, isMain: false });
    await seedConfigPreset(db, u.id, {
      name: "main",
      isActive: false,
      isMain: true,
      playerConfigData: JSON.stringify({ gameLanguage: "ja_jp" }),
    });
    expect(await slugsOf(db, { languages: ["ja_jp"] })).toEqual(["u"]);
    expect(await slugsOf(db, { languages: ["en_us"] })).toEqual([]);
  });

  it("メインが編集中ならライブの値、スナップショットが壊れていれば未設定として扱う", async () => {
    const db = await createTestDb();
    const live = await seedUser(db, { slug: "live", mcid: "Live", role: "runner" });
    await seedPlayerConfig(db, live.id, { gameLanguage: "en_us" });
    await seedConfigPreset(db, live.id, {
      isActive: true,
      isMain: true,
      playerConfigData: JSON.stringify({ gameLanguage: "ja_jp" }),
    });
    const broken = await seedUser(db, { slug: "broken", mcid: "Broken", role: "runner" });
    await seedPlayerConfig(db, broken.id, { gameLanguage: "en_us" });
    await seedConfigPreset(db, broken.id, { isActive: false, isMain: true, playerConfigData: "{not json" });
    expect(await slugsOf(db, { languages: ["en_us"] })).toEqual(["live"]);
    expect(await slugsOf(db, { languages: ["ja_jp"] })).toEqual([]);
  });
});

describe("countBrowseLanguages", () => {
  it("言語ごとの人数を返し、言語以外の条件は効かせ、選択中の言語では絞らない", async () => {
    const db = await createTestDb();
    for (const [slug, lang, edition] of [
      ["a", "ja_jp", "java"],
      ["b", "ja_jp", "bedrock"],
      ["c", "en_us", "java"],
    ] as const) {
      const u = await seedUser(db, { slug, mcid: slug.toUpperCase(), role: "runner", mainEdition: edition });
      await seedPlayerConfig(db, u.id, { gameLanguage: lang });
    }
    await seedUser(db, { slug: "n", mcid: "N", role: "runner" });
    expect(await countBrowseLanguages(db, args())).toEqual({ ja_jp: 2, en_us: 1 });
    expect(await countBrowseLanguages(db, args({ editions: ["java"], languages: ["ja_jp"] }))).toEqual({
      ja_jp: 1,
      en_us: 1,
    });
  });
});
