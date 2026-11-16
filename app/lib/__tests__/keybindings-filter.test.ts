// キー名の表示ラベル・比較・「操作＝キー」の絞り込み判定（app/lib/keybindings-filter.ts）
import { describe, it, expect } from "vitest";
import { createTranslator } from "@/lib/messages";
import {
  bindConditionLabel,
  bindKeysMatch,
  collectBoundKeys,
  compareKeyLabels,
  getBoundKeyLabel,
  rowMatchesBind,
  type BoundKeyRow,
} from "../keybindings-filter";

const t = createTranslator("ja");

const row = (
  keybindings: Array<[string, string]>,
  layout: string | null = "US",
  customKeys?: BoundKeyRow["customKeys"],
): BoundKeyRow => ({
  keybindings: keybindings.map(([action, keyCode]) => ({ action, keyCode })),
  customKeys,
  playerConfig: { keyboardLayout: layout },
});

describe("getBoundKeyLabel", () => {
  it("未割り当て・不使用・行なしは undefined（並べ替えで末尾に回す）", () => {
    expect(getBoundKeyLabel(t, row([]), "sprint")).toBeUndefined();
    expect(getBoundKeyLabel(t, row([["sprint", "_UNBOUND"]]), "sprint")).toBeUndefined();
    expect(getBoundKeyLabel(t, row([["jump", "Space"]]), "sprint")).toBeUndefined();
  });

  it("走者の配列でラベルが変わる（JIS の Backquote は半角）", () => {
    const us = getBoundKeyLabel(t, row([["sprint", "Backquote"]], "US"), "sprint");
    const jis = getBoundKeyLabel(t, row([["sprint", "Backquote"]], "JIS"), "sprint");
    expect(us).toBe("`");
    expect(jis).not.toBe(us);
  });

  it("カスタムキー名が最優先", () => {
    const r = row([["sprint", "KeyZ"]], "US", [{ keyCode: "KeyZ", keyName: "Macro" }]);
    expect(getBoundKeyLabel(t, r, "sprint")).toBe("Macro");
  });
});

describe("compareKeyLabels", () => {
  it("数字は数値順（F2 < F10）", () => {
    expect(compareKeyLabels("F2", "F10", "ja")).toBeLessThan(0);
    expect(compareKeyLabels("F10", "F2", "en")).toBeGreaterThan(0);
  });
});

describe("bindKeysMatch", () => {
  it("大文字小文字・Minecraft 形式の違いを吸収する", () => {
    expect(bindKeysMatch("key.keyboard.left.control", "ControlLeft", "US")).toBe(true);
    expect(bindKeysMatch("CONTROLLEFT", "ControlLeft", "US")).toBe(true);
    expect(bindKeysMatch("ControlLeft", "ControlRight", "US")).toBe(false);
  });

  it("JIS では半角（IntlYen と Backquote）がどちら向きでも一致する", () => {
    expect(bindKeysMatch("IntlYen", "Backquote", "JIS")).toBe(true);
    expect(bindKeysMatch("Backquote", "IntlYen", "JIS")).toBe(true);
    expect(bindKeysMatch("IntlYen", "IntlYen", "JIS_TKL")).toBe(true);
  });

  it("US では IntlYen と Backquote は別のキー", () => {
    expect(bindKeysMatch("IntlYen", "Backquote", "US")).toBe(false);
    expect(bindKeysMatch("Backquote", "IntlYen", "US")).toBe(false);
  });
});

describe("rowMatchesBind", () => {
  const sprintCtrl = row([["sprint", "ControlLeft"], ["jump", "Space"]]);

  it("条件が空なら常に true", () => {
    expect(rowMatchesBind(row([]), [])).toBe(true);
  });

  it("全条件を満たす走者だけ true（AND）", () => {
    expect(rowMatchesBind(sprintCtrl, [{ action: "sprint", keyCode: "ControlLeft" }])).toBe(true);
    expect(
      rowMatchesBind(sprintCtrl, [
        { action: "sprint", keyCode: "ControlLeft" },
        { action: "jump", keyCode: "Space" },
      ]),
    ).toBe(true);
    expect(
      rowMatchesBind(sprintCtrl, [
        { action: "sprint", keyCode: "ControlLeft" },
        { action: "jump", keyCode: "KeyZ" },
      ]),
    ).toBe(false);
  });

  it("その操作に割り当てが無い・不使用の走者は条件を満たさない", () => {
    expect(rowMatchesBind(row([]), [{ action: "sprint", keyCode: "ControlLeft" }])).toBe(false);
    expect(rowMatchesBind(row([["sprint", "_UNBOUND"]]), [{ action: "sprint", keyCode: "ControlLeft" }])).toBe(false);
  });

  it("JIS の半角は Backquote 保存の走者にも IntlYen 条件で一致する", () => {
    const jis = row([["sprint", "Backquote"]], "JIS");
    expect(rowMatchesBind(jis, [{ action: "sprint", keyCode: "IntlYen" }])).toBe(true);
    const us = row([["sprint", "Backquote"]], "US");
    expect(rowMatchesBind(us, [{ action: "sprint", keyCode: "IntlYen" }])).toBe(false);
  });
});

describe("collectBoundKeys / bindConditionLabel", () => {
  it("操作に割り当てられているキーを重複なしで、表示名の順に返す（人数順にしない）", () => {
    const rows = [
      row([["sprint", "KeyW"]]),
      row([["sprint", "ControlLeft"]]),
      row([["sprint", "key.keyboard.left.control"]]),
      row([["sprint", "Ctrl+KeyA"]]),
      row([["sprint", "_UNBOUND"]]),
      row([]),
    ];
    const keys = collectBoundKeys(t, rows, "sprint", "ja");
    expect(keys.map((k) => k.keyCode).sort()).toEqual(["ControlLeft", "KeyW"]);
    const labels = keys.map((k) => k.label);
    expect([...labels].sort((a, b) => compareKeyLabels(a, b, "ja"))).toEqual(labels);
  });

  it("チップの文言は「操作 = キー」", () => {
    expect(bindConditionLabel(t, { action: "sprint", keyCode: "ControlLeft" })).toBe(
      `${t("actionLabels.sprint")} = ${t("keyLabels.ctrlLeft")}`,
    );
  });
});

import { hasKeyBindings, hasKeyboardContent, hasMouseSettings } from "../keybindings-filter";

describe("hasKeyBindings / hasKeyboardContent / hasMouseSettings", () => {

  it("割り当てが 1 つも無い・すべて不使用の走者はキー配置なし", () => {
    expect(hasKeyBindings(row([]))).toBe(false);
    expect(hasKeyBindings(row([["sprint", "_UNBOUND"], ["jump", "_UNBOUND"]]))).toBe(false);
  });

  it("不使用以外の割り当てが 1 つでもあればキー配置あり", () => {
    expect(hasKeyBindings(row([["sprint", "_UNBOUND"], ["jump", "Space"]]))).toBe(true);
  });

  it("操作を渡すと、その操作（タブの列）の中だけで判定する", () => {
    const r = row([["forward", "_UNBOUND"], ["hotbar1", "Digit1"]]);
    expect(hasKeyBindings(r, ["forward", "jump"])).toBe(false);
    expect(hasKeyBindings(r, ["hotbar1", "drop"])).toBe(true);
  });

  it("ビジュアルはリマップ・カスタムアクションだけの走者も載せる", () => {
    expect(hasKeyboardContent({ keybindings: [] })).toBe(false);
    expect(hasKeyboardContent({ keybindings: [], keyRemaps: [{}] })).toBe(true);
    expect(hasKeyboardContent({ keybindings: [], customActions: [{}] })).toBe(true);
    expect(hasKeyboardContent({ keybindings: [{ action: "jump", keyCode: "Space" }] })).toBe(true);
  });

  it("マウス設定は DPI・感度・Windows 速度のどれか 1 つでもあれば有り", () => {
    const none = { mouseDpi: null, gameSensitivity: null, windowsSpeed: null, windowsSpeedMultiplier: null };
    expect(hasMouseSettings(null)).toBe(false);
    expect(hasMouseSettings(none)).toBe(false);
    expect(hasMouseSettings({ ...none, mouseDpi: 800 })).toBe(true);
    expect(hasMouseSettings({ ...none, windowsSpeedMultiplier: 0.5 })).toBe(true);
  });
});
