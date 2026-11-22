import type { PaceManEvent, PaceManLiveRun } from "./paceman";

// ペースフィードで扱う区間（Enter Nether を除く、進行順）
// サーバー側のバリデーションとクライアント側の選択肢で共用する
export const PACE_FEED_SPLITS = [
  "Bastion",
  "Fortress",
  "Obtain Blaze Rods",
  "First Portal",
  "Enter Stronghold",
  "Enter End",
  "Finish",
] as const;

// スプリットIDの正規タイムライン名（SPLIT_MARK_ITEM / pacemanPaces.timeline と同じ語彙）
const SPLIT_TIMELINES: Record<string, string> = {
  "rsg.enter_nether": "Enter Nether",
  "rsg.enter_bastion": "Bastion",
  "rsg.enter_fortress": "Fortress",
  "rsg.first_portal": "First Portal",
  "rsg.second_portal": "Second Portal",
  "rsg.enter_stronghold": "Enter Stronghold",
  "rsg.enter_end": "Enter End",
  "rsg.credits": "Finish",
};

// 英語表示ラベル（正規タイムライン名との差分は First Portal の口語表記 "Blind" のみ）
const SPLIT_LABELS_EN: Record<string, string> = {
  ...SPLIT_TIMELINES,
  "rsg.first_portal": "Blind",
};

/**
 * スプリットIDを英語ラベルに変換
 */
export function getSplitLabelEnglish(eventId: string): string {
  return SPLIT_LABELS_EN[eventId] || eventId.replace("rsg.", "").replace(/_/g, " ");
}

/**
 * スプリットIDを PaceManSplitMark（アイコン+名称チップ）等で使う共通タイムライン名に変換する。
 * getSplitLabelEnglish の口語表記（"Blind" 等）ではなく、SPLIT_MARK_ITEM や
 * pacemanPaces.timeline と同じ語彙（"First Portal" 等）に揃える。
 */
export function getSplitTimeline(eventId: string): string {
  return SPLIT_TIMELINES[eventId] || getSplitLabelEnglish(eventId);
}

const SPLIT_ORDER: Record<string, number> = {
  "rsg.enter_nether": 1,
  "rsg.enter_bastion": 2,
  "rsg.enter_fortress": 3,
  "rsg.first_portal": 4,
  "rsg.second_portal": 5,
  "rsg.enter_stronghold": 6,
  "rsg.enter_end": 7,
  "rsg.credits": 8,
};

/**
 * スプリットIDの進行順序を取得（ソート用）
 */
export function getSplitOrder(eventId: string): number {
  return SPLIT_ORDER[eventId] || 0;
}

// フィード項目の timeline（正規タイムライン名）の進行順位。Bastion / Fortress はどちらが先でもよいので同順位
const TIMELINE_PROGRESS: Record<string, number> = {
  "Enter Nether": 1,
  Bastion: 2,
  Fortress: 2,
  "Obtain Blaze Rods": 3,
  "First Portal": 4,
  "Second Portal": 5,
  "Enter Stronghold": 6,
  "Enter End": 7,
  Finish: 8,
};

/** 正規タイムライン名の進行順位（大きいほど進んでいる。未知の名前は 0） */
export function getTimelineProgress(timeline: string): number {
  return TIMELINE_PROGRESS[timeline] ?? 0;
}

/**
 * ライブペースの最新スプリットを取得
 */
export function getLatestSplit(run: PaceManLiveRun): PaceManEvent | null {
  if (run.eventList.length === 0) return null;
  // スプリット順で最大のものを取得。ただし構造物（Bastion / Fortress）はどちらが先でもよいので
  // 同じ順位として扱い、着いたのが後（rta が大きい）方を最新にする（Fortress → Bastion の順に進んだランで、
  // Bastion に着いた後も Fortress を最新として出さないため）
  const rank = (eventId: string) =>
    eventId === "rsg.enter_bastion" || eventId === "rsg.enter_fortress" ? 2 : getSplitOrder(eventId);
  let best = run.eventList[0];
  let bestRank = rank(best.eventId);
  for (let i = 1; i < run.eventList.length; i++) {
    const e = run.eventList[i];
    const r = rank(e.eventId);
    if (r > bestRank || (r === bestRank && e.rta > best.rta)) {
      best = e;
      bestRank = r;
    }
  }
  return best;
}
