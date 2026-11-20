// PaceMan APIの依存ゼロの純関数群（純関数群と、fetch をモックした fetchRecentRuns の整形）。
// スプリット表示・進行順ソートを担い、境界を誤ると誤ったスプリットが表示される。
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchRecentRuns,
  getLatestSplit,
  getSplitOrder,
  getSplitLabelEnglish,
  getSplitTimeline,
  type PaceManLiveRun,
  type PaceManEvent,
} from "../paceman";

function event(eventId: string, overrides: Partial<PaceManEvent> = {}): PaceManEvent {
  return { eventId, rta: 0, igt: 0, ...overrides };
}

function liveRun(eventList: PaceManEvent[]): PaceManLiveRun {
  return {
    worldId: "world1",
    gameVersion: "1.16.1",
    eventList,
    contextEventList: [],
    user: { uuid: "uuid1", liveAccount: null },
    nickname: "runner",
    lastUpdated: 0,
    isCheated: false,
    isHidden: false,
    numLeaves: 0,
  };
}

// ============================================
// fetchRecentRuns（fetch をモック）
// ============================================

describe("fetchRecentRuns", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("生応答の obtainRod をそのまま渡し、欠けていれば null にする", async () => {
    const raw = [
      {
        id: 1, nether: 122102, bastion: 153702, fortress: 315534, first_portal: 379684,
        stronghold: 463769, end: 496512, finish: null, obtainRod: 321234, time: 1700000000,
      },
      { id: 2, nether: 100000, bastion: null, fortress: null, first_portal: null, stronghold: null, end: null, finish: null, time: 1700000100 },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => raw })));

    const runs = await fetchRecentRuns("Runner");

    expect(runs[0]).toMatchObject({ id: 1, nickname: "Runner", fortress: 315534, obtainRod: 321234 });
    expect(runs[1].obtainRod).toBeNull();
  });
});

// ============================================
// getLatestSplit / getSplitOrder
// ============================================

describe("getSplitOrder", () => {
  it("進行順に昇順の数値を返す", () => {
    expect(getSplitOrder("rsg.enter_nether")).toBe(1);
    expect(getSplitOrder("rsg.enter_bastion")).toBe(2);
    expect(getSplitOrder("rsg.enter_fortress")).toBe(3);
    expect(getSplitOrder("rsg.first_portal")).toBe(4);
    expect(getSplitOrder("rsg.second_portal")).toBe(5);
    expect(getSplitOrder("rsg.enter_stronghold")).toBe(6);
    expect(getSplitOrder("rsg.enter_end")).toBe(7);
    expect(getSplitOrder("rsg.credits")).toBe(8);
  });

  it("未知の eventId は 0（最低優先度）を返す", () => {
    expect(getSplitOrder("rsg.unknown_event")).toBe(0);
  });
});

describe("getLatestSplit", () => {
  it("getSplitOrder が最大のイベントを返す（順不同で渡しても最新を特定する）", () => {
    const run = liveRun([
      event("rsg.enter_nether"),
      event("rsg.credits"),
      event("rsg.enter_bastion"),
    ]);
    expect(getLatestSplit(run)?.eventId).toBe("rsg.credits");
  });

  it("eventList が空なら null を返す", () => {
    expect(getLatestSplit(liveRun([]))).toBeNull();
  });

  it("構造物は種類ではなく着いた順で、後の方を最新にする（Fortress → Bastion なら Bastion）", () => {
    const fortressFirst = liveRun([
      event("rsg.enter_nether", { rta: 90_000 }),
      event("rsg.enter_fortress", { rta: 160_000 }),
      event("rsg.enter_bastion", { rta: 262_000 }),
    ]);
    expect(getLatestSplit(fortressFirst)?.eventId).toBe("rsg.enter_bastion");
    const bastionFirst = liveRun([
      event("rsg.enter_nether", { rta: 90_000 }),
      event("rsg.enter_bastion", { rta: 150_000 }),
      event("rsg.enter_fortress", { rta: 300_000 }),
    ]);
    expect(getLatestSplit(bastionFirst)?.eventId).toBe("rsg.enter_fortress");
    // 構造物より先の区間は従来どおり優先
    expect(getLatestSplit(liveRun([...fortressFirst.eventList, event("rsg.first_portal", { rta: 400_000 })]))?.eventId).toBe(
      "rsg.first_portal",
    );
  });

  it("未知の eventId（order 0）は既知のイベントより優先されない", () => {
    const run = liveRun([event("rsg.unknown_event"), event("rsg.enter_nether")]);
    expect(getLatestSplit(run)?.eventId).toBe("rsg.enter_nether");
  });

  it("全て未知の eventId の場合は先頭要素を返す（order が全て同値のため安定ソート）", () => {
    const run = liveRun([event("rsg.foo"), event("rsg.bar")]);
    expect(getLatestSplit(run)?.eventId).toBe("rsg.foo");
  });
});

// ============================================
// getSplitLabelEnglish / getSplitTimeline
// ============================================

describe("getSplitLabelEnglish", () => {
  it("既知の eventId は英語ラベルを返す（first_portal は口語表記 'Blind'）", () => {
    expect(getSplitLabelEnglish("rsg.enter_nether")).toBe("Enter Nether");
    expect(getSplitLabelEnglish("rsg.enter_bastion")).toBe("Bastion");
    expect(getSplitLabelEnglish("rsg.enter_fortress")).toBe("Fortress");
    expect(getSplitLabelEnglish("rsg.first_portal")).toBe("Blind");
    expect(getSplitLabelEnglish("rsg.second_portal")).toBe("Second Portal");
    expect(getSplitLabelEnglish("rsg.enter_stronghold")).toBe("Enter Stronghold");
    expect(getSplitLabelEnglish("rsg.enter_end")).toBe("Enter End");
    expect(getSplitLabelEnglish("rsg.credits")).toBe("Finish");
  });

  it("未知の eventId は 'rsg.' を除去し '_' をスペースへ変換したものを返す", () => {
    expect(getSplitLabelEnglish("rsg.some_unknown_event")).toBe("some unknown event");
  });
});

describe("getSplitTimeline と getSplitLabelEnglish の語彙差", () => {
  it("first_portal は getSplitTimeline では正規名 'First Portal'、getSplitLabelEnglish では口語 'Blind' になる", () => {
    expect(getSplitTimeline("rsg.first_portal")).toBe("First Portal");
    expect(getSplitLabelEnglish("rsg.first_portal")).toBe("Blind");
  });

  it("first_portal 以外は getSplitTimeline と getSplitLabelEnglish が一致する", () => {
    expect(getSplitTimeline("rsg.enter_nether")).toBe(getSplitLabelEnglish("rsg.enter_nether"));
    expect(getSplitTimeline("rsg.credits")).toBe(getSplitLabelEnglish("rsg.credits"));
  });

  it("未知の eventId は getSplitLabelEnglish のフォールバックにも委譲する", () => {
    expect(getSplitTimeline("rsg.some_unknown_event")).toBe("some unknown event");
  });
});
