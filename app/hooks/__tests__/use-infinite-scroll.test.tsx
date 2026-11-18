// @vitest-environment jsdom
// useInfiniteScroll の追加ロード挙動（IntersectionObserver / fetch をモック）
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  useSearchParams: () => [new URLSearchParams("")],
}));
vi.mock("@/hooks/use-locale", () => ({ useT: () => (k: string) => k }));

// ---- fetch モック（応答を外部から解決できる） ----
type Pending = {
  url: string;
  signal: AbortSignal | undefined;
  resolve: (res: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
  reject: (err: unknown) => void;
};
let pending: Pending[] = [];
const urls = () => pending.map((p) => p.url);
const fetchMock = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
  return new Promise((resolve, reject) => {
    const entry: Pending = { url, signal: init?.signal, resolve, reject };
    // 本物の fetch と同じく、中断で AbortError を投げる
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
    pending.push(entry);
  });
});

/** n 番目（0 始まり）の取得を、JSON の 2xx 応答で解決する */
async function respond(n: number, data: unknown) {
  await act(async () => {
    pending[n].resolve({ ok: true, status: 200, json: async () => data });
  });
}
/** n 番目の取得を、2xx 以外の応答で解決する */
async function respondStatus(n: number, status: number) {
  await act(async () => {
    pending[n].resolve({ ok: false, status, json: async () => ({}) });
  });
}
/** n 番目の取得を、ネットワークエラーで失敗させる */
async function fail(n: number) {
  await act(async () => {
    pending[n].reject(new TypeError("Failed to fetch"));
  });
}

// ---- IntersectionObserver モック（observe 時の初回通知を手動で発火） ----
class MockIO {
  static all: MockIO[] = [];
  disconnected = false;
  notified = false;
  constructor(public cb: (e: { isIntersecting: boolean }[]) => void) {
    MockIO.all.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
  /**
   * センチネルが可視のまま残る前提で、observe() 直後の初回通知だけを再現する。
   * 本物の IntersectionObserver は交差状態が変わらない限り再通知しないため、通知済みの観測には発火しない
   */
  static notifyActive() {
    for (const o of MockIO.all) {
      if (o.disconnected || o.notified) continue;
      o.notified = true;
      o.cb([{ isIntersecting: true }]);
    }
  }
  /** 有効な観測すべてに（通知済みでも）交差を通知する。センチネルが一度外れて戻った場合に相当 */
  static notifyAllActive() {
    for (const o of MockIO.all) {
      if (o.disconnected) continue;
      o.notified = true;
      o.cb([{ isIntersecting: true }]);
    }
  }
}

import { useInfiniteScroll } from "../use-infinite-scroll";

const initial = [{ id: 1 }];
let latest: ReturnType<typeof useInfiniteScroll<{ id: number }>>;
let setResetKey: (v: number) => void = () => {};
function Harness() {
  const [resetKey, setKey] = useState(0);
  setResetKey = setKey;
  latest = useInfiniteScroll<{ id: number }>({
    initialItems: initial,
    initialPage: 1,
    initialHasMore: true,
    endpoint: "/api/x",
    resetDeps: [resetKey],
  });
  return createElement("div", { ref: latest.sentinelRef });
}

let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("IntersectionObserver", MockIO);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock.mockClear();
  MockIO.all = [];
  pending = [];
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useInfiniteScroll", () => {
  it("センチネルが交差したら次ページを取得し、完了後に追記して続けて取得できる", async () => {
    act(() => MockIO.notifyActive());
    expect(urls()).toEqual(["/api/x?page=2"]);
    await respond(0, { items: [{ id: 2 }], hasMore: true, page: 2 });
    expect(latest.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(latest.isLoadingMore).toBe(false);
    act(() => MockIO.notifyActive());
    expect(urls()).toEqual(["/api/x?page=2", "/api/x?page=3"]);
  });

  it("読み込み中の二重通知では同じページを再取得しない", () => {
    act(() => MockIO.notifyActive());
    act(() => MockIO.notifyAllActive());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.isLoadingMore).toBe(true);
  });

  it("1回の通知に [非交差, 交差] がまとまって届いても次ページを取得する", () => {
    // 本物の IntersectionObserver は、メインスレッドが重いと複数エントリを1回のコールバックにまとめる。
    // entries[0]（最古）だけを見ると非交差と判定して取りこぼし、センチネルが可視のままだと以後通知が来ない
    const o = MockIO.all.find((x) => !x.disconnected)!;
    o.notified = true;
    act(() => o.cb([{ isIntersecting: false }, { isIntersecting: true }]));
    expect(urls()).toEqual(["/api/x?page=2"]);
  });

  it("完了前に掴んだ古い loadMore を完了後に2回呼んでも、次ページを1回だけ取得する", async () => {
    const stale = latest.loadMore;
    act(() => stale());
    await respond(0, { items: [{ id: 2 }], hasMore: true, page: 2 });
    act(() => stale());
    act(() => stale());
    expect(urls()).toEqual(["/api/x?page=2", "/api/x?page=3"]);
  });

  it("ネットワークエラーで失敗すると loadError が立ち、ページは進まない", async () => {
    act(() => latest.loadMore());
    await fail(0);
    expect(latest.loadError).toBe(true);
    expect(latest.isLoadingMore).toBe(false);
    expect(latest.items).toEqual(initial);
    expect(latest.hasMore).toBe(true);
    // 失敗の直後に前回の件数を読み上げない
    expect(latest.liveMessage).toBe("");
  });

  it("2xx 以外の応答も失敗として扱い、項目を追記しない", async () => {
    act(() => latest.loadMore());
    await respondStatus(0, 500);
    expect(latest.loadError).toBe(true);
    expect(latest.items).toEqual(initial);
  });

  it("retry で同じページを取り直し、成功すると loadError が消えて追記される", async () => {
    act(() => latest.loadMore());
    await fail(0);
    expect(latest.loadError).toBe(true);
    act(() => latest.retry());
    expect(urls()).toEqual(["/api/x?page=2", "/api/x?page=2"]);
    // 取り直しを始めた時点で失敗表示は消える
    expect(latest.loadError).toBe(false);
    await respond(1, { items: [{ id: 2 }], hasMore: true, page: 2 });
    expect(latest.loadError).toBe(false);
    expect(latest.items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("失敗中はセンチネルが交差しても自動で読み込まない", async () => {
    act(() => MockIO.notifyActive());
    await fail(0);
    expect(latest.loadError).toBe(true);
    act(() => MockIO.notifyAllActive());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("条件が変わって（リセット）中断した古い応答は捨てる", async () => {
    act(() => latest.loadMore());
    const first = pending[0];
    act(() => setResetKey(1));
    expect(first.signal?.aborted).toBe(true);
    // 中断（AbortError で reject 済み）は失敗として扱わない。後から resolve しても何も起きない。
    // 本文が遅れて届くケースは次のテストで確かめる
    await act(async () => {
      first.resolve({
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: 99 }], hasMore: true, page: 2 }),
      });
    });
    expect(latest.items).toEqual(initial);
    expect(latest.loadError).toBe(false);
    expect(latest.isLoadingMore).toBe(false);
    // リセット後は1ページ目の次から取り直せる
    act(() => latest.loadMore());
    expect(urls()).toEqual(["/api/x?page=2", "/api/x?page=2"]);
  });

  it("応答の本文を読む途中でリセットされた場合も、届いた項目を採用しない", async () => {
    act(() => latest.loadMore());
    let resolveJson: (v: unknown) => void = () => {};
    // ヘッダーは届いたが本文（json）がまだの状態
    await act(async () => {
      pending[0].resolve({
        ok: true,
        status: 200,
        json: () => new Promise((r) => (resolveJson = r)),
      });
    });
    act(() => setResetKey(1));
    await act(async () => {
      resolveJson({ items: [{ id: 99 }], hasMore: false, page: 2 });
    });
    expect(latest.items).toEqual(initial);
    expect(latest.hasMore).toBe(true);
    expect(latest.loadError).toBe(false);
  });
});
