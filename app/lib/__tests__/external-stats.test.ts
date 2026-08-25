// 公開プロフィールの戦績変換（Speedrun.com / MCSR Ranked / PaceMan）。
// 外部APIの生レスポンス形状 → 表示用の型への変換ロジックを検証する。
// 誤ると黙って誤表示になるため、勝敗判定・相手解決・Elo算出・フォールバックを実値で固定する。
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchMCSRRankedStats,
  fetchSpeedrunComStats,
  checkPaceManPlayer,
  getSpeedrunComVideoEmbedUrl,
  type SpeedrunComPersonalBest,
} from "../external-stats";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** console のノイズ（catch節のログ出力）を抑える。afterEach の restoreAllMocks で戻る */
function silenceConsole() {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

// ============================================
// MCSR Ranked
// ============================================

/** users/:identifier のレスポンスをスタブする */
function rankedUserBody(overrides: Record<string, unknown> = {}) {
  return {
    status: "success",
    data: {
      uuid: "user-uuid",
      nickname: "Runner",
      roleType: 1,
      eloRate: 1500,
      eloRank: 10,
      ...overrides,
    },
  };
}

/** leaderboard?country=jp のレスポンスをスタブする */
function leaderboardBody(users: { uuid?: string }[]) {
  return { status: "success", data: { users } };
}

/** users/:identifier と users/:identifier/matches・leaderboard の3種をURLで振り分けてスタブする */
function stubRankedFetch(opts: {
  user?: unknown;
  userOk?: boolean;
  matches?: unknown;
  matchesOk?: boolean;
  throwOnUser?: Error;
  leaderboard?: unknown;
  leaderboardOk?: boolean;
  throwOnLeaderboard?: Error;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/leaderboard")) {
        if (opts.throwOnLeaderboard) throw opts.throwOnLeaderboard;
        return {
          ok: opts.leaderboardOk ?? true,
          status: opts.leaderboardOk === false ? 500 : 200,
          json: async () => opts.leaderboard ?? { status: "success", data: { users: [] } },
        };
      }
      if (url.includes("/matches")) {
        return {
          ok: opts.matchesOk ?? true,
          status: opts.matchesOk === false ? 500 : 200,
          json: async () => opts.matches ?? { status: "success", data: [] },
        };
      }
      if (opts.throwOnUser) throw opts.throwOnUser;
      return {
        ok: opts.userOk ?? true,
        status: opts.userOk === false ? 500 : 200,
        json: async () => opts.user,
      };
    }),
  );
}

describe("fetchMCSRRankedStats - 登録確認", () => {
  it("ユーザー取得が非2xxなら未登録として扱う", async () => {
    stubRankedFetch({ user: undefined, userOk: false });
    const result = await fetchMCSRRankedStats("nobody");
    expect(result).toEqual({ isRegistered: false, user: null, seasonData: null, recentMatches: [], countryRank: null });
  });

  it("status が success 以外なら未登録として扱う", async () => {
    stubRankedFetch({ user: { status: "fail", data: null } });
    const result = await fetchMCSRRankedStats("nobody");
    expect(result.isRegistered).toBe(false);
  });

  it("data.uuid が無ければ未登録として扱う", async () => {
    stubRankedFetch({ user: { status: "success", data: { nickname: "NoUuid" } } });
    const result = await fetchMCSRRankedStats("nobody");
    expect(result.isRegistered).toBe(false);
  });

  it("fetch が例外を投げた場合は未登録＋エラーメッセージを返す", async () => {
    silenceConsole();
    stubRankedFetch({ throwOnUser: new Error("network down") });
    const result = await fetchMCSRRankedStats("someone");
    expect(result).toEqual({
      isRegistered: false,
      user: null,
      seasonData: null,
      recentMatches: [],
      countryRank: null,
      error: "APIエラーが発生しました",
    });
  });
});

describe("fetchMCSRRankedStats - マッチの勝敗判定と相手解決", () => {
  it("result.uuid が自分なら win、相手なら lose、result 自体が無ければ draw", async () => {
    stubRankedFetch({
      user: rankedUserBody(),
      matches: {
        status: "success",
        data: [
          {
            id: "m-win",
            type: 2,
            season: 1,
            date: 1700000001,
            players: [
              { uuid: "user-uuid", nickname: "Runner" },
              { uuid: "opp-uuid", nickname: "Opp" },
            ],
            result: { uuid: "user-uuid", time: 123456 },
            changes: [{ uuid: "user-uuid", change: 15, eloRate: 1500 }],
          },
          {
            id: "m-lose",
            type: 2,
            season: 1,
            date: 1700000002,
            players: [
              { uuid: "user-uuid", nickname: "Runner" },
              { uuid: "opp-uuid", nickname: "Opp" },
            ],
            result: { uuid: "opp-uuid", time: 111 },
            changes: [{ uuid: "user-uuid", change: -10, eloRate: 1490 }],
          },
          {
            id: "m-draw",
            type: 2,
            season: 1,
            date: 1700000003,
            players: [
              { uuid: "user-uuid", nickname: "Runner" },
              { uuid: "opp-uuid", nickname: "Opp" },
            ],
            result: null,
            changes: [],
          },
        ],
      },
    });

    const result = await fetchMCSRRankedStats("runner");
    const byId = Object.fromEntries(result.recentMatches.map((m) => [m.id, m]));

    expect(byId["m-win"].result).toBe("win");
    expect(byId["m-win"].time).toBe(123456); // 勝者のみtimeが記録される
    expect(byId["m-lose"].result).toBe("lose");
    expect(byId["m-lose"].time).toBeNull(); // 敗者は記録されない
    expect(byId["m-draw"].result).toBe("draw");
  });

  it("players 配列の並びに関わらず自分以外を相手として解決する", async () => {
    stubRankedFetch({
      user: rankedUserBody(),
      matches: {
        status: "success",
        data: [
          {
            // 自分が players[1] にいるケース（相手が players[0]）
            id: "m-self-second",
            type: 2,
            season: 1,
            date: 1700000001,
            players: [
              { uuid: "opp-uuid", nickname: "Opponent" },
              { uuid: "user-uuid", nickname: "Runner" },
            ],
            result: { uuid: "user-uuid", time: 100 },
            changes: [],
          },
        ],
      },
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.recentMatches[0].opponentUuid).toBe("opp-uuid");
    expect(result.recentMatches[0].opponentNickname).toBe("Opponent");
  });

  it("相手の nickname が無ければ Unknown にフォールバックする", async () => {
    stubRankedFetch({
      user: rankedUserBody(),
      matches: {
        status: "success",
        data: [
          {
            id: "m1",
            type: 2,
            season: 1,
            date: 1700000001,
            players: [{ uuid: "user-uuid" }, { uuid: "opp-uuid" }],
            result: { uuid: "user-uuid", time: 1 },
            changes: [],
          },
        ],
      },
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.recentMatches[0].opponentNickname).toBe("Unknown");
  });

  it("changes 配列から自分の eloChange/eloAfter を算出する（欠損時は 0）", async () => {
    stubRankedFetch({
      user: rankedUserBody(),
      matches: {
        status: "success",
        data: [
          {
            id: "with-change",
            type: 2,
            season: 1,
            date: 1700000001,
            players: [{ uuid: "user-uuid" }, { uuid: "opp-uuid" }],
            result: { uuid: "user-uuid", time: 1 },
            changes: [{ uuid: "user-uuid", change: 20, eloRate: 1480 }],
          },
          {
            id: "no-changes-field",
            type: 2,
            season: 1,
            date: 1700000002,
            players: [{ uuid: "user-uuid" }, { uuid: "opp-uuid" }],
            result: { uuid: "user-uuid", time: 1 },
            // changes フィールド自体が無い
          },
          {
            id: "empty-changes",
            type: 2,
            season: 1,
            date: 1700000003,
            players: [{ uuid: "user-uuid" }, { uuid: "opp-uuid" }],
            result: null,
            changes: [], // 自分のエントリが見つからない
          },
        ],
      },
    });

    const result = await fetchMCSRRankedStats("runner");
    const byId = Object.fromEntries(result.recentMatches.map((m) => [m.id, m]));

    expect(byId["with-change"].eloChange).toBe(20);
    expect(byId["with-change"].eloAfter).toBe(1500); // 1480 + 20
    expect(byId["no-changes-field"].eloChange).toBe(0);
    expect(byId["no-changes-field"].eloAfter).toBe(0);
    expect(byId["empty-changes"].eloChange).toBe(0);
    expect(byId["empty-changes"].eloAfter).toBe(0);
  });

  it("type が Ranked(2) 以外・id や players を欠くマッチはフィルタで除外される", async () => {
    stubRankedFetch({
      user: rankedUserBody(),
      matches: {
        status: "success",
        data: [
          { id: "casual", type: 1, players: [{ uuid: "user-uuid" }, { uuid: "opp-uuid" }], result: null },
          { type: 2, players: [{ uuid: "user-uuid" }, { uuid: "opp-uuid" }], result: null }, // id 無し
          { id: "no-players", type: 2, result: null }, // players 無し
          { id: "ok", type: 2, players: [{ uuid: "user-uuid" }, { uuid: "opp-uuid" }], result: null },
        ],
      },
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.recentMatches.map((m) => m.id)).toEqual(["ok"]);
  });

  it("マッチ取得が非2xxでもユーザー情報は返り、recentMatches は空になる", async () => {
    stubRankedFetch({ user: rankedUserBody(), matchesOk: false });
    const result = await fetchMCSRRankedStats("runner");
    expect(result.isRegistered).toBe(true);
    expect(result.recentMatches).toEqual([]);
  });
});

describe("fetchMCSRRankedStats - extractRankedNumber と seasonData 組み立て", () => {
  it("数値を直接持つ場合はそのまま使う", async () => {
    stubRankedFetch({
      user: rankedUserBody({
        statistics: {
          total: { bestTime: 123000 },
          season: {
            bestTime: 100000,
            wins: 5,
            loses: 2,
            highestWinStreak: 3,
            currentWinStreak: 1,
            forfeits: 4,
            playedMatches: 11,
          },
        },
      }),
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.seasonData?.bestTimeAllTime).toBe(123000);
    expect(result.seasonData?.bestTime).toBe(100000);
    expect(result.seasonData?.records).toEqual({ win: 5, lose: 2, draw: 0 });
    expect(result.seasonData?.highestWinStreak).toBe(3);
    expect(result.seasonData?.currentWinStreak).toBe(1);
    expect(result.seasonData?.forfeits).toBe(4);
    expect(result.seasonData?.playedMatches).toBe(11);
  });

  it("{ranked, casual} オブジェクトの場合は ranked 側の値を使う", async () => {
    stubRankedFetch({
      user: rankedUserBody({
        statistics: {
          total: { bestTime: { ranked: 90000, casual: 50000 } },
          season: {
            bestTime: { ranked: 95000, casual: 60000 },
            wins: { ranked: 8, casual: 20 },
            loses: { ranked: 3, casual: 1 },
            forfeits: { ranked: 2, casual: 9 },
            playedMatches: { ranked: 13, casual: 30 },
          },
        },
      }),
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.seasonData?.bestTimeAllTime).toBe(90000);
    expect(result.seasonData?.bestTime).toBe(95000);
    expect(result.seasonData?.records.win).toBe(8);
    expect(result.seasonData?.records.lose).toBe(3);
    expect(result.seasonData?.forfeits).toBe(2);
    expect(result.seasonData?.playedMatches).toBe(13);
  });

  it("null の場合は undefined（bestTime系）または 0（勝敗・連勝数・forfeits/playedMatches）にフォールバックする", async () => {
    stubRankedFetch({
      user: rankedUserBody({
        statistics: {
          total: { bestTime: null },
          season: {
            bestTime: null,
            wins: null,
            loses: null,
            highestWinStreak: null,
            currentWinStreak: null,
            forfeits: null,
            playedMatches: null,
          },
        },
      }),
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.seasonData?.bestTimeAllTime).toBeUndefined();
    expect(result.seasonData?.bestTime).toBeUndefined();
    expect(result.seasonData?.records).toEqual({ win: 0, lose: 0, draw: 0 });
    expect(result.seasonData?.highestWinStreak).toBe(0);
    expect(result.seasonData?.currentWinStreak).toBe(0);
    expect(result.seasonData?.forfeits).toBe(0);
    expect(result.seasonData?.playedMatches).toBe(0);
  });

  it("statistics 自体が無ければ seasonData は null", async () => {
    stubRankedFetch({ user: rankedUserBody() });
    const result = await fetchMCSRRankedStats("runner");
    expect(result.seasonData).toBeNull();
  });
});

describe("fetchMCSRRankedStats - マッチの date フィールド（epoch秒）", () => {
  it("number 型の date はそのまま採用する", async () => {
    stubRankedFetch({
      user: rankedUserBody(),
      matches: {
        status: "success",
        data: [
          {
            id: "m1",
            type: 2,
            season: 1,
            date: 1735689600,
            players: [{ uuid: "user-uuid" }, { uuid: "opp-uuid" }],
            result: null,
            changes: [],
          },
        ],
      },
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.recentMatches[0].date).toBe(1735689600);
  });

  it("number 以外（旧APIのstring等）の date は 0 にフォールバックする", async () => {
    stubRankedFetch({
      user: rankedUserBody(),
      matches: {
        status: "success",
        data: [
          {
            id: "m1",
            type: 2,
            season: 1,
            date: "2024-01-01T00:00:00Z",
            players: [{ uuid: "user-uuid" }, { uuid: "opp-uuid" }],
            result: null,
            changes: [],
          },
        ],
      },
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.recentMatches[0].date).toBe(0);
  });
});

describe("fetchMCSRRankedStats - countryRank（国内Eloランキング順位）", () => {
  it("country=jp かつ eloRate 確定済みで leaderboard.users に自分がいれば index+1 を返す", async () => {
    stubRankedFetch({
      user: rankedUserBody({ country: "jp", eloRate: 1500 }),
      leaderboard: leaderboardBody([
        { uuid: "other-1" },
        { uuid: "user-uuid" },
        { uuid: "other-2" },
      ]),
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.countryRank).toBe(2);
  });

  it("leaderboard.users に自分が含まれない（圏外）場合は null", async () => {
    stubRankedFetch({
      user: rankedUserBody({ country: "jp", eloRate: 1500 }),
      leaderboard: leaderboardBody([{ uuid: "other-1" }, { uuid: "other-2" }]),
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.countryRank).toBeNull();
  });

  it("country が jp 以外なら leaderboard を取得せず countryRank は null", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/matches")) {
        return { ok: true, status: 200, json: async () => ({ status: "success", data: [] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => rankedUserBody({ country: "us", eloRate: 1500 }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMCSRRankedStats("runner");
    expect(result.countryRank).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/leaderboard"))).toBe(false);
  });

  it("country が null なら leaderboard を取得せず countryRank は null", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/matches")) {
        return { ok: true, status: 200, json: async () => ({ status: "success", data: [] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => rankedUserBody({ country: null, eloRate: 1500 }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMCSRRankedStats("runner");
    expect(result.countryRank).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/leaderboard"))).toBe(false);
  });

  it("country=jp でも eloRate が null（未確定）なら leaderboard を取得せず countryRank は null", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/matches")) {
        return { ok: true, status: 200, json: async () => ({ status: "success", data: [] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => rankedUserBody({ country: "jp", eloRate: null }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMCSRRankedStats("runner");
    expect(result.countryRank).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/leaderboard"))).toBe(false);
  });

  it("leaderboard 取得が非2xxでも他のデータは正常に返り countryRank のみ null", async () => {
    stubRankedFetch({
      user: rankedUserBody({ country: "jp", eloRate: 1500 }),
      leaderboardOk: false,
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.isRegistered).toBe(true);
    expect(result.user?.uuid).toBe("user-uuid");
    expect(result.countryRank).toBeNull();
  });

  it("leaderboard 取得が例外を投げても他のデータは正常に返り countryRank のみ null", async () => {
    silenceConsole();
    stubRankedFetch({
      user: rankedUserBody({ country: "jp", eloRate: 1500 }),
      throwOnLeaderboard: new Error("network down"),
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.isRegistered).toBe(true);
    expect(result.countryRank).toBeNull();
  });

  it("leaderboard の status が success 以外なら users 配列があっても countryRank は null", async () => {
    stubRankedFetch({
      user: rankedUserBody({ country: "jp", eloRate: 1500 }),
      leaderboard: { status: "error", data: { users: [{ uuid: "user-uuid" }] } },
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.countryRank).toBeNull();
  });

  it("leaderboard.data.users が配列でなければ countryRank は null", async () => {
    stubRankedFetch({
      user: rankedUserBody({ country: "jp", eloRate: 1500 }),
      leaderboard: { status: "success", data: {} },
    });

    const result = await fetchMCSRRankedStats("runner");
    expect(result.countryRank).toBeNull();
  });
});

// ============================================
// Speedrun.com
// ============================================

/** users?lookup=... と users/:id/personal-bests の両方をURLで振り分けてスタブする */
function stubSpeedrunFetch(opts: {
  userOk?: boolean;
  users?: unknown[];
  pbOk?: boolean;
  pbData?: unknown;
  throwOnUserLookup?: Error;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (opts.throwOnUserLookup) throw opts.throwOnUserLookup;
      if (url.includes("/personal-bests")) {
        return {
          ok: opts.pbOk ?? true,
          json: async () => ({ data: opts.pbData ?? [] }),
        };
      }
      return {
        ok: opts.userOk ?? true,
        json: async () => ({ data: opts.users ?? [] }),
      };
    }),
  );
}

function speedrunUser(overrides: Record<string, unknown> = {}) {
  return { id: "u1", names: { international: "Runner" }, weblink: "https://speedrun.com/u1", ...overrides };
}

function pbFixture(overrides: Partial<SpeedrunComPersonalBest> = {}): SpeedrunComPersonalBest {
  return {
    place: 1,
    run: {
      id: "run1",
      weblink: "https://speedrun.com/run1",
      game: "game1",
      category: "cat1",
      date: "2024-01-01",
      times: { primary_t: 600 },
      system: { platform: "plat1" },
      values: { var1: "val1" },
    },
    game: {
      data: {
        id: "game1",
        names: { international: "Minecraft: Java Edition" },
        abbreviation: "mc",
        platforms: { data: [{ id: "plat1", name: "PC" }] },
      },
    },
    category: {
      data: {
        id: "cat1",
        name: "Any%",
        variables: {
          data: [
            {
              id: "var1",
              name: "Version",
              values: { values: { val1: { label: "1.16.1" } } },
            },
          ],
        },
      },
    },
    ...overrides,
  } as SpeedrunComPersonalBest;
}

describe("fetchSpeedrunComStats - ユーザー・記録取得の失敗系", () => {
  it("ユーザー検索が非2xxならエラーを返す", async () => {
    stubSpeedrunFetch({ userOk: false });
    const result = await fetchSpeedrunComStats("nobody");
    expect(result).toEqual({ user: null, personalBests: [], error: "ユーザーが見つかりません" });
  });

  it("ユーザーが0件でもエラーを返す", async () => {
    stubSpeedrunFetch({ users: [] });
    const result = await fetchSpeedrunComStats("nobody");
    expect(result).toEqual({ user: null, personalBests: [], error: "ユーザーが見つかりません" });
  });

  it("PB取得が非2xxならユーザー情報付きでエラーを返す", async () => {
    const user = speedrunUser();
    stubSpeedrunFetch({ users: [user], pbOk: false });
    const result = await fetchSpeedrunComStats("runner");
    expect(result).toEqual({ user, personalBests: [], error: "記録の取得に失敗しました" });
  });

  it("PBが0件ならエラー無しで空配列を返す", async () => {
    const user = speedrunUser();
    stubSpeedrunFetch({ users: [user], pbData: [] });
    const result = await fetchSpeedrunComStats("runner");
    expect(result).toEqual({ user, personalBests: [] });
  });

  it("fetch が例外を投げたらエラーを返す", async () => {
    silenceConsole();
    stubSpeedrunFetch({ throwOnUserLookup: new Error("network down") });
    const result = await fetchSpeedrunComStats("runner");
    expect(result).toEqual({ user: null, personalBests: [], error: "APIエラーが発生しました" });
  });
});

describe("fetchSpeedrunComStats - platformName/versionName の解決", () => {
  it("system.platform と game.platforms.data から platformName を解決する", async () => {
    stubSpeedrunFetch({ users: [speedrunUser()], pbData: [pbFixture()] });
    const result = await fetchSpeedrunComStats("runner");
    expect(result.personalBests[0].platformName).toBe("PC");
  });

  it("variables から 'version' を含む変数名（英語）で versionName を解決する", async () => {
    stubSpeedrunFetch({ users: [speedrunUser()], pbData: [pbFixture()] });
    const result = await fetchSpeedrunComStats("runner");
    expect(result.personalBests[0].versionName).toBe("1.16.1");
  });

  it("variables から 'バージョン' を含む変数名（日本語）でも versionName を解決する", async () => {
    const pb = pbFixture({
      category: {
        data: {
          id: "cat1",
          name: "Any%",
          variables: {
            data: [
              {
                id: "var1",
                name: "バージョン",
                values: { values: { val1: { label: "1.16.1" } } },
              },
            ],
          },
        },
      },
    });
    stubSpeedrunFetch({ users: [speedrunUser()], pbData: [pb] });
    const result = await fetchSpeedrunComStats("runner");
    expect(result.personalBests[0].versionName).toBe("1.16.1");
  });

  it("該当する platform/variable が無ければ platformName/versionName は undefined", async () => {
    const pb = pbFixture({
      run: {
        id: "run2",
        weblink: "https://speedrun.com/run2",
        game: "game1",
        category: "cat1",
        date: "2024-01-01",
        times: { primary_t: 600 },
        // system.platform も values も無い
      },
    });
    stubSpeedrunFetch({ users: [speedrunUser()], pbData: [pb] });
    const result = await fetchSpeedrunComStats("runner");
    expect(result.personalBests[0].platformName).toBeUndefined();
    expect(result.personalBests[0].versionName).toBeUndefined();
  });
});

describe("fetchSpeedrunComStats - Minecraft系フィルタとフォールバック", () => {
  it("abbreviation か names.international に Minecraft を含む記録だけに絞り込む", async () => {
    const minecraftPb = pbFixture();
    const otherPb = pbFixture({
      run: { ...pbFixture().run, id: "run-other" },
      game: {
        data: {
          id: "game2",
          names: { international: "Super Mario World" },
          abbreviation: "smw",
        },
      },
    });

    stubSpeedrunFetch({ users: [speedrunUser()], pbData: [minecraftPb, otherPb] });
    const result = await fetchSpeedrunComStats("runner");

    expect(result.personalBests).toHaveLength(1);
    expect(result.personalBests[0].run.id).toBe("run1");
  });

  it("Minecraft系が0件なら絞り込まず全PBを返す", async () => {
    const otherPb1 = pbFixture({
      run: { ...pbFixture().run, id: "run-a" },
      game: { data: { id: "game2", names: { international: "Celeste" }, abbreviation: "celeste" } },
    });
    const otherPb2 = pbFixture({
      run: { ...pbFixture().run, id: "run-b" },
      game: { data: { id: "game3", names: { international: "Hollow Knight" }, abbreviation: "hk" } },
    });

    stubSpeedrunFetch({ users: [speedrunUser()], pbData: [otherPb1, otherPb2] });
    const result = await fetchSpeedrunComStats("runner");

    expect(result.personalBests).toHaveLength(2);
    expect(result.personalBests.map((pb) => pb.run.id)).toEqual(["run-a", "run-b"]);
  });
});

// ============================================
// getSpeedrunComVideoEmbedUrl（純関数）
// ============================================

describe("getSpeedrunComVideoEmbedUrl", () => {
  it("YouTubeリンクがあれば埋め込みURLに変換する", () => {
    const pb = pbFixture({
      run: {
        ...pbFixture().run,
        videos: { links: [{ uri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }] },
      },
    });
    expect(getSpeedrunComVideoEmbedUrl(pb)).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("複数リンクのうち最初にYouTubeへ変換できたものを返す", () => {
    const pb = pbFixture({
      run: {
        ...pbFixture().run,
        videos: {
          links: [
            { uri: "https://www.twitch.tv/videos/12345" },
            { uri: "https://youtu.be/abcdefghijk" },
          ],
        },
      },
    });
    expect(getSpeedrunComVideoEmbedUrl(pb)).toBe("https://www.youtube.com/embed/abcdefghijk");
  });

  it("YouTube以外のリンクしか無い場合は null", () => {
    const pb = pbFixture({
      run: { ...pbFixture().run, videos: { links: [{ uri: "https://www.twitch.tv/videos/12345" }] } },
    });
    expect(getSpeedrunComVideoEmbedUrl(pb)).toBeNull();
  });

  it("動画リンク自体が無い場合は null", () => {
    const pb = pbFixture({ run: { ...pbFixture().run, videos: undefined } });
    expect(getSpeedrunComVideoEmbedUrl(pb)).toBeNull();
  });
});

// ============================================
// PaceMan（登録確認のみ）
// ============================================

describe("checkPaceManPlayer", () => {
  it("エラーフィールドが無いレスポンスは登録済みと判定する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ someField: 1 }) })));
    const result = await checkPaceManPlayer("runner");
    expect(result).toEqual({ isRegistered: true });
  });

  it("error フィールドを含むレスポンスは未登録と判定する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ error: "Unknown user" }) })),
    );
    const result = await checkPaceManPlayer("nobody");
    expect(result).toEqual({ isRegistered: false });
  });

  it("非2xxやfetch例外も未登録として扱う", async () => {
    silenceConsole();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await checkPaceManPlayer("runner");
    expect(result).toEqual({ isRegistered: false });
  });
});
