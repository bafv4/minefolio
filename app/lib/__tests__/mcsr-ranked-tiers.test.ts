// MCSR Ranked の階級（レート帯）算出。
// 閾値テーブル（TIER_THRESHOLDS）の境界値（各階級・サブディビジョンの切り替わり）を
// 実値で固定する。誤ると黙って一段違う階級を表示することになるため全境界を明示的に検証する。
import { describe, it, expect } from "vitest";
import { getRankTier } from "../mcsr-ranked-tiers";

describe("getRankTier", () => {
  it("負値は Coal I 扱い", () => {
    expect(getRankTier(-5)).toEqual({ key: "coal", division: 1, label: "Coal I" });
  });

  it.each([
    // [eloRate, key, division, label]
    [0, "coal", 1, "Coal I"],
    [399, "coal", 1, "Coal I"],
    [400, "coal", 2, "Coal II"],
    [499, "coal", 2, "Coal II"],
    [500, "coal", 3, "Coal III"],
    [599, "coal", 3, "Coal III"],
    [600, "iron", 1, "Iron I"],
    [899, "iron", 3, "Iron III"],
    [900, "gold", 1, "Gold I"],
    [1199, "gold", 3, "Gold III"],
    [1200, "emerald", 1, "Emerald I"],
    [1499, "emerald", 3, "Emerald III"],
    [1500, "diamond", 1, "Diamond I"],
    [1649, "diamond", 1, "Diamond I"],
    [1650, "diamond", 2, "Diamond II"],
    [1799, "diamond", 2, "Diamond II"],
    [1800, "diamond", 3, "Diamond III"],
    [1999, "diamond", 3, "Diamond III"],
    [2000, "netherite", null, "Netherite"],
    [3000, "netherite", null, "Netherite"],
  ] as const)("eloRate=%i は key=%s division=%s label=%s", (eloRate, key, division, label) => {
    expect(getRankTier(eloRate)).toEqual({ key, division, label });
  });

  it("Iron の各サブディビジョン境界（700/800）", () => {
    expect(getRankTier(699)).toEqual({ key: "iron", division: 1, label: "Iron I" });
    expect(getRankTier(700)).toEqual({ key: "iron", division: 2, label: "Iron II" });
    expect(getRankTier(799)).toEqual({ key: "iron", division: 2, label: "Iron II" });
    expect(getRankTier(800)).toEqual({ key: "iron", division: 3, label: "Iron III" });
  });

  it("Gold の各サブディビジョン境界（1000/1100）", () => {
    expect(getRankTier(999)).toEqual({ key: "gold", division: 1, label: "Gold I" });
    expect(getRankTier(1000)).toEqual({ key: "gold", division: 2, label: "Gold II" });
    expect(getRankTier(1099)).toEqual({ key: "gold", division: 2, label: "Gold II" });
    expect(getRankTier(1100)).toEqual({ key: "gold", division: 3, label: "Gold III" });
  });

  it("Emerald の各サブディビジョン境界（1300/1400）", () => {
    expect(getRankTier(1299)).toEqual({ key: "emerald", division: 1, label: "Emerald I" });
    expect(getRankTier(1300)).toEqual({ key: "emerald", division: 2, label: "Emerald II" });
    expect(getRankTier(1399)).toEqual({ key: "emerald", division: 2, label: "Emerald II" });
    expect(getRankTier(1400)).toEqual({ key: "emerald", division: 3, label: "Emerald III" });
  });

  it("非有限値（NaN）は 0 扱い（Coal I）", () => {
    expect(getRankTier(NaN)).toEqual({ key: "coal", division: 1, label: "Coal I" });
  });
});
