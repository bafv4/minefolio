import { describe, it, expect } from "vitest";
import { serializeSearchCraftLoops, serializeSearchCrafts } from "../preset-utils";
import type { SearchCraft, SearchCraftLoop } from "../schema";

const NOW = new Date();

function makeCraft(overrides: Partial<SearchCraft> & Pick<SearchCraft, "id" | "sequence">): SearchCraft {
  return {
    userId: "user-1",
    items: "[]",
    keys: "[]",
    searchStr: null,
    comment: null,
    timing: null,
    withShift: false,
    searchVariations: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeLoop(
  overrides: Partial<SearchCraftLoop> & Pick<SearchCraftLoop, "id" | "sequence" | "steps">,
): SearchCraftLoop {
  return {
    userId: "user-1",
    comment: null,
    timing: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("serializeSearchCraftLoops", () => {
  it("craftId を同一スナップショット内 crafts の sequence（craftSeq）へ変換する", () => {
    const crafts = [makeCraft({ id: "c1", sequence: 1 }), makeCraft({ id: "c2", sequence: 2 })];
    const loops = [
      makeLoop({
        id: "loop1",
        sequence: 1,
        steps: JSON.stringify([
          { craftId: "c1", transition: null },
          { craftId: "c2", transition: { type: "backspace", bsCount: 1 } },
        ]),
      }),
    ];
    const json = serializeSearchCraftLoops(loops, crafts);
    expect(JSON.parse(json!)).toEqual([
      {
        sequence: 1,
        steps: [
          { craftSeq: 1, transition: null },
          { craftSeq: 2, transition: { type: "backspace", bsCount: 1 } },
        ],
        comment: null,
        timing: null,
      },
    ]);
  });

  it("参照切れステップ（crafts に存在しない craftId）は除去する", () => {
    const crafts = [
      makeCraft({ id: "c1", sequence: 1 }),
      makeCraft({ id: "c2", sequence: 2 }),
      makeCraft({ id: "c3", sequence: 3 }),
    ];
    const loops = [
      makeLoop({
        id: "loop1",
        sequence: 1,
        steps: JSON.stringify([
          { craftId: "c1", transition: null },
          { craftId: "missing", transition: { type: "backspace", bsCount: 1 } },
          { craftId: "c3", transition: { type: "selectAll" } },
        ]),
      }),
    ];
    const result = JSON.parse(serializeSearchCraftLoops(loops, crafts)!);
    expect(result[0].steps).toEqual([
      { craftSeq: 1, transition: null },
      { craftSeq: 3, transition: { type: "selectAll" } },
    ]);
  });

  it("先頭ステップの参照が切れて繰り上がった場合、新しい先頭の transition を null にリセットする", () => {
    // c1 は crafts に存在しない（削除済みエントリを想定）
    const crafts = [makeCraft({ id: "c2", sequence: 2 }), makeCraft({ id: "c3", sequence: 3 })];
    const loops = [
      makeLoop({
        id: "loop1",
        sequence: 1,
        steps: JSON.stringify([
          { craftId: "c1", transition: null },
          { craftId: "c2", transition: { type: "backspace", bsCount: 1 } },
          { craftId: "c3", transition: { type: "selectAll" } },
        ]),
      }),
    ];
    const result = JSON.parse(serializeSearchCraftLoops(loops, crafts)!);
    expect(result[0].steps).toEqual([
      { craftSeq: 2, transition: null },
      { craftSeq: 3, transition: { type: "selectAll" } },
    ]);
  });

  it("除去後に2件未満になった Loop は丸ごと除去する", () => {
    const crafts = [makeCraft({ id: "c1", sequence: 1 })];
    const loops = [
      makeLoop({
        id: "loop1",
        sequence: 1,
        steps: JSON.stringify([
          { craftId: "c1", transition: null },
          { craftId: "missing", transition: { type: "backspace", bsCount: 1 } },
        ]),
      }),
    ];
    expect(serializeSearchCraftLoops(loops, crafts)).toBeNull();
  });

  it("Loop が0件になった場合は null を返す", () => {
    expect(serializeSearchCraftLoops([], [])).toBeNull();
  });
});

describe("serializeSearchCrafts", () => {
  it("searchVariations 列があればそれを variations として出力する（searchStr/withShift は既存どおりミラー）", () => {
    const crafts = [
      makeCraft({
        id: "c1",
        sequence: 1,
        searchStr: "en",
        withShift: false,
        searchVariations: JSON.stringify([
          { str: "en", withShift: false },
          { str: "er", withShift: true },
        ]),
      }),
    ];
    const [data] = JSON.parse(serializeSearchCrafts(crafts));
    expect(data.variations).toEqual([
      { str: "en", withShift: false },
      { str: "er", withShift: true },
    ]);
    expect(data.searchStr).toBe("en");
    expect(data.withShift).toBe(false);
  });

  it("searchVariations 列が無い（旧データ）場合は searchStr/withShift から1件合成する", () => {
    const crafts = [
      makeCraft({ id: "c1", sequence: 1, searchStr: "cra", withShift: true, searchVariations: null }),
    ];
    const [data] = JSON.parse(serializeSearchCrafts(crafts));
    expect(data.variations).toEqual([{ str: "cra", withShift: true }]);
  });

  it("searchVariations が破損JSONの場合も searchStr/withShift から合成してフォールバックする", () => {
    const crafts = [
      makeCraft({
        id: "c1",
        sequence: 1,
        searchStr: "cra",
        withShift: false,
        searchVariations: "not json",
      }),
    ];
    const [data] = JSON.parse(serializeSearchCrafts(crafts));
    expect(data.variations).toEqual([{ str: "cra", withShift: false }]);
  });

  it("DB行の searchStr/withShift 列は第1バリエーションのミラーとしてそのまま書き込まれる（正常運用時は一致する）", () => {
    const crafts = [
      makeCraft({
        id: "c1",
        sequence: 1,
        searchStr: "en",
        withShift: false,
        searchVariations: JSON.stringify([{ str: "en", withShift: false }]),
      }),
    ];
    const [data] = JSON.parse(serializeSearchCrafts(crafts));
    expect(data.variations[0]).toEqual({ str: data.searchStr, withShift: data.withShift });
  });
});
