import { describe, it, expect } from "vitest";
import {
  dailyPickIndex,
  officialCategorySlug,
  pickFeaturedCandidates,
  pickOfficialPb,
  scoreFeaturedReason,
  type FeaturedEvent,
} from "../home-featured";
import { formatClock, formatClockSeconds } from "../home-format";
import { normalizeUuid, rankedSplitName, rankedStage, sanitizeTwitchUrl, splitStage } from "../home-live";
import { buildRankedLiveMatches } from "../ranked-live.server";

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

  it("Obtain Blaze Rods（pacemanPaces.timeline の区間名）は Fortress と同じ段階（3）", () => {
    expect(splitStage("Obtain Blaze Rods")).toBe(3);
    expect(splitStage("Fortress")).toBe(3);
  });

  it("タイムライン名とスプリットID の両方が同じ段階に解決される", () => {
    for (const [id, name] of [
      ["rsg.enter_nether", "Enter Nether"],
      ["rsg.enter_bastion", "Bastion"],
      ["rsg.enter_fortress", "Fortress"],
      ["rsg.first_portal", "First Portal"],
      ["rsg.second_portal", "Second Portal"],
      ["rsg.enter_stronghold", "Enter Stronghold"],
      ["rsg.enter_end", "Enter End"],
      ["rsg.credits", "Finish"],
    ] as const) {
      expect(splitStage(id)).toBe(splitStage(name));
      expect(splitStage(name)).toBeGreaterThan(0);
    }
  });
});

describe("rankedStage / rankedSplitName", () => {
  it("Ranked の timeline.type を進行バーの到達点と区間名に対応づける", () => {
    const cases: [string, number, string][] = [
      ["story.enter_the_nether", 1, "Enter Nether"],
      ["nether.find_bastion", 2, "Bastion"],
      ["nether.find_fortress", 3, "Fortress"],
      ["projectelo.timeline.blind_travel", 4, "First Portal"],
      ["story.follow_ender_eye", 5, "Enter Stronghold"],
      ["story.enter_the_end", 6, "Enter End"],
    ];
    for (const [type, stage, split] of cases) {
      expect(rankedStage(type)).toBe(stage);
      expect(rankedSplitName(type)).toBe(split);
    }
  });
  it("未知の type・null は 0 / null", () => {
    expect(rankedStage("unknown.type")).toBe(0);
    expect(rankedStage(null)).toBe(0);
    expect(rankedSplitName("unknown.type")).toBeNull();
    expect(rankedSplitName(undefined)).toBeNull();
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

  it("両選手の最新 timeline を拾う（ハイフン有りキー・timeline 無し・未知 type は null）", () => {
    const match = (data: Record<string, unknown>) =>
      buildRankedLiveMatches(
        {
          status: "success",
          data: {
            liveMatches: [
              {
                currentTime: 400000,
                players: [
                  { uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", nickname: "Foo", eloRate: 1500 },
                  { uuid: "ffffffffffffffffffffffffffffffff", nickname: "Bar", eloRate: 1450 },
                ],
                data: data as never,
              },
            ],
          },
        },
        registered,
      )[0];

    const both = match({
      "069a79f4-44e9-4726-a5be-fca90e38aaf5": { liveUrl: null, timeline: { time: 312000, type: "nether.find_fortress" } },
      ffffffffffffffffffffffffffffffff: { liveUrl: null, timeline: { time: 200000, type: "nether.find_bastion" } },
    });
    expect(both.progress).toEqual({ stage: 3, split: "Fortress", timeMs: 312000 });
    expect(both.opponent.progress).toEqual({ stage: 2, split: "Bastion", timeMs: 200000 });

    const none = match({
      "069a79f444e94726a5befca90e38aaf5": { liveUrl: null, timeline: null },
      ffffffffffffffffffffffffffffffff: { liveUrl: null, timeline: { time: 1, type: "some.unknown" } },
    });
    expect(none.progress).toBeNull();
    expect(none.opponent.progress).toBeNull();
    expect(match({}).progress).toBeNull();
  });

  it("応答が不正なら空配列、UUID はハイフン有無を同一視する", () => {
    expect(buildRankedLiveMatches(null, registered)).toEqual([]);
    expect(normalizeUuid("069A79F4-44E9-4726-A5BE-FCA90E38AAF5")).toBe("069a79f444e94726a5befca90e38aaf5");
  });
});

describe("officialCategorySlug", () => {
  it("(カテゴリ, バージョン) が1つに対応するときだけ slug を返す", () => {
    expect(officialCategorySlug("rsg", "java:1_16_1_19")).toBe("java-rsg-1.16-1.19");
    expect(officialCategorySlug("ssg", "java:1_16_1_19")).toBe("java-ssg-1.16-1.19");
    expect(officialCategorySlug("ssg", "java:1_20_plus")).toBe("java-ssg-1.20");
  });

  it("バージョン未設定・Bedrock・範囲外・対応の無いカテゴリは null", () => {
    expect(officialCategorySlug("rsg", null)).toBeNull();
    expect(officialCategorySlug("rsg", "java:1_20_plus")).toBeNull(); // RSG 1.20+ の定義は無い
    expect(officialCategorySlug("rsg", "java:1_13_1_15")).toBeNull();
    expect(officialCategorySlug("rsg", "bedrock:1_18")).toBeNull();
    for (const c of ["aa", "ce", "ranked", "other", null]) {
      expect(officialCategorySlug(c, "java:1_16_1_19")).toBeNull();
    }
  });
});

describe("pickOfficialPb", () => {
  const base = { showRankedStats: true, rankedAllTimeMs: null, srcRuns: [] };

  it("ranked は全期間ベスト。非表示設定の人・記録なしは null", () => {
    expect(pickOfficialPb({ ...base, mainCategory: "ranked", rankedAllTimeMs: 600000 })).toBe(600000);
    expect(pickOfficialPb({ ...base, mainCategory: "ranked", showRankedStats: null, rankedAllTimeMs: 600000 })).toBe(600000);
    expect(pickOfficialPb({ ...base, mainCategory: "ranked", showRankedStats: false, rankedAllTimeMs: 600000 })).toBeNull();
    expect(pickOfficialPb({ ...base, mainCategory: "ranked" })).toBeNull();
  });

  it("speedrun.com は verified の最速だけ（new / rejected / 時間なしは無視）", () => {
    const srcRuns = [
      { timeMs: 700000, verificationStatus: "verified" },
      { timeMs: 650000, verificationStatus: "verified" },
      { timeMs: 500000, verificationStatus: "new" },
      { timeMs: 400000, verificationStatus: "rejected" },
      { timeMs: null, verificationStatus: "verified" },
    ];
    expect(pickOfficialPb({ ...base, mainCategory: "rsg", srcRuns })).toBe(650000);
    expect(pickOfficialPb({ ...base, mainCategory: "rsg", srcRuns: srcRuns.slice(2) })).toBeNull();
    expect(pickOfficialPb({ ...base, mainCategory: null, rankedAllTimeMs: 1 })).toBeNull();
  });
});
