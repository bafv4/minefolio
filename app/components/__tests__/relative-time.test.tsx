// @vitest-environment jsdom
// <RelativeTime> / useHydrated: SSR と水和は経過日数、水和後と CSR 初回描画は端末の暦日で描く
import { act, createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelativeTime } from "@/components/relative-time";

vi.mock("@/hooks/use-locale", () => ({
  useT: () => (k: string, p?: { count: number }) => (p ? `${k}:${p.count}` : k),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ローカル 00:30 を new Date(y, m, d, h, mi) で作るので、TZ に依らない。
// 25 時間前は「経過日数 = 1（昨日）」「暦日 = 2（2日前）」の組になる（夏時間の無い真夏の日を使う）。
const NOW = new Date(2026, 5, 15, 0, 30);
const DATE = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
const ELAPSED = "relativeDate.yesterday";
const CALENDAR = "relativeDate.daysAgo:2";

let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const el = () => createElement(RelativeTime, { date: DATE, unit: "date" });

describe("RelativeTime", () => {
  it("renderToString は経過日数で描く", () => {
    expect(renderToString(el())).toContain(ELAPSED);
    expect(renderToString(el())).not.toContain(CALENDAR);
  });

  it("hydrateRoot は水和後に暦日へ切り替わり、console.error を出さない", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    container.innerHTML = renderToString(el());
    expect(container.textContent).toBe(ELAPSED);
    await act(async () => {
      hydrateRoot(container, el());
    });
    expect(container.textContent).toBe(CALENDAR);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("createRoot は最初から暦日で描く", async () => {
    await act(async () => {
      createRoot(container).render(el());
    });
    expect(container.textContent).toBe(CALENDAR);
  });
});
