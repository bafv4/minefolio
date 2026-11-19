// /compare の「違う行」の判定と、?all=1 だけが変わるナビゲーションで loader を再実行しない判定の回帰テスト。
import { describe, it, expect } from "vitest";
import { compareKeyMaps, compareValues, rankSimilarPlayers, shouldRevalidate, type SimilarCandidate } from "../compare";

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

  it("片方だけ設定の行は不一致、両方未設定は一致に数える（比較画面の要約と同じ）", () => {
    const r = compareKeyMaps(p1, { forward: "KeyW" });
    expect(r.shared).toBe(1);
    expect(r.different).toBe(4);
    expect(r.same + r.different).toBe(r.total);
    expect(r.same).toBe(r.total - 4);
  });

  it("一覧の一致率・件数は compareKeyMaps と一致する", () => {
    const theirs = { forward: "KeyW", back: "KeyS" };
    const [row] = rankSimilarPlayers(p1, [candidate("a", theirs)]);
    const direct = compareKeyMaps(p1, theirs);
    expect(row.matches).toBe(direct.same);
    expect(row.total).toBe(direct.total);
    expect(row.similarity).toBeCloseTo(direct.same / direct.total);
  });

  it("共通の操作が少ない人（2/2 一致）より、広く一致する人を上に置く", () => {
    const wide = { ...p1, attack: "Mouse0" };
    const ranked = rankSimilarPlayers(p1, [candidate("narrow", { forward: "KeyW", back: "KeyS" }), candidate("wide", wide)]);
    expect(ranked.map((r) => r.slug)).toEqual(["wide", "narrow"]);
  });

  it("両方に設定のある操作が無い人は除く", () => {
    expect(rankSimilarPlayers(p1, [candidate("none", { attack: "Mouse0" }), candidate("empty", {})])).toEqual([]);
  });
});
