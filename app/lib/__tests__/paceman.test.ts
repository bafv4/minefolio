// PaceMan APIの依存ゼロの純関数群（fetch を伴う fetchLiveRuns / fetchRecentRuns 等は対象外）。
// スプリット表示・進行順ソートを担い、境界を誤ると誤ったスプリットが表示される。
import { describe, it, expect } from "vitest";
import { createTranslator } from "../messages";
import {
  getRecentRunFinalSplit,
  getLatestSplit,
  getSplitOrder,
  getSplitLabel,
  getSplitLabelEnglish,
  getSplitTimeline,
  type PaceManRecentRun,
  type PaceManLiveRun,
  type PaceManEvent,
} from "../paceman";

const t = createTranslator("ja");

function recentRun(overrides: Partial<PaceManRecentRun> = {}): PaceManRecentRun {
  return {
    id: 1,
    nickname: "runner",
    nether: null,
    bastion: null,
    fortress: null,
    first_portal: null,
    first_structure: null,
    second_structure: null,
    stronghold: null,
    end: null,
    finish: null,
    time: 1700000000,
    ...overrides,
  };
}

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
// getRecentRunFinalSplit
// ============================================

describe("getRecentRunFinalSplit", () => {
  it("finish が到達していれば最優先で finish を返す", () => {
    const run = recentRun({
      nether: 60000,
      bastion: 120000,
      fortress: 180000,
      first_portal: 240000,
      stronghold: 300000,
      end: 360000,
      finish: 420000,
    });

    const result = getRecentRunFinalSplit(t, run);

    expect(result).toEqual({ splitId: "rsg.credits", label: "クリア", igt: 420000 });
  });

  it("finish未到達なら end → stronghold → ... の進行順で最も進んだスプリットを返す", () => {
    const run = recentRun({
      nether: 60000,
      bastion: 120000,
      fortress: 180000,
      stronghold: 300000,
      // first_portal, second_structure, end, finish は未到達
    });

    const result = getRecentRunFinalSplit(t, run);

    expect(result).toEqual({ splitId: "rsg.enter_stronghold", label: "要塞", igt: 300000 });
  });

  it("second_structure のみ到達している場合はそれを返す（fortress/bastion未到達扱い）", () => {
    const run = recentRun({ second_structure: 150000 });
    const result = getRecentRunFinalSplit(t, run);
    expect(result).toEqual({
      splitId: "rsg.second_structure",
      label: "2nd構造物",
      igt: 150000,
    });
  });

  it("nether のみ到達（最も進行が浅い）場合はそれを返す", () => {
    const run = recentRun({ nether: 45000 });
    const result = getRecentRunFinalSplit(t, run);
    expect(result).toEqual({ splitId: "rsg.enter_nether", label: "ネザーイン", igt: 45000 });
  });

  it("全スプリットが null（未到達）なら null を返す", () => {
    const run = recentRun();
    expect(getRecentRunFinalSplit(t, run)).toBeNull();
  });

  it("値が 0 のスプリットは未到達扱いになる（> 0 判定）", () => {
    const run = recentRun({ nether: 0 });
    expect(getRecentRunFinalSplit(t, run)).toBeNull();
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
// getSplitLabel / getSplitLabelEnglish / getSplitTimeline
// ============================================

describe("getSplitLabel（日本語）", () => {
  it("既知の eventId は翻訳ラベルを返す", () => {
    expect(getSplitLabel(t, "rsg.enter_nether")).toBe("ネザーイン");
    expect(getSplitLabel(t, "rsg.enter_bastion")).toBe("バスティオン");
    expect(getSplitLabel(t, "rsg.enter_fortress")).toBe("フォートレス");
    expect(getSplitLabel(t, "rsg.first_portal")).toBe("ブラインド");
    expect(getSplitLabel(t, "rsg.second_portal")).toBe("2ndポータル");
    expect(getSplitLabel(t, "rsg.enter_stronghold")).toBe("要塞");
    expect(getSplitLabel(t, "rsg.enter_end")).toBe("ジ・エンド");
    expect(getSplitLabel(t, "rsg.credits")).toBe("クリア");
  });

  it("未知の eventId は 'rsg.' を除去し '_' をスペースへ変換したものを返す", () => {
    expect(getSplitLabel(t, "rsg.some_unknown_event")).toBe("some unknown event");
  });
});

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
