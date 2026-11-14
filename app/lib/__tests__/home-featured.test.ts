import { describe, it, expect } from "vitest";
import {
  dailyPickIndex,
  pickFeaturedCandidates,
  scoreFeaturedReason,
  type FeaturedEvent,
} from "../home-featured";
import { formatClock, formatClockSeconds } from "../home-format";
import { sanitizeTwitchUrl, splitStage } from "../home-live";
import { buildRankedLiveMatches, normalizeUuid } from "../ranked-live.server";

describe("scoreFeaturedReason / pickFeaturedCandidates", () => {
  it("1人につき最も点数の高い出来事を理由にし、点数順（同点は新しい順）に最大5人まで返す", () => {
    const events: FeaturedEvent[] = [
      { userId: "a", reason: { type: "video" }, at: 100 },
      { userId: "a", reason: { type: "speedruncom", timeMs: 600000, categoryName: null, status: "new" }, at: 50 },
      { userId: "b", reason: { type: "rankedPb", timeMs: 500000 }, at: 10 },
      { userId: "c", reason: { type: "video" }, at: 300 },
      { userId: "d", reason: { type: "video" }, at: 200 },
      { userId: "e", reason: { type: "eloGain", gain: 400 }, at: 1 },
      { userId: "f", reason: { type: "video" }, at: 5 },
      { userId: "g", reason: { type: "video" }, at: 4 },
    ];
    const picks = pickFeaturedCandidates(events);
    expect(picks.map((p) => p.userId)).toEqual(["e", "a", "b", "c", "d"]);
    expect(picks[1].reason.type).toBe("speedruncom");
  });

  it("レート上昇は 300 で頭打ち（最大 100 点）", () => {
    expect(scoreFeaturedReason({ type: "eloGain", gain: 300 })).toBe(100);
    expect(scoreFeaturedReason({ type: "eloGain", gain: 9999 })).toBe(100);
    expect(scoreFeaturedReason({ type: "eloGain", gain: 20 })).toBe(44);
  });

  it("出来事が無ければ空配列", () => {
    expect(pickFeaturedCandidates([])).toEqual([]);
  });
});

describe("dailyPickIndex", () => {
  it("同じ日付・人数なら同じ添字、範囲内に収まる。0人は -1", () => {
    expect(dailyPickIndex("2026-11-14", 7)).toBe(dailyPickIndex("2026-11-14", 7));
    for (const d of ["2026-11-14", "2026-11-15", "2026-12-01"]) {
      const i = dailyPickIndex(d, 5);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(5);
    }
    expect(dailyPickIndex("2026-11-14", 0)).toBe(-1);
  });
});

describe("formatClock", () => {
  it("m:ss、1時間以上は h:mm:ss、不正値は -", () => {
    expect(formatClock(522_000)).toBe("8:42");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClockSeconds(3725)).toBe("1:02:05");
    expect(formatClock(Number.NaN)).toBe("-");
  });
});

describe("splitStage", () => {
  it("PaceMan のスプリットID・タイムライン名を進行バーの到達点に対応づける", () => {
    expect(splitStage("rsg.enter_nether")).toBe(1);
    expect(splitStage("First Portal")).toBe(4);
    expect(splitStage("rsg.second_portal")).toBe(4);
    expect(splitStage("rsg.credits")).toBe(7);
    expect(splitStage("unknown")).toBe(0);
  });
});

describe("sanitizeTwitchUrl", () => {
  it("Twitch の URL だけ通す", () => {
    expect(sanitizeTwitchUrl("https://twitch.tv/foo")).toBe("https://www.twitch.tv/foo");
    expect(sanitizeTwitchUrl("https://www.youtube.com/watch?v=1")).toBeNull();
    expect(sanitizeTwitchUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeTwitchUrl(null)).toBeNull();
  });
});

describe("buildRankedLiveMatches", () => {
  const registered = new Map([
    [
      "069a79f444e94726a5befca90e38aaf5",
      { mcid: "Foo", slug: "foo", uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", displayName: null, displayNameAlphabet: null, skinUrl: null },
    ],
  ]);
  it("Minefolio 登録者が出ている試合だけをカードにし、相手・レート・Twitch の liveUrl を載せる", () => {
    const matches = buildRankedLiveMatches(
      {
        status: "success",
        data: {
          liveMatches: [
            {
              currentTime: 125000,
              players: [
                { uuid: "069a79f444e94726a5befca90e38aaf5", nickname: "Foo", eloRate: 1500 },
                { uuid: "ffffffffffffffffffffffffffffffff", nickname: "Bar", eloRate: 1450 },
              ],
              data: {
                "069a79f444e94726a5befca90e38aaf5": { liveUrl: "https://twitch.tv/foo" },
              },
            },
            {
              currentTime: 1,
              players: [
                { uuid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nickname: "X", eloRate: 1 },
                { uuid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", nickname: "Y", eloRate: 2 },
              ],
              data: {},
            },
          ],
        },
      },
      registered,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      slug: "foo",
      eloRate: 1500,
      currentTimeMs: 125000,
      liveUrl: "https://www.twitch.tv/foo",
      opponent: { nickname: "Bar", eloRate: 1450 },
    });
  });

  it("応答が不正なら空配列、UUID はハイフン有無を同一視する", () => {
    expect(buildRankedLiveMatches(null, registered)).toEqual([]);
    expect(normalizeUuid("069A79F4-44E9-4726-A5BE-FCA90E38AAF5")).toBe("069a79f444e94726a5befca90e38aaf5");
  });
});
