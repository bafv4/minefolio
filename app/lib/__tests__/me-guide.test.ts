// /me の「はじめに」ガイド（チェックリストの判定・kind の検証・ツアーの矩形計算）の純粋関数テスト。
import { describe, it, expect } from "vitest";
import { computeMeChecklist, parseMeGuideKind, type MeChecklistInput } from "../me-guide";
import { anchorRect } from "../me-tour";

const empty: MeChecklistInput = {
  mcid: null,
  keybindingCount: 0,
  config: null,
  recordCount: 0,
  playstyle: null,
};

function doneKeys(input: MeChecklistInput) {
  return computeMeChecklist(input).steps.filter((s) => s.done).map((s) => s.key);
}

describe("computeMeChecklist", () => {
  it("何も無ければ全て未完了", () => {
    const r = computeMeChecklist(empty);
    expect(r.doneCount).toBe(0);
    expect(r.total).toBe(5);
  });

  it("MCID は Java・Bedrock どちらかがあれば済み（空白だけは未完了）", () => {
    expect(doneKeys({ ...empty, mcid: "Steve" })).toEqual(["mcid"]);
    expect(doneKeys({ ...empty, bedrockMcid: "Alex" })).toEqual(["mcid"]);
    expect(doneKeys({ ...empty, mcid: "  " })).toEqual([]);
  });

  it("デバイスは意味のある項目が1つでも入っていれば済み（行があるだけでは未完了）", () => {
    expect(doneKeys({ ...empty, config: {} })).toEqual([]);
    expect(doneKeys({ ...empty, config: { mouseDpi: null, keyboardModel: "" } })).toEqual([]);
    expect(doneKeys({ ...empty, config: { mouseDpi: 800 } })).toEqual(["devices"]);
    expect(doneKeys({ ...empty, config: { keyboardLayout: "JIS" } })).toEqual(["devices"]);
  });

  it("コントローラー設定だけ入っている走者もデバイスは済み（空文字・空配列は未完了）", () => {
    expect(doneKeys({ ...empty, config: { controllerSettings: '{"controllerModel":"DualSense"}' } })).toEqual(["devices"]);
    expect(doneKeys({ ...empty, config: { controllerSettings: "" } })).toEqual([]);
    expect(doneKeys({ ...empty, config: { controllerSettings: null } })).toEqual([]);
  });

  it("キー配置・記録は件数、プレイスタイルは主要項目の入力で判定する", () => {
    expect(doneKeys({ ...empty, keybindingCount: 1 })).toEqual(["keybindings"]);
    expect(doneKeys({ ...empty, recordCount: 2 })).toEqual(["records"]);
    expect(doneKeys({ ...empty, playstyle: { versions: "[]", categories: null } })).toEqual([]);
    expect(doneKeys({ ...empty, playstyle: { versions: '["java:1_16_1_19"]' } })).toEqual(["playstyle"]);
    expect(doneKeys({ ...empty, playstyle: { hotbarSwitching: "wheel" } })).toEqual(["playstyle"]);
  });

  it("全て済めば doneCount が total に並ぶ", () => {
    const r = computeMeChecklist({
      mcid: "Steve",
      keybindingCount: 3,
      config: { cm360: 30 },
      recordCount: 1,
      playstyle: { categories: '["rsg"]' },
    });
    expect(r.doneCount).toBe(r.total);
  });
});

describe("parseMeGuideKind", () => {
  it("tour / checklist だけを受け付ける（Object.prototype のキーも弾く）", () => {
    expect(parseMeGuideKind("tour")).toBe("tour");
    expect(parseMeGuideKind("checklist")).toBe("checklist");
    expect(parseMeGuideKind("toString")).toBeNull();
    expect(parseMeGuideKind("")).toBeNull();
    expect(parseMeGuideKind(null)).toBeNull();
    expect(parseMeGuideKind(1)).toBeNull();
  });
});

describe("anchorRect", () => {
  const viewport = { width: 375, height: 800 };
  it("画面に収まる対象はそのまま（画面外の部分は切る）", () => {
    expect(anchorRect({ top: 100, left: 10, width: 200, height: 100 }, viewport)).toEqual({
      top: 100, left: 10, width: 200, height: 100,
    });
    expect(anchorRect({ top: -50, left: 0, width: 100, height: 150 }, viewport).height).toBe(100);
  });
  it("画面の6割を超える対象は、見えている上端付近だけを基準にする", () => {
    const r = anchorRect({ top: -200, left: 0, width: 375, height: 3000 }, viewport);
    expect(r.top).toBe(0);
    expect(r.height).toBe(48);
  });
});
