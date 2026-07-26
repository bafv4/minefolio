import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getUserData, USER_DATA_CACHE_KEY } from "../home-user-data.server";
import { invalidateCache } from "../cache";
import { createTestDbAt, seedUser, type TestDb } from "./helpers/test-db";

// getUserData() は db 引数を取らず内部で createDb()（＝ process.env.TURSO_DATABASE_URL）を
// 使い、"home-feed:user-data:v2" をキーにモジュールキャッシュへ載せる。
// env を共有メモリ DB に向けて同一 URL でシードし、キャッシュキーを毎テスト消して検証する。
// （共有メモリ方式は問題なく機能したため、代替の述語再現には切り替えていない。）
const SHARED_URL = "file::memory:?cache=shared";
const CACHE_KEY = USER_DATA_CACHE_KEY;

let db: TestDb;
let originalUrl: string | undefined;

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
  await invalidateCache(CACHE_KEY);
});

afterEach(async () => {
  await invalidateCache(CACHE_KEY);
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

describe("getUserData - 可視性（F11 回帰）", () => {
  it("public のユーザーのみを含み、private / unlisted / viewer は含まない", async () => {
    await seedUser(db, {
      slug: "pub", mcid: "Pub", uuid: "u-pub", displayName: "PubName",
      role: "runner", profileVisibility: "public",
    });
    await seedUser(db, {
      slug: "prv", mcid: "Prv", uuid: "u-prv",
      role: "runner", profileVisibility: "private",
    });
    await seedUser(db, {
      slug: "unl", mcid: "Unl", uuid: "u-unl",
      role: "runner", profileVisibility: "unlisted",
    });
    await seedUser(db, {
      slug: "vw", mcid: "Vw", uuid: "u-vw",
      role: "viewer", profileVisibility: "public",
    });

    const data = await getUserData();

    expect(data.registeredMcids).toEqual(["pub"]);
    expect(Object.keys(data.mcidToSlug)).toEqual(["pub"]);
    expect(data.mcidToSlug).toEqual({ pub: "pub" });
    expect(data.mcidToUuid).toEqual({ pub: "u-pub" });
    expect(data.mcidToDisplayName).toEqual({ pub: "PubName" });

    // private / unlisted / viewer の mcid が一切現れない
    for (const leaked of ["prv", "unl", "vw"]) {
      expect(data.registeredMcids).not.toContain(leaked);
      expect(data.mcidToSlug).not.toHaveProperty(leaked);
      expect(data.mcidToUuid).not.toHaveProperty(leaked);
      expect(data.mcidToDisplayName).not.toHaveProperty(leaked);
    }
  });

  it("mcid / uuid が null のユーザーは対象外", async () => {
    await seedUser(db, { slug: "nouuid", mcid: "NoUuid", uuid: null, role: "runner", profileVisibility: "public" });
    await seedUser(db, { slug: "nomcid", mcid: null, uuid: "u-nomcid", role: "runner", profileVisibility: "public" });

    const data = await getUserData();
    expect(data.registeredMcids).toEqual([]);
  });
});

describe("getUserData - キャッシュ", () => {
  it("2 回目の呼び出しはキャッシュヒットで同一結果を返す（再クエリしない）", async () => {
    await seedUser(db, { slug: "pub", mcid: "Pub", uuid: "u-pub", role: "runner", profileVisibility: "public" });

    const first = await getUserData();
    expect(first.registeredMcids).toEqual(["pub"]);

    // 1 回目の後に新規 public ユーザーを足しても、キャッシュヒットのため反映されない
    await seedUser(db, { slug: "later", mcid: "Later", uuid: "u-later", role: "runner", profileVisibility: "public" });

    const second = await getUserData();
    expect(second).toBe(first); // 同一オブジェクト参照（キャッシュから返る）
    expect(second.registeredMcids).toEqual(["pub"]);
  });
});
