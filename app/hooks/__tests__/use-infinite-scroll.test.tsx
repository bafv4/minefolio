// @vitest-environment jsdom
// useInfiniteScroll の追加ロード挙動（IntersectionObserver / fetcher をモック）
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- fetcher モック（状態を外部から進められる） ----
type FState = { state: "idle" | "loading"; data: unknown; load: (url: string) => void };
const store = {
  snap: { state: "idle", data: undefined, load: () => {} } as FState,
  listeners: new Set<() => void>(),
  urls: [] as string[],
  set(next: Partial<FState>) {
    this.snap = { ...this.snap, ...next };
    this.listeners.forEach((l) => l());
  },
};
store.snap.load = (url: string) => {
  store.urls.push(url);
  store.set({ state: "loading" });
};

vi.mock("react-router", () => ({
  useFetcher: () =>
    useSyncExternalStore(
      (cb) => {
        store.listeners.add(cb);
        return () => store.listeners.delete(cb);
      },
      () => store.snap,
    ),
  useSearchParams: () => [new URLSearchParams("")],
}));
vi.mock("@/hooks/use-locale", () => ({ useT: () => (k: string) => k }));

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
}

import { useInfiniteScroll } from "../use-infinite-scroll";

const initial = [{ id: 1 }];
let latest: ReturnType<typeof useInfiniteScroll<{ id: number }>>;
function Harness() {
  latest = useInfiniteScroll<{ id: number }>({
    initialItems: initial,
    initialPage: 1,
    initialHasMore: true,
    endpoint: "/api/x",
    resetDeps: [],
  });
  return createElement("div", { ref: latest.sentinelRef });
}

let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("IntersectionObserver", MockIO);
  MockIO.all = [];
  store.urls = [];
  store.listeners.clear();
  store.snap = { state: "idle", data: undefined, load: store.snap.load };
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useInfiniteScroll", () => {
  it("センチネルが交差したら次ページを取得し、完了後に追記して続けて取得できる", () => {
    act(() => MockIO.notifyActive());
    expect(store.urls).toEqual(["/api/x?page=2"]);
    act(() => store.set({ state: "idle", data: { items: [{ id: 2 }], hasMore: true, page: 2 } }));
    expect(latest.items).toHaveLength(2);
    act(() => MockIO.notifyActive());
    expect(store.urls).toEqual(["/api/x?page=2", "/api/x?page=3"]);
  });

  it("読み込み中の二重通知では同じページを再取得しない", () => {
    act(() => MockIO.notifyActive());
    act(() => MockIO.notifyActive());
    expect(store.urls).toHaveLength(1);
  });

  it("1回の通知に [非交差, 交差] がまとまって届いても次ページを取得する", () => {
    // 本物の IntersectionObserver は、メインスレッドが重いと複数エントリを1回のコールバックにまとめる。
    // entries[0]（最古）だけを見ると非交差と判定して取りこぼし、センチネルが可視のままだと以後通知が来ない
    const o = MockIO.all.find((x) => !x.disconnected)!;
    o.notified = true;
    act(() => o.cb([{ isIntersecting: false }, { isIntersecting: true }]));
    expect(store.urls).toEqual(["/api/x?page=2"]);
  });

  it("完了前に掴んだ古い loadMore を完了後に2回呼んでも、次ページを1回だけ取得する", () => {
    const stale = latest.loadMore;
    act(() => stale());
    act(() => store.set({ state: "idle", data: { items: [{ id: 2 }], hasMore: true, page: 2 } }));
    act(() => stale());
    act(() => stale());
    expect(store.urls).toEqual(["/api/x?page=2", "/api/x?page=3"]);
  });
});
