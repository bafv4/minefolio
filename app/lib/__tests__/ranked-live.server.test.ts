// fetchRankedLiveMatches: 「ホーム画面にTwitch配信を表示」をオフにした人の liveUrl は消す（カードは残る）
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDbAt, seedUser, type TestDb } from "./helpers/test-db";
import { invalidateCache } from "../cache";
import { HOME_HIDDEN_USERS_CACHE_KEY } from "../home-visibility.server";
import { RANKED_REGISTERED_CACHE_KEY, fetchRankedLiveMatches, fetchRankedResult } from "../ranked-live.server";

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

describe("fetchRankedLiveMatches - 上流失敗", () => {
  it("非 2xx・例外は null（0試合の [] と区別する）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 503 })));
    expect(await fetchRankedLiveMatches(db as never)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(await fetchRankedLiveMatches(db as never)).toBeNull();
  });
});

describe("fetchRankedResult", () => {
  const ME = "0123456789abcdef0123456789abcdef";
  const OPP = "fedcba9876543210fedcba9876543210";
  const matchBody = {
    status: "success",
    data: [
      {
        id: 1,
        date: 2000,
        result: { uuid: ME, time: 600000 },
        forfeited: false,
        changes: [{ uuid: ME, change: 14 }],
        players: [{ uuid: ME }, { uuid: OPP }],
      },
    ],
  };

  beforeEach(async () => {
    await invalidateCache(`home:ranked-latest:v1:${ME}`);
  });

  it("登録者でなければ上流を叩かず pending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchRankedResult(db as never, { uuid: ME, opponent: OPP, sinceMs: 0 });
    expect(res).toEqual({ status: "pending" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Ranked 統計を非公開にした登録者も pending", async () => {
    await seedUser(db, { slug: "hid", mcid: "hid", uuid: ME, role: "runner", profileVisibility: "public", showRankedStats: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRankedResult(db as never, { uuid: ME, opponent: OPP, sinceMs: 0 })).toEqual({ status: "pending" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("登録者の最新試合が条件に合えば done、opponent が不正なら pending、上流失敗は pending でキャッシュしない", async () => {
    await seedUser(db, { slug: "me", mcid: "me", uuid: ME, role: "runner", profileVisibility: "public" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 500 })));
    expect(await fetchRankedResult(db as never, { uuid: ME, opponent: OPP, sinceMs: 1_000_000 })).toEqual({ status: "pending" });

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(matchBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRankedResult(db as never, { uuid: ME, opponent: "zzz", sinceMs: 1_000_000 })).toEqual({ status: "pending" });
    const done = await fetchRankedResult(db as never, { uuid: ME, opponent: OPP, sinceMs: 1_000_000 });
    expect(done).toEqual({ status: "done", outcome: "win", forfeited: false, timeMs: 600000, eloChange: 14 });
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/users/${ME}/matches?count=1&type=2`);
  });
});

describe("fetchRankedLiveMatches - Twitch 非表示", () => {
  it("showTwitchOnHome=false の人の liveUrl は null（カードは残す）、オンの人は配信URLを残す", async () => {
    await seedUser(db, { slug: "twoff", mcid: "twoff", uuid: "aaaaaaaa", role: "runner", profileVisibility: "public", showTwitchOnHome: false });
    await seedUser(db, { slug: "twon", mcid: "twon", uuid: "bbbbbbbb", role: "runner", profileVisibility: "public" });
    stubLive([{ uuid: "aaaaaaaa", nickname: "twoff" }, { uuid: "zzzzzzzz", nickname: "stranger" }]);
    const off = await fetchRankedLiveMatches(db as never);
    expect(off).toHaveLength(1);
    expect(off![0].slug).toBe("twoff");
    expect(off![0].liveUrl).toBeNull();

    stubLive([{ uuid: "bbbbbbbb", nickname: "twon" }, { uuid: "zzzzzzzz", nickname: "stranger" }]);
    const on = await fetchRankedLiveMatches(db as never);
    expect(on![0].liveUrl).toBe("https://www.twitch.tv/twon");
  });
});
