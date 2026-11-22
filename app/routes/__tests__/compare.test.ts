// /compare の「違う行」の判定と、?all=1 だけが変わるナビゲーションで loader を再実行しない判定の回帰テスト。
import { describe, it, expect } from "vitest";
import { compareKeyMaps, compareValues, rankSimilarPlayers, shouldRevalidate, type SimilarCandidate } from "../compare";
import { minComparableActions, sortSimilarPlayers } from "@/lib/similar-players";

describe("compareValues", () => {
  it("両方に値があって同じなら same", () => {
    expect(compareValues("KeyW", "KeyW")).toBe("same");
  });
  it("両方に値があって異なれば different", () => {
    expect(compareValues("KeyW", "KeyE")).toBe("different");
  });
  it("片方だけ設定済みなら different", () => {
    expect(compareValues("KeyW", undefined)).toBe("different");
    expect(compareValues(null, "US")).toBe("different");
  });
  it("両方未設定は unset（違いに数えない）", () => {
    expect(compareValues(undefined, null)).toBe("unset");
    expect(compareValues("", undefined)).toBe("unset");
  });
});

describe("shouldRevalidate", () => {
  const args = (current: string, next: string, defaultShouldRevalidate = true) =>
    ({
      currentUrl: new URL(current, "http://localhost"),
      nextUrl: new URL(next, "http://localhost"),
      defaultShouldRevalidate,
    }) as Parameters<typeof shouldRevalidate>[0];

  it("all だけが変わるときは再取得しない", () => {
    expect(shouldRevalidate(args("/compare?p1=a&p2=b", "/compare?p1=a&p2=b&all=1"))).toBe(false);
    expect(shouldRevalidate(args("/compare?p1=a&p2=b&all=1", "/compare?p1=a&p2=b"))).toBe(false);
  });
  it("走者が変わるときは既定に従う", () => {
    expect(shouldRevalidate(args("/compare?p1=a&p2=b", "/compare?p1=a&p2=c"))).toBe(true);
  });
});

describe("compareKeyMaps / rankSimilarPlayers（一致率の数え方）", () => {
  const p1 = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", jump: "Space" };

  const candidate = (slug: string, keybindings: Record<string, string>): SimilarCandidate =>
    ({
      id: slug,
      mcid: slug,
      uuid: null,
      slug,
      displayName: null,
      displayNameAlphabet: null,
      customSkinUrl: null,
      keybindings: Object.entries(keybindings).map(([action, keyCode]) => ({ action, keyCode })),
      configPresets: [],
    }) as unknown as SimilarCandidate;

  it("両方に設定がある操作だけを数える（片方だけ設定・両方未設定は数えない）", () => {
    const r = compareKeyMaps(p1, { forward: "KeyW", back: "KeyX" });
    expect(r).toEqual({ same: 1, different: 1, total: 2, oneSided: 3 });
  });

  it("一覧の一致率・件数は compareKeyMaps と一致する", () => {
    const theirs = { forward: "KeyW", back: "KeyS" };
    const [row] = rankSimilarPlayers(p1, [candidate("a", theirs)]);
    const direct = compareKeyMaps(p1, theirs);
    expect(row.matches).toBe(direct.same);
    expect(row.total).toBe(direct.total);
    expect(row.similarity).toBeCloseTo(direct.same / direct.total);
  });

  it("一致率の高い順に並べる", () => {
    const ranked = rankSimilarPlayers(p1, [
      candidate("half", { forward: "KeyW", back: "KeyX" }),
      candidate("all", { forward: "KeyW", back: "KeyS" }),
    ]);
    expect(ranked.map((r) => r.slug)).toEqual(["all", "half"]);
  });

  it("両方に設定のある操作が無い人は除く", () => {
    expect(rankSimilarPlayers(p1, [candidate("none", { attack: "Mouse0" }), candidate("empty", {})])).toEqual([]);
  });
});

describe("sortSimilarPlayers（分母を考慮した並び）", () => {
  const row = (slug: string, same: number, total: number) => ({ slug, total, similarity: same / total });

  it("分母が十分な 25/26 が、分母の少ない 10/10 より上に来る", () => {
    const sorted = sortSimilarPlayers([row("small", 10, 10), row("big", 25, 26)], 13);
    expect(sorted.map((r) => r.slug)).toEqual(["big", "small"]);
  });

  it("分母が足りない人は除外せず後ろに残す（その中は一致率順）", () => {
    const sorted = sortSimilarPlayers([row("s1", 5, 10), row("s2", 10, 10), row("ok", 13, 26)], 13);
    expect(sorted.map((r) => r.slug)).toEqual(["ok", "s2", "s1"]);
  });

  it("同点は分母の大きい順、さらに同じなら slug 順", () => {
    const sorted = sortSimilarPlayers([row("b", 13, 13), row("a", 13, 13), row("c", 26, 26), row("d", 14, 14)], 13);
    expect(sorted.map((r) => r.slug)).toEqual(["c", "d", "a", "b"]);
  });

  it("最低の分母は比較対象の操作数の半数以上", () => {
    expect(minComparableActions(26)).toBe(13);
    expect(minComparableActions(25)).toBe(13);
  });
});
