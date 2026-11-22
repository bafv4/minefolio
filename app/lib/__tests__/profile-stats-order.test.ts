import { describe, expect, it } from "vitest";
import { orderStatsSections } from "../profile-stats-order";

const DEFAULT = ["ranked", "paceman", "speedruncom"];

describe("orderStatsSections", () => {
  it("ranked は MCSR Ranked が先頭", () => {
    expect(orderStatsSections("ranked")).toEqual(["ranked", "paceman", "speedruncom"]);
  });
  it.each(["rsg", "ssg", "aa", "ce"])("%s は Speedrun.com が先頭", (c) => {
    expect(orderStatsSections(c)).toEqual(["speedruncom", "ranked", "paceman"]);
  });
  it.each([["other"], [null], [undefined], [""], ["unknown"], ["RSG"]])("%j は既定の並び", (c) => {
    expect(orderStatsSections(c as string | null | undefined)).toEqual(DEFAULT);
  });
  it("毎回新しい配列で、3 要素を重複なく含む", () => {
    for (const c of ["ranked", "rsg", "other", null]) {
      const a = orderStatsSections(c);
      const b = orderStatsSections(c);
      expect(a).not.toBe(b);
      expect(new Set(a).size).toBe(3);
      expect([...a].sort()).toEqual([...DEFAULT].sort());
    }
    // 返り値を書き換えても次の呼び出しに影響しない
    orderStatsSections(null).reverse();
    expect(orderStatsSections(null)).toEqual(DEFAULT);
  });
});
