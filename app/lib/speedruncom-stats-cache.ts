import { fetchSpeedrunComStats, type SpeedrunComStats } from "./external-stats";

// プロフィールのハイライト行と stats タブが同じ speedrun.com ユーザー名の統計を取りに行くため、
// ユーザー名をキーに Promise を短時間共有し、同じページ内では外部 API 呼び出しを 1 回にする。
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<SpeedrunComStats> }>();

// 取得が error なしで解決したときの購読者（身元帯のハイライト。stats タブの「再試行」で取り直した
// 成功結果を、初回の失敗を握ったままの身元帯にも届ける）
const listeners = new Map<string, Set<(result: SpeedrunComStats) => void>>();

/** 指定ユーザー名の取得が成功（error なし）するたびに cb を呼ぶ。戻り値は購読解除 */
export function subscribeSpeedrunComStats(username: string, cb: (result: SpeedrunComStats) => void): () => void {
  let set = listeners.get(username);
  if (!set) listeners.set(username, (set = new Set()));
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0 && listeners.get(username) === set) listeners.delete(username);
  };
}

export function fetchSpeedrunComStatsCached(username: string): Promise<SpeedrunComStats> {
  const hit = cache.get(username);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchSpeedrunComStats(username);
  cache.set(username, { at: Date.now(), promise });
  promise.then((r) => {
    if (!r.error) listeners.get(username)?.forEach((cb) => cb(r));
  }, () => {});
  // 失敗はキャッシュしない（取得関数は失敗を reject ではなく `error` 付きの結果で返すので、両方を外す。
  // 外さないと、失敗表示の「再試行」が TTL の間ずっと同じ失敗結果を受け取る）
  const evict = () => {
    if (cache.get(username)?.promise === promise) cache.delete(username);
  };
  promise.then((r) => {
    if (r.error) evict();
  }, evict);
  return promise;
}
