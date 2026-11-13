import { fetchMCSRRankedStats, type MCSRRankedStats } from "./external-stats";

// プロフィールのハイライト行と stats タブが同じ MCID の MCSR Ranked 統計を取りに行くため、
// MCID をキーに Promise を短時間共有し、同じページ内では外部 API 呼び出しを 1 回にする。
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<MCSRRankedStats> }>();

export function fetchMCSRRankedStatsCached(mcid: string): Promise<MCSRRankedStats> {
  const hit = cache.get(mcid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchMCSRRankedStats(mcid);
  cache.set(mcid, { at: Date.now(), promise });
  // 失敗はキャッシュしない
  promise.catch(() => {
    if (cache.get(mcid)?.promise === promise) cache.delete(mcid);
  });
  return promise;
}
