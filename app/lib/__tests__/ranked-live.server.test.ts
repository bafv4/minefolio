// fetchRankedLiveMatches: 「ホーム画面にTwitch配信を表示」をオフにした人の liveUrl は消す（カードは残る）
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDbAt, seedUser, type TestDb } from "./helpers/test-db";
import { invalidateCache } from "../cache";
import { HOME_HIDDEN_USERS_CACHE_KEY } from "../home-visibility.server";
import { RANKED_REGISTERED_CACHE_KEY, fetchRankedLiveMatches } from "../ranked-live.server";

const SHARED_URL = "file::memory:?cache=shared";
let db: TestDb;
let originalUrl: string | undefined;

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
  await invalidateCache(HOME_HIDDEN_USERS_CACHE_KEY);
  await invalidateCache(RANKED_REGISTERED_CACHE_KEY);
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

function stubLive(players: { uuid: string; nickname: string }[]) {
  const data = Object.fromEntries(players.map((p) => [p.uuid, { liveUrl: `https://www.twitch.tv/${p.nickname}`, timeline: null }]));
  const body = {
    status: "success",
    data: { liveMatches: [{ currentTime: 1000, players: players.map((p) => ({ ...p, eloRate: 1000 })), data }] },
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
}

describe("fetchRankedLiveMatches - Twitch 非表示", () => {
  it("showTwitchOnHome=false の人の liveUrl は null（カードは残す）、オンの人は配信URLを残す", async () => {
    await seedUser(db, { slug: "twoff", mcid: "twoff", uuid: "aaaaaaaa", role: "runner", profileVisibility: "public", showTwitchOnHome: false });
    await seedUser(db, { slug: "twon", mcid: "twon", uuid: "bbbbbbbb", role: "runner", profileVisibility: "public" });
    stubLive([{ uuid: "aaaaaaaa", nickname: "twoff" }, { uuid: "zzzzzzzz", nickname: "stranger" }]);
    const off = await fetchRankedLiveMatches(db as never);
    expect(off).toHaveLength(1);
    expect(off[0].slug).toBe("twoff");
    expect(off[0].liveUrl).toBeNull();

    stubLive([{ uuid: "bbbbbbbb", nickname: "twon" }, { uuid: "zzzzzzzz", nickname: "stranger" }]);
    const on = await fetchRankedLiveMatches(db as never);
    expect(on[0].liveUrl).toBe("https://www.twitch.tv/twon");
  });
});
