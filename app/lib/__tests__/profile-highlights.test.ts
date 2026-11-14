import { describe, expect, it } from "vitest";
import {
  nextTileOffset,
  normalizeLoopScroll,
  pickHighlightSpeedrunComPb,
  speedrunComPbMatchesMainCategory,
  type HighlightSpeedrunComPb,
} from "../profile-highlights";

function pb(
  id: string,
  place: number,
  time: number,
  categoryName: string,
  seedLabel?: string,
  extra: Partial<HighlightSpeedrunComPb["run"]> = {},
): HighlightSpeedrunComPb {
  return {
    place,
    run: { id, times: { primary_t: time }, values: seedLabel ? { v1: "x" } : {}, ...extra },
    category: {
      data: {
        name: categoryName,
        variables: seedLabel ? { data: [{ id: "v1", values: { values: { x: { label: seedLabel } } } }] } : { data: [] },
      },
    },
  };
}

describe("speedrunComPbMatchesMainCategory", () => {
  it("Any% + Random Seed は rsg、Set Seed は ssg にだけ一致する", () => {
    const r = pb("a", 5, 900, "Any% Glitchless", "Random Seed");
    const s = pb("b", 5, 900, "Any% Glitchless", "Set Seed");
    expect(speedrunComPbMatchesMainCategory(r, "rsg")).toBe(true);
    expect(speedrunComPbMatchesMainCategory(r, "ssg")).toBe(false);
    expect(speedrunComPbMatchesMainCategory(s, "ssg")).toBe(true);
  });
  it("シード種別が不明なら一致させない", () => {
    expect(speedrunComPbMatchesMainCategory(pb("a", 1, 900, "Any% Glitchless"), "rsg")).toBe(false);
  });
  it("AA は名前で一致、ce/ranked/other は常に不一致", () => {
    const aa = pb("a", 1, 900, "All Advancements");
    expect(speedrunComPbMatchesMainCategory(aa, "aa")).toBe(true);
    expect(speedrunComPbMatchesMainCategory(aa, "ce")).toBe(false);
    expect(speedrunComPbMatchesMainCategory(aa, "ranked")).toBe(false);
  });
  it("ILは対象外", () => {
    expect(speedrunComPbMatchesMainCategory(pb("a", 1, 9, "Any%", "Random Seed", { level: "l1" }), "rsg")).toBe(false);
  });
});

describe("pickHighlightSpeedrunComPb", () => {
  const rsg = pb("rsg", 20, 800, "Any% Glitchless", "Random Seed");
  const aa = pb("aa", 3, 5000, "All Advancements");
  const ssg = pb("ssg", 9, 700, "Any% Glitchless", "Set Seed");

  it("ピン留めを最優先し、並びの先頭を取る", () => {
    expect(pickHighlightSpeedrunComPb("rsg", [rsg, aa, ssg], [], ["ssg", "aa"])?.run.id).toBe("aa");
  });
  it("ピン留めが無ければメインカテゴリ一致", () => {
    expect(pickHighlightSpeedrunComPb("rsg", [aa, ssg, rsg], [], [])?.run.id).toBe("rsg");
  });
  it("一致が無ければ place 最上位", () => {
    expect(pickHighlightSpeedrunComPb("ce", [rsg, aa, ssg], [], [])?.run.id).toBe("aa");
    expect(pickHighlightSpeedrunComPb(null, [rsg, ssg], [], [])?.run.id).toBe("ssg");
  });
  it("非表示は全段階で除外する", () => {
    expect(pickHighlightSpeedrunComPb("rsg", [rsg, aa], ["rsg"], ["rsg"])?.run.id).toBe("aa");
    expect(pickHighlightSpeedrunComPb("rsg", [rsg], ["rsg"], [])).toBeNull();
  });
  it("PB が無ければ null", () => {
    expect(pickHighlightSpeedrunComPb("rsg", [], [], [])).toBeNull();
  });
});

describe("ループ自動スクロールの位置計算", () => {
  it("nextTileOffset は現在位置より右の最初のタイルへ進む（複製側も含む）", () => {
    const offsets = [0, 100, 200, 300, 400, 500]; // 元3枚 + 複製3枚、period=300
    expect(nextTileOffset(0, offsets)).toBe(100);
    expect(nextTileOffset(200, offsets)).toBe(300);
    expect(nextTileOffset(500, offsets)).toBeNull();
  });
  it("normalizeLoopScroll は複製側の位置を元セットの対応位置へ戻し、元セット内は変えない", () => {
    expect(normalizeLoopScroll(0, 300)).toBe(0);
    expect(normalizeLoopScroll(299, 300)).toBe(299);
    expect(normalizeLoopScroll(300, 300)).toBe(0);
    expect(normalizeLoopScroll(350, 300)).toBe(50);
    expect(normalizeLoopScroll(100, 0)).toBe(100);
  });
  it("継ぎ目: 末尾 → 複製先頭（=period）→ 戻した後に次の進みが連続する", () => {
    const offsets = [0, 100, 200, 300, 400, 500];
    let pos = 200;
    pos = nextTileOffset(pos, offsets)!; // 300 = 複製の先頭
    expect(pos).toBe(300);
    pos = normalizeLoopScroll(pos, 300); // 0 へ瞬時に戻す（見た目は同一）
    expect(pos).toBe(0);
    expect(nextTileOffset(pos, offsets)).toBe(100);
  });
});
