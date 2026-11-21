// @vitest-environment jsdom
// PaceTimelineModal の取得結果の扱い。HTTP エラーを「区間データなし」と取り違えず、エラー表示にする。
// 区間タイムは home-format の formatClock（1時間以上は h:mm:ss）で出す。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTranslator } from "@/lib/messages";

const t = createTranslator("ja");
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PaceTimelineModal } from "../pace-timeline-modal";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mount: HTMLElement;
const originalFetch = globalThis.fetch;

async function renderModal() {
  await act(async () => {
    root.render(
      createElement(PaceTimelineModal, {
        open: true,
        onOpenChange: () => {},
        mcid: "Runner",
        runId: 123,
        title: "Runner",
      }),
    );
  });
  // fetch → setState の解決を待つ
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  mount.remove();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("PaceTimelineModal", () => {
  it("HTTP エラー（!res.ok）は「区間データがありません」ではなくエラー表示にする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "x" }), { status: 500 })) as never;
    await renderModal();
    const text = document.body.textContent ?? "";
    expect(text).toContain(t("home.timelineError"));
    expect(text).not.toContain("区間データがありません");
  });

  it("成功時は区間タイムを formatClock で表示し、1時間以上は h:mm:ss になる", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          timeline: [
            { timeline: "Bastion", rta: 125_000, igt: null },
            { timeline: "Finish", rta: 3_725_000, igt: null },
          ],
        }),
        { status: 200 },
      ),
    ) as never;
    await renderModal();
    const text = document.body.textContent ?? "";
    expect(text).toContain("2:05");
    expect(text).toContain("1:02:05");
  });

  it("成功で区間が空のときは「区間データがありません」", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ timeline: [] }), { status: 200 })) as never;
    await renderModal();
    expect(document.body.textContent).toContain("区間データがありません");
  });
});
