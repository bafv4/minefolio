// ライブ欄の並び順（本家に倣う）と、消えたカードを「終了」として残す純関数
import { describe, expect, it } from "vitest";
import {
  LIVE_DIFF_MAX_GAP_MS,
  LIVE_ENDED_HOLD_MS,
  advanceLiveEnded,
  applyRankedResult,
  compareLiveEntries,
  initialLiveEndedState,
  insertEndedAtPrevIndex,
  isFinishedRun,
  judgeRankedResult,
  liveSortKey,
  paceBestKey,
  paceElapsedRtaMs,
  SECOND_STRUCTURE_BEST_KEY,
  pruneLiveEnded,
  rankedOpponentUuid,
  type LiveEndedState,
  type LiveSortEntry,
  type RankedLiveMatch,
} from "../home-live";
import type { PaceManLiveRun } from "../paceman";

function run(nickname: string, worldId: string, events: [string, number][] = []): PaceManLiveRun {
  return {
    worldId,
    gameVersion: "1.16.1",
    eventList: events.map(([eventId, igt]) => ({ eventId, igt, rta: igt })),
    contextEventList: [],
    user: { uuid: "u", liveAccount: null },
    nickname,
    lastUpdated: 0,
    isCheated: false,
    isHidden: false,
    numLeaves: 0,
  };
}
function match(mcid: string, uuid: string, opp: string, split: string | null, timeMs = 0, currentTimeMs = 1000): RankedLiveMatch {
  return {
    key: `${uuid}-${opp}`,
    mcid,
    slug: mcid,
    uuid,
    displayName: null,
    displayNameAlphabet: null,
    skinUrl: null,
    eloRate: 1000,
    opponent: { nickname: "o", eloRate: 1000, progress: null },
    progress: split ? { stage: 1, split, timeMs } : null,
    currentTimeMs,
    liveUrl: null,
  };
}
const pace = (r: PaceManLiveRun): LiveSortEntry => ({ kind: "pace", run: r });
const ranked = (m: RankedLiveMatch): LiveSortEntry => ({ kind: "ranked", match: m });

describe("liveSortKey / compareLiveEntries", () => {
  it("PaceMan の構造物は到達順で数える（1つ目=2、2つ目=3）", () => {
    expect(liveSortKey(pace(run("a", "w", [["rsg.enter_nether", 1], ["rsg.enter_bastion", 2]])))).toEqual({ depth: 2, timeMs: 2 });
    // Fortress が1つ目（Bastion 無し）でも 2
    expect(liveSortKey(pace(run("a", "w", [["rsg.enter_nether", 1], ["rsg.enter_fortress", 2]])))?.depth).toBe(2);
    // 両方あれば 3
    expect(
      liveSortKey(pace(run("a", "w", [["rsg.enter_bastion", 2], ["rsg.enter_fortress", 3]])))?.depth,
    ).toBe(3);
    expect(liveSortKey(pace(run("a", "w", [["rsg.first_portal", 5]])))?.depth).toBe(4);
    expect(liveSortKey(pace(run("a", "w", [["rsg.second_portal", 6]])))?.depth).toBe(4);
    expect(liveSortKey(pace(run("a", "w", [["rsg.credits", 9]])))?.depth).toBe(7);
  });

  it("深い順 → 同じ深さなら速い順。PaceMan と Ranked を混ぜる", () => {
    const list: LiveSortEntry[] = [
      ranked(match("r1", "a", "b", "First Portal", 380000)),
      pace(run("p1", "w1", [["rsg.enter_nether", 113000]])),
      pace(run("p2", "w2", [["rsg.first_portal", 300000]])),
      pace(run("p3", "w3", [["rsg.enter_nether", 90000]])),
    ];
    const sorted = [...list].sort(compareLiveEntries);
    expect(sorted.map((e) => (e.kind === "pace" ? e.run.nickname : e.kind === "ranked" ? (e.match as RankedLiveMatch).mcid : "?"))).toEqual([
      "p2", // Blind 5:00
      "r1", // Blind 6:20
      "p3", // Nether 1:30
      "p1", // Nether 1:53
    ]);
  });

  it("区間の無い項目は区間ありの後・Twitch の前。Ranked は経過時間の長い順", () => {
    const sorted = [
      { kind: "twitch" } as LiveSortEntry,
      ranked(match("short", "a", "b", null, 0, 1000)),
      ranked(match("long", "c", "d", null, 0, 5000)),
      pace(run("p", "w", [["rsg.enter_nether", 1]])),
    ].sort(compareLiveEntries);
    expect(sorted.map((e) => (e.kind === "ranked" ? (e.match as RankedLiveMatch).mcid : e.kind))).toEqual(["pace", "long", "short", "twitch"]);
  });

  it("同点は入力順を保つ（安定）", () => {
    const a = pace(run("a", "w1", [["rsg.enter_nether", 100]]));
    const b = pace(run("b", "w2", [["rsg.enter_nether", 100]]));
    expect([b, a].sort(compareLiveEntries)).toEqual([b, a]);
    expect([a, b].sort(compareLiveEntries)).toEqual([a, b]);
  });

  it("お気に入り先頭の安定ソートでもグループ内の順を保つ", () => {
    const list = [
      { e: pace(run("x", "w1", [["rsg.first_portal", 1]])), fav: false },
      { e: pace(run("f", "w2", [["rsg.enter_nether", 1]])), fav: true },
      { e: pace(run("y", "w3", [["rsg.enter_nether", 2]])), fav: false },
    ].sort((a, b) => compareLiveEntries(a.e, b.e));
    const favFirst = [...list].sort((a, b) => Number(b.fav) - Number(a.fav));
    expect(favFirst.map((x) => (x.e.kind === "pace" ? x.e.run.nickname : ""))).toEqual(["f", "x", "y"]);
  });
});

describe("isFinishedRun", () => {
  it("rsg.credits があれば完走", () => {
    expect(isFinishedRun(run("a", "w", [["rsg.credits", 1]]))).toBe(true);
    expect(isFinishedRun(run("a", "w", [["rsg.enter_end", 1]]))).toBe(false);
  });
});

describe("paceElapsedRtaMs", () => {
  it("全イベント（contextEventList 含む）の最大 rta に lastUpdated からの経過を足す", () => {
    const r = {
      ...run("a", "w", [["rsg.enter_nether", 100_000], ["rsg.enter_bastion", 150_000]]),
      contextEventList: [{ eventId: "rsg.loot_bastion", igt: 230_000, rta: 233_000 }],
      lastUpdated: 5_000_000,
    };
    expect(paceElapsedRtaMs(r, 5_000_000 + 175_000)).toBe(233_000 + 175_000);
  });

  it("時計のずれで lastUpdated が未来でも負にしない・イベントが無ければ null", () => {
    expect(paceElapsedRtaMs({ ...run("a", "w", [["rsg.enter_nether", 90_000]]), lastUpdated: 10_000 }, 9_000)).toBe(90_000);
    expect(paceElapsedRtaMs(run("a", "w"), 0)).toBeNull();
  });
});

describe("paceBestKey", () => {
  it("2つ目の構造物は種類別ではなく Second Structure のベストを引く（どちらの順でも）", () => {
    const bastionThenFortress = run("a", "w", [["rsg.enter_nether", 1], ["rsg.enter_bastion", 2], ["rsg.enter_fortress", 3]]);
    expect(paceBestKey(bastionThenFortress, "Fortress")).toBe(SECOND_STRUCTURE_BEST_KEY);
    const fortressThenBastion = run("a", "w", [["rsg.enter_nether", 1], ["rsg.enter_fortress", 2], ["rsg.enter_bastion", 3]]);
    expect(paceBestKey(fortressThenBastion, "Bastion")).toBe(SECOND_STRUCTURE_BEST_KEY);
    // 構造物以外の区間はそのまま
    expect(paceBestKey(run("a", "w", [["rsg.first_portal", 5]]), "First Portal")).toBe("First Portal");
  });
});

describe("paceBestKey（ベスト比を出す区間か）", () => {
  it("2つ目の構造物以降だけ（構造物は到達順で数える。出さない区間は null）", () => {
    expect(paceBestKey(run("a", "w", [["rsg.enter_nether", 1]]), "Enter Nether")).toBeNull();
    // 1つ目の構造物は Fortress でも出さない
    expect(paceBestKey(run("a", "w", [["rsg.enter_nether", 1], ["rsg.enter_fortress", 2]]), "Fortress")).toBeNull();
    expect(paceBestKey(run("a", "w", [["rsg.enter_nether", 1], ["rsg.enter_bastion", 2]]), "Bastion")).toBeNull();
    // 2つ目の構造物は Bastion でも出す
    expect(
      paceBestKey(run("a", "w", [["rsg.enter_nether", 1], ["rsg.enter_fortress", 2], ["rsg.enter_bastion", 3]]), "Bastion"),
    ).not.toBeNull();
    expect(paceBestKey(run("a", "w", [["rsg.first_portal", 5]]), "First Portal")).not.toBeNull();
  });
});

const T0 = 1_000_000;
const A = "a".repeat(32);
const B = "b".repeat(32);
const step = (s: LiveEndedState, now: number, runs: PaceManLiveRun[], matches: RankedLiveMatch[] | null) =>
  advanceLiveEnded(s, { now, runs, matches: matches ? { list: matches, fetchedAt: now } : null });

describe("advanceLiveEnded", () => {
  const r1 = run("Foo", "w1", [["rsg.enter_nether", 1]]);

  it("初回は差分を取らない", () => {
    const s = step(initialLiveEndedState, T0, [r1], []);
    expect(s.ended).toEqual([]);
  });

  it("前回あって今回無い PaceMan ランを終了として残す（index は直前の並び位置）", () => {
    const r2 = run("Bar", "w2", [["rsg.first_portal", 1]]);
    let s = step(initialLiveEndedState, T0, [r1, r2], []);
    s = step(s, T0 + 15_000, [r2], []);
    expect(s.ended).toHaveLength(1);
    expect(s.ended[0]).toMatchObject({ kind: "pace", id: "pace:w1", endedAt: T0 + 15_000, index: 1 });
  });

  it("完走済み（credits 付き）は保持しない", () => {
    const done = run("Foo", "w9", [["rsg.credits", 1]]);
    let s = step(initialLiveEndedState, T0, [done], []);
    s = step(s, T0 + 15_000, [], []);
    expect(s.ended).toEqual([]);
  });

  it("前回成功から長く空いたときは差分を取らない", () => {
    let s = step(initialLiveEndedState, T0, [r1], []);
    s = step(s, T0 + LIVE_DIFF_MAX_GAP_MS + 1, [], []);
    expect(s.ended).toEqual([]);
  });

  it("1回だけ取得に失敗した直後（空き 約30秒）でも差分を取る", () => {
    let s = step(initialLiveEndedState, T0, [r1], []);
    s = step(s, T0 + 31_000, [], []);
    expect(s.ended).toHaveLength(1);
  });

  it("Ranked 取得失敗（null）では Ranked の差分を取らず、直前の一覧を保つ", () => {
    const m = match("Foo", A, B, null);
    let s = step(initialLiveEndedState, T0, [], [m]);
    s = step(s, T0 + 15_000, [], null);
    expect(s.ended).toEqual([]);
    expect(s.matches?.list).toEqual([m]);
    // 回復して試合が無ければ、その時点で終了（取得失敗の間も gap 内）
    s = step(s, T0 + 30_000, [], []);
    expect(s.ended[0]).toMatchObject({ kind: "ranked", id: `ranked:${A}-${B}`, result: null });
  });

  it("Ranked は試合開始を 取得時刻 − 経過時間 で推定する", () => {
    const m = match("Foo", A, B, null, 0, 90_000);
    let s = step(initialLiveEndedState, T0, [], [m]);
    s = step(s, T0 + 15_000, [], []);
    expect(s.ended[0]).toMatchObject({ kind: "ranked", startedAtMs: T0 - 90_000 });
  });

  it("同じ id が戻ったら live に戻す（終了から外す）", () => {
    let s = step(initialLiveEndedState, T0, [r1], []);
    s = step(s, T0 + 15_000, [], []);
    expect(s.ended).toHaveLength(1);
    s = step(s, T0 + 30_000, [r1], []);
    expect(s.ended).toEqual([]);
  });

  it("同じ人の新しいライブ（PaceMan・Ranked どちらでも）が出たら終了カードを捨てる", () => {
    let s = step(initialLiveEndedState, T0, [r1], []);
    s = step(s, T0 + 15_000, [], []);
    expect(s.ended).toHaveLength(1);
    // 大文字小文字違いの Ranked 試合
    s = step(s, T0 + 30_000, [], [match("foo", A, B, null)]);
    expect(s.ended).toEqual([]);
    // 新しい PaceMan ラン（別 worldId）が出た時点で、同時に消えた旧ランも残さない
    let s2 = step(initialLiveEndedState, T0, [r1], []);
    s2 = step(s2, T0 + 15_000, [run("FOO", "w-new", [])], []);
    expect(s2.ended).toEqual([]);
  });

  it("保持時間を過ぎた終了カードは次の取り込みで除かれる", () => {
    let s = step(initialLiveEndedState, T0, [r1], []);
    s = step(s, T0 + 15_000, [], []);
    s = step(s, T0 + 15_000 + LIVE_ENDED_HOLD_MS - 1, [], []);
    expect(s.ended).toHaveLength(1);
    s = step(s, T0 + 15_000 + LIVE_ENDED_HOLD_MS, [], []);
    expect(s.ended).toEqual([]);
  });

  it("pruneLiveEnded は期限切れだけを除く", () => {
    let s = step(initialLiveEndedState, T0, [r1], []);
    s = step(s, T0 + 15_000, [], []);
    expect(pruneLiveEnded(s, T0 + 15_000 + LIVE_ENDED_HOLD_MS).ended).toEqual([]);
    expect(pruneLiveEnded(s, T0 + 20_000)).toBe(s);
  });
});

describe("applyRankedResult / insertEndedAtPrevIndex", () => {
  it("結果は id と endedAt が一致する終了カードにだけ載る", () => {
    const m = match("Foo", A, B, null);
    let s = step(initialLiveEndedState, T0, [], [m]);
    s = step(s, T0 + 15_000, [], []);
    const result = { outcome: "win" as const, forfeited: false, timeMs: 1, eloChange: 5 };
    expect(applyRankedResult(s, `ranked:${A}-${B}`, 1, result)).toBe(s);
    const applied = applyRankedResult(s, `ranked:${A}-${B}`, T0 + 15_000, result);
    expect(applied.ended[0]).toMatchObject({ result });
  });

  it("終了項目を直前の位置へ差し込む（範囲外・不明は末尾）", () => {
    expect(insertEndedAtPrevIndex(["a", "b"], [{ item: "X", index: 1 }])).toEqual(["a", "X", "b"]);
    expect(insertEndedAtPrevIndex(["a"], [{ item: "X", index: 5 }, { item: "Y", index: -1 }])).toEqual(["a", "X", "Y"]);
  });
});

describe("judgeRankedResult / rankedOpponentUuid", () => {
  const base = {
    date: 2000,
    result: { uuid: A, time: 650000 },
    forfeited: false,
    changes: [{ uuid: A, change: 14 }, { uuid: B, change: -14 }],
    players: [{ uuid: A }, { uuid: B }],
  };
  const args = { uuid: A, opponent: B, sinceMs: 1_990_000 };

  it("勝利: 完走タイムとレート増減", () => {
    expect(judgeRankedResult(base, args)).toEqual({ outcome: "win", forfeited: false, timeMs: 650000, eloChange: 14 });
  });
  it("敗北: タイム無し・減少", () => {
    const r = judgeRankedResult({ ...base, result: { uuid: B, time: 1 } }, args);
    expect(r).toMatchObject({ outcome: "lose", timeMs: null, eloChange: 14 });
  });
  it("引き分け（勝者 uuid が null）", () => {
    expect(judgeRankedResult({ ...base, result: { uuid: null, time: 0 } }, args)?.outcome).toBe("draw");
  });
  it("降参フラグ", () => {
    expect(judgeRankedResult({ ...base, forfeited: true }, args)?.forfeited).toBe(true);
  });
  it("ハイフン付き uuid でも照合できる", () => {
    const dashed = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    expect(judgeRankedResult(base, { ...args, uuid: dashed })?.outcome).toBe("win");
  });
  it("再戦で前の試合を拾わない（終了時刻が開始推定の60秒より前）", () => {
    expect(judgeRankedResult({ ...base, date: 1000 }, args)).toBeNull();
    expect(judgeRankedResult({ ...base, date: 1940 }, args)).not.toBeNull();
  });
  it("別の相手・players 欠落・不正データは未確定", () => {
    expect(judgeRankedResult(base, { ...args, opponent: "c".repeat(32) })).toBeNull();
    expect(judgeRankedResult({ ...base, players: undefined }, args)).toBeNull();
    expect(judgeRankedResult(null, args)).toBeNull();
    expect(judgeRankedResult({ ...base, date: "x" }, args)).toBeNull();
  });
  it("相手 uuid は key から取る", () => {
    expect(rankedOpponentUuid({ key: `${A}-${B}`, uuid: A })).toBe(B);
    expect(rankedOpponentUuid({ key: `${A}-${B}`, uuid: B.toUpperCase() })).toBe(A);
    expect(rankedOpponentUuid({ key: A, uuid: A })).toBeNull();
  });
});
