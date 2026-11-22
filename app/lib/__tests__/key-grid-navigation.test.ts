import { describe, it, expect } from "vitest";
import {
  findNextKeyInGrid,
  keyGridDirectionForKey,
  type KeyGridDirection,
  type KeyGridItem,
} from "../key-grid-navigation";

// 1ユニット = 60px、間隔 2px（VirtualKeyboard と同じ）
const U = 60;
const G = 2;
const key = (id: string, col: number, row: number, w = 1, h = 1): KeyGridItem => ({
  id,
  rect: {
    left: col * (U + G),
    top: row * (U + G),
    width: w * U + (w - 1) * G,
    height: h * U + (h - 1) * G,
  },
});

const DIRECTIONS: KeyGridDirection[] = ["left", "right", "up", "down", "home", "end"];

/** 起点のキーから矢印（と Home / End）だけで届くキーの集合 */
function reachable(items: KeyGridItem[], start: string = items[0].id): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const d of DIRECTIONS) {
      const next = findNextKeyInGrid(items, id, d);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** どのキーを起点にしても全キーに届くか（Tab 停止点は最後にフォーカスしたキーに残るため） */
function reachableFromEveryKey(items: KeyGridItem[]): boolean {
  return items.every((i) => reachable(items, i.id).size === items.length);
}

describe("keyGridDirectionForKey", () => {
  it("矢印・Home・End を方向に対応させ、それ以外は undefined", () => {
    expect(keyGridDirectionForKey("ArrowLeft")).toBe("left");
    expect(keyGridDirectionForKey("ArrowRight")).toBe("right");
    expect(keyGridDirectionForKey("ArrowUp")).toBe("up");
    expect(keyGridDirectionForKey("ArrowDown")).toBe("down");
    expect(keyGridDirectionForKey("Home")).toBe("home");
    expect(keyGridDirectionForKey("End")).toBe("end");
    expect(keyGridDirectionForKey("Tab")).toBeUndefined();
    expect(keyGridDirectionForKey("a")).toBeUndefined();
  });
});

describe("findNextKeyInGrid", () => {
  const grid = [
    key("q", 0, 0), key("w", 1, 0), key("e", 2, 0),
    key("a", 0, 1), key("s", 1, 1), key("d", 2, 1),
  ];

  it("←/→ は同じ段の隣のキーへ", () => {
    expect(findNextKeyInGrid(grid, "w", "right")).toBe("e");
    expect(findNextKeyInGrid(grid, "w", "left")).toBe("q");
    expect(findNextKeyInGrid(grid, "s", "right")).toBe("d");
  });

  it("↑/↓ は隣の段の x が近いキーへ", () => {
    expect(findNextKeyInGrid(grid, "w", "down")).toBe("s");
    expect(findNextKeyInGrid(grid, "d", "up")).toBe("e");
  });

  it("Home / End はその段の最初／最後のキーへ", () => {
    expect(findNextKeyInGrid(grid, "w", "home")).toBe("q");
    expect(findNextKeyInGrid(grid, "w", "end")).toBe("e");
    expect(findNextKeyInGrid(grid, "s", "end")).toBe("d");
  });

  it("行き先が無ければ null（端・すでに最初／最後・存在しない id）", () => {
    expect(findNextKeyInGrid(grid, "e", "right")).toBeNull();
    expect(findNextKeyInGrid(grid, "q", "left")).toBeNull();
    expect(findNextKeyInGrid(grid, "q", "up")).toBeNull();
    expect(findNextKeyInGrid(grid, "a", "down")).toBeNull();
    expect(findNextKeyInGrid(grid, "q", "home")).toBeNull();
    expect(findNextKeyInGrid(grid, "e", "end")).toBeNull();
    expect(findNextKeyInGrid(grid, "zzz", "right")).toBeNull();
  });

  it("まばらな配置: ↑/↓ は隣の段が空でも、キーのある最も近い段へ届く", () => {
    // テンプレート詳細のように、情報のあるキーが3個だけ（段 0・段 3・段 5）
    const sparse = [key("esc", 0, 0), key("w", 2, 2), key("space", 6, 5, 6.25)];
    expect(findNextKeyInGrid(sparse, "esc", "down")).toBe("w");
    expect(findNextKeyInGrid(sparse, "w", "down")).toBe("space");
    expect(findNextKeyInGrid(sparse, "space", "up")).toBe("w");
    expect(findNextKeyInGrid(sparse, "w", "up")).toBe("esc");
    // 同じ段に他のキーが無ければ ←/→ は動かない
    expect(findNextKeyInGrid(sparse, "w", "right")).toBeNull();
    expect(reachableFromEveryKey(sparse)).toBe(true);
  });

  it("段をまたぐ ↓ は、近い段の中で x の中心がいちばん近いキーを選ぶ", () => {
    const items = [key("top", 5, 0), key("far-left", 0, 3), key("near", 4, 3), key("below", 5, 6)];
    expect(findNextKeyInGrid(items, "top", "down")).toBe("near");
    expect(findNextKeyInGrid(items, "near", "down")).toBe("below");
  });

  describe("2段ぶんの高さのキー（JIS Enter）", () => {
    // 段 2: [ (col 12)、Enter（col 13・段 2〜3 の2段ぶん）。段 3: ] (col 12)。段 1: ^ (col 12)、¥ (col 13)
    const jis = [
      key("caret", 12, 1), key("yen", 13, 1),
      key("bracketLeft", 12, 2), key("enter", 13, 2, 1.25, 2),
      key("bracketRight", 12, 3),
      key("slash", 12, 4),
    ];

    it("どちらの段からも → で Enter に届く", () => {
      expect(findNextKeyInGrid(jis, "bracketLeft", "right")).toBe("enter");
      expect(findNextKeyInGrid(jis, "bracketRight", "right")).toBe("enter");
    });

    it("Enter から ← で同じ段のキーへ戻れる", () => {
      const left = findNextKeyInGrid(jis, "enter", "left");
      expect(["bracketLeft", "bracketRight"]).toContain(left);
    });

    it("Enter の ↑ / ↓ は Enter が覆う2段の外の段へ", () => {
      expect(findNextKeyInGrid(jis, "enter", "up")).toBe("yen");
      expect(findNextKeyInGrid(jis, "enter", "down")).toBe("slash");
    });

    it("上下の段から ↑ / ↓ で、Enter の段にある x の近いキーへ", () => {
      expect(findNextKeyInGrid(jis, "yen", "down")).toBe("enter");
      expect(findNextKeyInGrid(jis, "caret", "down")).toBe("bracketLeft");
    });

    it("どのキーからでも全キーに届く", () => {
      expect(reachableFromEveryKey(jis)).toBe(true);
    });
  });

  it("US 配列のメイン部（幅の違うキーが並ぶ6段）で、どのキーからでも全キーに届く", () => {
    // 各段のキー幅（null はスペーサー）
    const rows: (number | null)[][] = [
      [1, null, 1, 1, 1, 1, null, 1, 1, 1, 1, null, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
      [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
      [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
      [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],
      [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25],
    ];
    const items: KeyGridItem[] = [];
    rows.forEach((row, r) => {
      let col = 0;
      row.forEach((w, i) => {
        if (w !== null) items.push(key(`r${r}k${i}`, col, r, w));
        col += w ?? 0.5;
      });
    });
    expect(reachableFromEveryKey(items)).toBe(true);
  });

  it("テンキー（+ と Enter が2段ぶん）で全キーに届く", () => {
    const numpad = [
      key("num", 0, 0), key("div", 1, 0), key("mul", 2, 0), key("sub", 3, 0),
      key("7", 0, 1), key("8", 1, 1), key("9", 2, 1), key("add", 3, 1, 1, 2),
      key("4", 0, 2), key("5", 1, 2), key("6", 2, 2),
      key("1", 0, 3), key("2", 1, 3), key("3", 2, 3), key("enter", 3, 3, 1, 2),
      key("0", 0, 4, 2), key("dec", 2, 4),
    ];
    expect(reachableFromEveryKey(numpad)).toBe(true);
    expect(findNextKeyInGrid(numpad, "6", "right")).toBe("add");
    expect(findNextKeyInGrid(numpad, "dec", "right")).toBe("enter");
    expect(findNextKeyInGrid(numpad, "add", "down")).toBe("enter");
  });

  it("マウス（サイドボタン2個の縦並び＋2段ぶんの左・中・右）で全ボタンに届く", () => {
    const mouse = [
      key("side1", 0, 0), key("side2", 0, 1),
      key("left", 1, 0, 1, 2), key("middle", 2, 0, 1, 2), key("right", 3, 0, 1, 2),
      key("custom", 0, 2.1),
    ];
    expect(reachableFromEveryKey(mouse)).toBe(true);
    expect(findNextKeyInGrid(mouse, "side2", "right")).toBe("left");
    expect(findNextKeyInGrid(mouse, "right", "down")).toBe("custom");
  });
});
