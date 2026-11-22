import { describe, it, expect } from "vitest";
import { resolveSyncedDraft } from "../loader-synced-draft";

// loader の値が変わったときの下書きの扱い（app/hooks/use-loader-synced-draft.ts が使う）。
describe("resolveSyncedDraft", () => {
  it("未変更（下書き＝前回の基準値）なら新しい値で置き換える（プリセット切替・保存後）", () => {
    const base = { a: "1" };
    expect(resolveSyncedDraft({ draft: { a: "1" }, prevBase: base, nextBase: { a: "2" } })).toEqual({ a: "2" });
  });

  it("編集済みなら下書きを残す（タブ復帰の再検証で入力中の編集を消さない）", () => {
    const draft = { a: "編集中" };
    expect(resolveSyncedDraft({ draft, prevBase: { a: "1" }, nextBase: { a: "1" } })).toBe(draft);
    expect(resolveSyncedDraft({ draft, prevBase: { a: "1" }, nextBase: { a: "2" } })).toBe(draft);
  });

  it("force（保存成功の直後）は編集済みでも新しい値で置き換える", () => {
    const next = { a: "保存値" };
    expect(resolveSyncedDraft({ draft: { a: "new-id" }, prevBase: { a: "1" }, nextBase: next, force: true })).toBe(next);
  });

  it("比較関数を差し替えられる", () => {
    const isEqual = (x: { n: number }, y: { n: number }) => x.n === y.n;
    const next = { n: 2 };
    expect(resolveSyncedDraft({ draft: { n: 1 }, prevBase: { n: 1 }, nextBase: next, isEqual })).toBe(next);
    const edited = { n: 5 };
    expect(resolveSyncedDraft({ draft: edited, prevBase: { n: 1 }, nextBase: next, isEqual })).toBe(edited);
  });

  it("持ち主のキー（編集先プリセット）が変わったら、編集済みでも新しい値で置き換える", () => {
    const next = { a: "B の内容" };
    const edited = { a: "A の編集中" };
    expect(
      resolveSyncedDraft({ draft: edited, prevBase: { a: "A" }, nextBase: next, prevKey: "A", nextKey: "B" }),
    ).toBe(next);
    // キーが同じなら従来どおり編集を残す
    expect(
      resolveSyncedDraft({ draft: edited, prevBase: { a: "A" }, nextBase: next, prevKey: "A", nextKey: "A" }),
    ).toBe(edited);
  });
});
