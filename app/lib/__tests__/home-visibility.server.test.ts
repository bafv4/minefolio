// getHomeHiddenUsers: 設定オフの人の抽出と、60秒キャッシュ（設定変更が反映されるまでの遅延の根拠）
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, schema, type TestDb } from "./helpers/test-db";
import { invalidateCache } from "../cache";
import { HOME_HIDDEN_USERS_CACHE_KEY, getHomeHiddenUsers } from "../home-visibility.server";

let db: TestDb;
const asDb = (d: TestDb) => d as never;

beforeEach(async () => {
  db = await createTestDb();
  await invalidateCache(HOME_HIDDEN_USERS_CACHE_KEY);
});

describe("getHomeHiddenUsers", () => {
  it("明示的に false の人だけを種別ごとに拾う（mcid は小文字、YouTube / Twitch は slug）", async () => {
    await seedUser(db, { slug: "off-all", mcid: "OffAll", showPacemanOnHome: false, showYoutubeOnHome: false, showTwitchOnHome: false });
    await seedUser(db, { slug: "unset", mcid: "Unset", showPacemanOnHome: null });
    await seedUser(db, { slug: "on", mcid: "On", showPacemanOnHome: true, showYoutubeOnHome: true });

    const hidden = await getHomeHiddenUsers(asDb(db));
    expect([...hidden.pacemanMcids]).toEqual(["offall"]);
    expect([...hidden.youtubeSlugs]).toEqual(["off-all"]);
    expect([...hidden.twitchSlugs]).toEqual(["off-all"]);
  });

  it("結果は60秒キャッシュされる（設定変更はキャッシュ失効まで反映されない）", async () => {
    const user = await seedUser(db, { slug: "flip", mcid: "Flip", showYoutubeOnHome: false });
    expect((await getHomeHiddenUsers(asDb(db))).youtubeSlugs.has("flip")).toBe(true);

    await db.update(schema.users).set({ showYoutubeOnHome: true }).where(eq(schema.users.id, user.id));
    expect((await getHomeHiddenUsers(asDb(db))).youtubeSlugs.has("flip")).toBe(true); // キャッシュ

    await invalidateCache(HOME_HIDDEN_USERS_CACHE_KEY);
    expect((await getHomeHiddenUsers(asDb(db))).youtubeSlugs.has("flip")).toBe(false);
  });
});
