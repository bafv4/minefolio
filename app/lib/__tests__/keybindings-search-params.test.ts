// /keybindings の URL パラメータ（bind: 操作＝キー、統計→表のリンク）と、操作→タブの対応
import { describe, it, expect } from "vitest";
import {
  BIND_FILTER_ACTIONS,
  buildKeybindingsTableHref,
  formatBindCondition,
  keybindingsParsers,
  MAX_USERS_IN_LINK,
  parseBindCondition,
  parseBindConditions,
  parseSort,
  formatSort,
  tabForAction,
  upsertBindCondition,
} from "../keybindings-search-params";

describe("bind（操作＝キー）の parse / format", () => {
  it("往復できる", () => {
    const cond = { action: "sprint", keyCode: "ControlLeft" };
    expect(formatBindCondition(cond)).toBe("sprint:ControlLeft");
    expect(parseBindCondition("sprint:ControlLeft")).toEqual(cond);
  });

  it("最初の ':' だけで分ける（キー側に ':' や '+' があってもそのまま）", () => {
    expect(parseBindCondition("sprint:Ctrl+KeyA")).toEqual({ action: "sprint", keyCode: "Ctrl+KeyA" });
    expect(parseBindCondition("jump:a:b")).toEqual({ action: "jump", keyCode: "a:b" });
  });

  it("不正な値は null（未知の操作・':' なし・空のキー・空の操作）", () => {
    expect(parseBindCondition("bogus:KeyA")).toBeNull();
    expect(parseBindCondition("sprint")).toBeNull();
    expect(parseBindCondition("sprint:")).toBeNull();
    expect(parseBindCondition(":KeyA")).toBeNull();
    expect(parseBindCondition("")).toBeNull();
  });

  it("配列では不正な要素を捨て、同じ操作は後のものに置き換える", () => {
    expect(
      parseBindConditions(["sprint:KeyA", "garbage", "jump:Space", "sprint:KeyB"]),
    ).toEqual([
      { action: "sprint", keyCode: "KeyB" },
      { action: "jump", keyCode: "Space" },
    ]);
  });

  it("upsert は同じ操作を置き換え、無効な要素を捨てる", () => {
    expect(
      upsertBindCondition(["sprint:KeyA", "x"], { action: "sprint", keyCode: "KeyB" }),
    ).toEqual(["sprint:KeyB"]);
    expect(
      upsertBindCondition(["sprint:KeyA"], { action: "jump", keyCode: "Space" }),
    ).toEqual(["sprint:KeyA", "jump:Space"]);
  });

  it("nuqs の parser（カンマ区切りの配列）で往復できる", () => {
    const parser = keybindingsParsers.bind;
    const raws = ["sprint:ControlLeft", "jump:Space"];
    const serialized = parser.serialize(raws);
    expect(serialized).toBe("sprint:ControlLeft,jump:Space");
    expect(parser.parse(serialized)).toEqual(raws);
  });

  it("選べる操作はすべて表のタブに対応する", () => {
    for (const action of BIND_FILTER_ACTIONS) {
      expect(tabForAction(action), action).not.toBeNull();
    }
  });
});

describe("tabForAction", () => {
  it("操作が載っているタブを返す", () => {
    expect(tabForAction("sprint")).toBe("movement");
    expect(tabForAction("hotbar3")).toBe("inventory");
    expect(tabForAction("swapHands")).toBe("inventory");
    expect(tabForAction("attack")).toBe("combat-ui");
    expect(tabForAction("unknownAction")).toBeNull();
  });
});

describe("buildKeybindingsTableHref", () => {
  it("tab と users を既存のパラメータ名で組み立てる", () => {
    const href = buildKeybindingsTableHref({ tab: "mouse", users: ["a", "b-c"] });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/keybindings");
    expect(url.searchParams.get("tab")).toBe("mouse");
    expect(url.searchParams.get("users")).toBe("a,b-c");
  });

  it("bind を載せられる", () => {
    const href = buildKeybindingsTableHref({
      tab: "movement",
      bind: [{ action: "sprint", keyCode: "ControlLeft" }],
    });
    expect(new URL(href, "http://x").searchParams.get("bind")).toBe("sprint:ControlLeft");
  });

  it("users / bind が空なら付けない", () => {
    const url = new URL(buildKeybindingsTableHref({ tab: "remaps", users: [], bind: [] }), "http://x");
    expect(url.searchParams.has("users")).toBe(false);
    expect(url.searchParams.has("bind")).toBe(false);
    expect(url.searchParams.get("tab")).toBe("remaps");
  });

  it("users の上限は 100 人", () => {
    expect(MAX_USERS_IN_LINK).toBe(100);
  });
});

describe("sort（キー名）", () => {
  it("action.<操作> の sort を往復できる", () => {
    expect(parseSort(formatSort("action.sprint", "asc"))).toEqual({
      key: "action.sprint",
      direction: "asc",
    });
  });
});
