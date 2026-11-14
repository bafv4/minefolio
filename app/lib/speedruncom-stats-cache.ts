import { fetchSpeedrunComStats, type SpeedrunComStats } from "./external-stats";

// プロフィールのハイライト行と stats タブが同じ speedrun.com ユーザー名の統計を取りに行くため、
// ユーザー名をキーに Promise を短時間共有し、同じページ内では外部 API 呼び出しを 1 回にする。
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<SpeedrunComStats> }>();

export function fetchSpeedrunComStatsCached(username: string): Promise<SpeedrunComStats> {
  const hit = cache.get(username);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchSpeedrunComStats(username);
  cache.set(username, { at: Date.now(), promise });
  // 失敗はキャッシュしない
  promise.catch(() => {
    if (cache.get(username)?.promise === promise) cache.delete(username);
  });
  return promise;
}
