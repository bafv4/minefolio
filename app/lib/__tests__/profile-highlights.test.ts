import { describe, expect, it } from "vitest";
import {
  pickHighlightPb,
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
  it("記録時間が 0 以下の run は選ばない（ピン留め・一致・place のどの段階でも）", () => {
    const zero = pb("zero", 1, 0, "Any% Glitchless", "Random Seed");
    const neg = pb("neg", 1, -5, "All Advancements");
    expect(pickHighlightSpeedrunComPb("rsg", [zero, ssg], [], ["zero"])?.run.id).toBe("ssg");
    expect(pickHighlightSpeedrunComPb("rsg", [zero, aa], [], [])?.run.id).toBe("aa");
    expect(pickHighlightSpeedrunComPb(null, [zero, neg, rsg], [], [])?.run.id).toBe("rsg");
    expect(pickHighlightSpeedrunComPb("rsg", [zero, neg], [], [])).toBeNull();
  });
  it("メインカテゴリ一致が複数あれば最速を選ぶ", () => {
    const slow = pb("slow", 1, 900, "Any% Glitchless", "Random Seed");
    const fast = pb("fast", 30, 700, "Any% Glitchless", "Random Seed");
    expect(pickHighlightSpeedrunComPb("rsg", [slow, fast], [], [])?.run.id).toBe("fast");
  });
  it("ILは一致扱いにならず place 判定に回る", () => {
    const il = pb("il", 50, 100, "Any% Glitchless", "Random Seed", { level: "lv" });
    expect(pickHighlightSpeedrunComPb("rsg", [il, aa], [], [])?.run.id).toBe("aa");
  });
  it("同順位は並びの先頭", () => {
    const a = pb("a", 2, 900, "X");
    const b = pb("b", 2, 800, "Y");
    expect(pickHighlightSpeedrunComPb(null, [a, b], [], [])?.run.id).toBe("a");
  });
  it("選ばれた PB は常に非表示集合の外（表示対象に含まれる）", () => {
    const all = [rsg, aa, ssg];
    for (const main of ["rsg", "ssg", "aa", "ce", null]) {
      for (const hidden of [[], ["rsg"], ["aa", "ssg"], ["rsg", "aa"]]) {
        const picked = pickHighlightSpeedrunComPb(main, all, hidden, ["rsg", "aa"]);
        if (picked) expect(hidden).not.toContain(picked.run.id);
      }
    }
  });
});

describe("pickHighlightPb（手入力 PB。非 null なら speedrun.com の PB は使わない）", () => {
  const rec = (category: string, personalBest: number | null) => ({
    category,
    categoryDisplayName: category,
    personalBest,
  });
  it("メインカテゴリ一致の最速を matched: true で返す", () => {
    const r = pickHighlightPb("rsg", [rec("ssg", 100), rec("rsg_any", 900), rec("rsg-any", 800)], true);
    expect(r?.record.category).toBe("rsg-any");
    expect(r?.matched).toBe(true);
  });
  it("一致が無ければ allowFallback のとき先頭の PB 付き記録（matched: false）", () => {
    const r = pickHighlightPb("rsg", [rec("aa", null), rec("ssg", 700), rec("aa", 500)], true);
    expect(r?.record.personalBest).toBe(700);
    expect(r?.matched).toBe(false);
    expect(pickHighlightPb("rsg", [rec("ssg", 700)], false)).toBeNull();
  });
  it("PB が 0 以下・null の記録は無視し、無ければ null（speedrun.com へフォールバックする側）", () => {
    expect(pickHighlightPb("rsg", [rec("rsg", 0), rec("rsg", null), rec("rsg", -1)], true)).toBeNull();
    expect(pickHighlightPb("rsg", [], true)).toBeNull();
  });
  it("mainCategory が other / 未設定ならフォールバックのみ", () => {
    expect(pickHighlightPb("other", [rec("other", 100)], false)).toBeNull();
    expect(pickHighlightPb(null, [rec("x", 100)], true)?.matched).toBe(false);
  });
});
