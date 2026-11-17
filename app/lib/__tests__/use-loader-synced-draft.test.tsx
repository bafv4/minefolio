// @vitest-environment jsdom
// 不変条件: 「プリセット A で読み込んだ下書きは、presetId=B では保存できない」
// （画面は保存時に loader の activePreset.id を送るので、プリセットが変わったら下書きも必ず B の値へ置き換わること）
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLoaderSyncedDraft } from "@/hooks/use-loader-synced-draft";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useLoaderSyncedDraft<string[]>>;
let api: Api;
let root: Root;
let mount: HTMLElement;

function Probe(props: { source: string[]; presetId: string | null }) {
  api = useLoaderSyncedDraft(props.source, { resetKey: props.presetId });
  return null;
}

async function render(source: string[], presetId: string | null) {
  await act(async () => {
    root.render(createElement(Probe, { source, presetId }));
  });
}

const A = ["a-item"];
const B = ["b-item"];

beforeEach(() => {
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  mount.remove();
});

describe("useLoaderSyncedDraft（プリセットをまたぐ下書き）", () => {
  it("編集済みでも、編集先プリセットが A から B に変わったら B の値に置き換わる", async () => {
    await render(A, "A");
    await act(async () => api.setDraft(["a-item", "A で編集"]));
    expect(api.draft).toEqual(["a-item", "A で編集"]);

    await render(B, "B");
    expect(api.draft).toEqual(B);
    expect(api.base).toBe(B);
  });

  it("同じプリセットでの再検証では、編集済みの下書きを残す", async () => {
    await render(A, "A");
    await act(async () => api.setDraft(["a-item", "編集中"]));
    const refreshed = ["a-item"];
    await render(refreshed, "A");
    expect(api.draft).toEqual(["a-item", "編集中"]);
    expect(api.base).toBe(refreshed);
  });

  it("保存成功後（syncOnNextSource）は同じプリセットでも置き換える", async () => {
    await render(A, "A");
    await act(async () => api.setDraft(["編集"]));
    await act(async () => api.syncOnNextSource());
    const saved = ["a-item", "正規化"];
    await render(saved, "A");
    expect(api.draft).toBe(saved);
  });
});
