// 外部統計（MCSR Ranked / speedrun.com）の取得を、キー（MCID・ユーザー名）ごとに短時間共有するキャッシュ。
// 身元帯のハイライトと stats / 記録タブが同じキーの統計を取りに行くため、同じページ内では外部 API 呼び出しを 1 回にする。

/** 成功した結果を共有する時間 */
const SUCCESS_TTL_MS = 5 * 60_000;
/** 失敗（`error` 付きの結果）を保持する時間。障害中にタブを開き直すたびに上流を叩き直さないため */
const FAILURE_TTL_MS = 15_000;
/** 取得中の Promise を共有する上限（取得が戻らないまま居座らせない） */
const PENDING_TTL_MS = 60_000;

export type StatsCache<T> = {
  /** `force: true` はキャッシュを迂回して取り直す（再試行ボタン用） */
  fetchCached: (id: string, options?: { force?: boolean }) => Promise<T>;
  /** 指定キーの取得が成功（error なし）するたびに cb を呼ぶ。戻り値は購読解除 */
  subscribe: (id: string, cb: (result: T) => void) => () => void;
};

/**
 * 取得関数 `fetcher` を包んだキャッシュを作る。取得関数は失敗を reject ではなく `error` 付きの結果で返すが、
 * reject された場合も同じく扱う（reject は保持せず即座に捨てる）。
 */
export function createStatsCache<T extends { error?: unknown }>(fetcher: (id: string) => Promise<T>): StatsCache<T> {
  const cache = new Map<string, { expiresAt: number; promise: Promise<T> }>();
  // 取得が error なしで解決したときの購読者（stats タブの「再試行」で取り直した成功結果を、
  // 初回の失敗を握ったままの身元帯にも届ける）
  const listeners = new Map<string, Set<(result: T) => void>>();

  function subscribe(id: string, cb: (result: T) => void) {
    let set = listeners.get(id);
    if (!set) listeners.set(id, (set = new Set()));
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0 && listeners.get(id) === set) listeners.delete(id);
    };
  }

  function fetchCached(id: string, options?: { force?: boolean }): Promise<T> {
    const hit = cache.get(id);
    if (!options?.force && hit && Date.now() < hit.expiresAt) return hit.promise;
    const promise = fetcher(id);
    const entry = { expiresAt: Date.now() + PENDING_TTL_MS, promise };
    cache.set(id, entry);
    promise.then(
      (result) => {
        if (result.error) entry.expiresAt = Date.now() + FAILURE_TTL_MS;
        else {
          entry.expiresAt = Date.now() + SUCCESS_TTL_MS;
          listeners.get(id)?.forEach((cb) => cb(result));
        }
      },
      () => {
        if (cache.get(id) === entry) cache.delete(id);
      },
    );
    return promise;
  }

  return { fetchCached, subscribe };
}
