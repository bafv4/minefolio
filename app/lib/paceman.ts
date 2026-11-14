// PaceMan API - ライブペース取得

import { getCached, setCached, getPaceManCacheKey, CacheTTL } from "./cache";

const PACEMAN_API = "https://paceman.gg/api/ars/liveruns";
const PACEMAN_STATS_API = "https://paceman.gg/stats/api";

export interface PaceManEvent {
  eventId: string;
  rta: number; // ミリ秒
  igt: number; // ミリ秒
}

export interface PaceManLiveRun {
  worldId: string;
  gameVersion: string;
  eventList: PaceManEvent[];
  contextEventList: PaceManEvent[];
  user: {
    uuid: string;
    liveAccount: string | null;
  };
  nickname: string;
  lastUpdated: number;
  isCheated: boolean;
  isHidden: boolean;
  numLeaves: number;
}

/**
 * PaceMan APIからライブペース一覧を取得。
 * 上流の失敗（非 2xx・例外）は null（0件の正常応答 [] と区別する。呼び出し側は失敗をキャッシュしない）
 */
export async function fetchLiveRuns(): Promise<PaceManLiveRun[] | null> {
  // キャッシュチェック
  const cacheKey = getPaceManCacheKey("liveruns");
  const cached = await getCached<PaceManLiveRun[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(PACEMAN_API, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = (await res.json()) as PaceManLiveRun[];
    if (!Array.isArray(data)) return null;
    // 非表示・チート検出されたものを除外
    const filteredData = data.filter((run) => !run.isHidden && !run.isCheated);

    // キャッシュに保存（1分）- ライブデータなので短め
    await setCached(cacheKey, filteredData, CacheTTL.SHORT);

    return filteredData;
  } catch (error) {
    console.error("PaceMan API error:", error);
    return null;
  }
}

// スプリットID → 英語ラベル / タイムライン名の変換は、クライアントからも使うため軽量モジュールに置く（cache・DB を引き込まない）
export { getSplitLabelEnglish, getSplitTimeline } from "./pace-splits";

/**
 * スプリットIDの進行順序を取得（ソート用）
 */
export function getSplitOrder(eventId: string): number {
  const order: Record<string, number> = {
    "rsg.enter_nether": 1,
    "rsg.enter_bastion": 2,
    "rsg.enter_fortress": 3,
    "rsg.first_portal": 4,
    "rsg.second_portal": 5,
    "rsg.enter_stronghold": 6,
    "rsg.enter_end": 7,
    "rsg.credits": 8,
  };
  return order[eventId] || 0;
}

/**
 * ライブペースの最新スプリットを取得
 */
export function getLatestSplit(run: PaceManLiveRun): PaceManEvent | null {
  if (run.eventList.length === 0) return null;
  // スプリット順でソートして最後のものを取得。ただし構造物（Bastion / Fortress）はどちらが先でもよいので
  // 同じ順位として扱い、着いたのが後（rta が大きい）方を最新にする（Fortress → Bastion の順に進んだランで、
  // Bastion に着いた後も Fortress を最新として出さないため）
  const rank = (eventId: string) =>
    eventId === "rsg.enter_bastion" || eventId === "rsg.enter_fortress" ? 2 : getSplitOrder(eventId);
  const sorted = [...run.eventList].sort((a, b) => rank(b.eventId) - rank(a.eventId) || b.rta - a.rta);
  return sorted[0];
}

// ============================================
// PaceMan Stats API - 最近のペース履歴
// ============================================

// APIから返される生データ
interface PaceManRecentRunRaw {
  id: number;
  // スプリットタイム（ミリ秒、nullは未到達）
  nether: number | null;
  bastion: number | null;
  fortress: number | null;
  first_portal: number | null;
  stronghold: number | null;
  end: number | null;
  finish: number | null;
  // その他のタイムスタンプ
  lootBastion: number | null;
  obtainObsidian: number | null;
  obtainCryingObsidian: number | null;
  obtainRod: number | null;
  // タイムスタンプ（Unix秒）
  time: number;
  updatedTime: number;
}

// 内部で使用する拡張型（nicknameを追加）
export interface PaceManRecentRun {
  id: number;
  nickname: string; // 追加：クエリしたユーザー名
  // スプリットタイム（ミリ秒、nullは未到達）
  nether: number | null;
  bastion: number | null;
  fortress: number | null;
  first_portal: number | null;
  first_structure: number | null;
  second_structure: number | null;
  stronghold: number | null;
  end: number | null;
  finish: number | null;
  // タイムスタンプ（Unix秒）
  time: number;
}

/**
 * PaceMan Stats APIから特定ユーザーの最近のペースを取得
 */
export async function fetchRecentRuns(
  nickname: string,
  hours: number = 24,
  limit: number = 10
): Promise<PaceManRecentRun[]> {
  try {
    const params = new URLSearchParams({
      name: nickname,
      hours: hours.toString(),
      limit: limit.toString(),
    });
    // 末尾スラッシュが必要
    const res = await fetch(`${PACEMAN_STATS_API}/getRecentRuns/?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as PaceManRecentRunRaw[];

    // エラーレスポンスのチェック
    if (!Array.isArray(data)) return [];

    // nicknameを追加して返す
    return data.map((run) => ({
      id: run.id,
      nickname,
      nether: run.nether,
      bastion: run.bastion,
      fortress: run.fortress,
      first_portal: run.first_portal,
      first_structure: null, // APIには含まれない
      second_structure: null, // APIには含まれない
      stronghold: run.stronghold,
      end: run.end,
      finish: run.finish,
      time: run.time,
    }));
  } catch (error) {
    console.error("PaceMan Stats API error:", error);
    return [];
  }
}

/**
 * 複数ユーザーの最近のペースを並列取得してマージ
 */
export async function fetchRecentRunsForUsers(
  nicknames: string[],
  hours: number = 24,
  limitPerUser: number = 5,
  totalLimit: number = 20
): Promise<PaceManRecentRun[]> {
  if (nicknames.length === 0) return [];

  // キャッシュチェック
  const cacheKey = getPaceManCacheKey(`recent:${nicknames.sort().join(",")}`);
  const cached = await getCached<PaceManRecentRun[]>(cacheKey);
  if (cached) {
    return cached;
  }

  // 並列で取得（ただし同時リクエスト数を制限）
  const batchSize = 10;
  const allRuns: PaceManRecentRun[] = [];

  for (let i = 0; i < nicknames.length; i += batchSize) {
    const batch = nicknames.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((name) => fetchRecentRuns(name, hours, limitPerUser))
    );
    allRuns.push(...results.flat());
  }

  // 時間でソート（新しい順）して上位を返す
  const sortedRuns = allRuns
    .sort((a, b) => b.time - a.time)
    .slice(0, totalLimit);

  // キャッシュに保存（15分）
  await setCached(cacheKey, sortedRuns, CacheTTL.MEDIUM);

  return sortedRuns;
}
