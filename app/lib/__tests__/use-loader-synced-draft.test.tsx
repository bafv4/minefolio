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

function Probe(props: { source: string[]; presetId: string | null; token?: unknown }) {
  api = useLoaderSyncedDraft(props.source, { resetKey: props.presetId, syncToken: props.token ?? null });
  return null;
}

async function render(source: string[], presetId: string | null, token?: unknown) {
  await act(async () => {
    root.render(createElement(Probe, { source, presetId, token }));
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

});

describe("useLoaderSyncedDraft（成功した保存結果の参照 syncToken）", () => {
  const success = { success: true };

  it("成功の結果と新しい source が同じレンダーで届くと、編集済みでも置き換わる。その後トークンが同じまま source だけ変わっても下書きは残る", async () => {
    await render(A, "A");
    await act(async () => api.setDraft(["保存した編集"]));
    const saved = ["a-item", "正規化"];
    await render(saved, "A", success);
    expect(api.draft).toBe(saved);

    // 失敗した保存の後の再検証・タブ復帰の再検証（トークンは同じ）
    await act(async () => api.setDraft(["次の編集"]));
    await render(["a-item", "再検証"], "A", success);
    expect(api.draft).toEqual(["次の編集"]);
  });

  it("成功の結果が先に届き、次のレンダーで source が変わると置き換わる（1回だけ）", async () => {
    await render(A, "A");
    await act(async () => api.setDraft(["編集"]));
    await render(A, "A", success);
    expect(api.draft).toEqual(["編集"]);
    const saved = ["a-item", "正規化"];
    await render(saved, "A", success);
    expect(api.draft).toBe(saved);

    await act(async () => api.setDraft(["さらに編集"]));
    await render(["a-item", "再検証"], "A", success);
    expect(api.draft).toEqual(["さらに編集"]);
  });

  it("失敗の結果（トークン null）の後に source が変わっても下書きは残る", async () => {
    await render(A, "A");
    await act(async () => api.setDraft(["編集"]));
    await render(["a-item", "再検証"], "A", null);
    expect(api.draft).toEqual(["編集"]);
  });

  it("成功 → 失敗 → source 変化の順でも下書きは残る", async () => {
    await render(A, "A");
    await render(["a-item", "保存済み"], "A", success);
    await act(async () => api.setDraft(["上限超過の入力"]));
    await render(["a-item", "保存済み"], "A", null); // 失敗の結果
    await render(["a-item", "再検証"], "A", null);
    expect(api.draft).toEqual(["上限超過の入力"]);
  });

  it("新しい成功の結果（別の参照）が届くたびに、次の source 更新で 1 回ずつ強制される", async () => {
    await render(A, "A");
    await render(["v1"], "A", { success: true });
    await act(async () => api.setDraft(["編集2"]));
    const v2 = ["v2"];
    await render(v2, "A", { success: true });
    expect(api.draft).toBe(v2);
  });
});
