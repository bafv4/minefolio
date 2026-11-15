import { fetchMCSRRankedStats, type MCSRRankedStats } from "./external-stats";

// プロフィールのハイライト行と stats タブが同じ MCID の MCSR Ranked 統計を取りに行くため、
// MCID をキーに Promise を短時間共有し、同じページ内では外部 API 呼び出しを 1 回にする。
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<MCSRRankedStats> }>();

// 取得が error なしで解決したときの購読者（身元帯のハイライト。stats タブの「再試行」で取り直した
// 成功結果を、初回の失敗を握ったままの身元帯にも届ける）
const listeners = new Map<string, Set<(result: MCSRRankedStats) => void>>();

/** 指定 MCID の取得が成功（error なし）するたびに cb を呼ぶ。戻り値は購読解除 */
export function subscribeMCSRRankedStats(mcid: string, cb: (result: MCSRRankedStats) => void): () => void {
  let set = listeners.get(mcid);
  if (!set) listeners.set(mcid, (set = new Set()));
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0 && listeners.get(mcid) === set) listeners.delete(mcid);
  };
}

export function fetchMCSRRankedStatsCached(mcid: string): Promise<MCSRRankedStats> {
  const hit = cache.get(mcid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchMCSRRankedStats(mcid);
  cache.set(mcid, { at: Date.now(), promise });
  promise.then((r) => {
    if (!r.error) listeners.get(mcid)?.forEach((cb) => cb(r));
  }, () => {});
  // 失敗はキャッシュしない（取得関数は失敗を reject ではなく `error` 付きの結果で返すので、両方を外す。
  // 外さないと、失敗表示の「再試行」が TTL の間ずっと同じ失敗結果を受け取る）
  const evict = () => {
    if (cache.get(mcid)?.promise === promise) cache.delete(mcid);
  };
  promise.then((r) => {
    if (r.error) evict();
  }, evict);
  return promise;
}
