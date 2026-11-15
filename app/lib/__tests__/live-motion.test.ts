import { describe, expect, it } from "vitest";
import { computeLiveFlip, reachedStages, type LivePoint } from "../live-motion";

const map = (o: Record<string, LivePoint>) => new Map(Object.entries(o));

describe("reachedStages", () => {
  it("増えた段だけを返す", () => {
    expect(reachedStages(2, 3, 7)).toEqual([3]);
    expect(reachedStages(1, 4, 7)).toEqual([2, 3, 4]);
    expect(reachedStages(0, 2, 7)).toEqual([1, 2]);
  });
  it("増えていない・戻ったときは空", () => {
    expect(reachedStages(3, 3, 7)).toEqual([]);
    expect(reachedStages(5, 2, 7)).toEqual([]);
  });
  it("総数を超えない", () => {
    expect(reachedStages(6, 9, 7)).toEqual([7]);
  });
});

describe("computeLiveFlip", () => {
  it("前回が空なら何も動かさない", () => {
    expect(computeLiveFlip(new Map(), map({ a: { x: 0, y: 0 } }))).toEqual({ moves: [], entered: [] });
  });
  it("位置の差（前回 − 今回）を返す", () => {
    const r = computeLiveFlip(map({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }), map({ a: { x: 100, y: 0 }, b: { x: 0, y: 0 } }));
    expect(r.moves).toEqual([
      { id: "a", dx: -100, dy: 0 },
      { id: "b", dx: 100, dy: 0 },
    ]);
    expect(r.entered).toEqual([]);
  });
  it("1px 未満の差は動かさない", () => {
    const r = computeLiveFlip(map({ a: { x: 0, y: 0 } }), map({ a: { x: 0.4, y: -0.9 } }));
    expect(r.moves).toEqual([]);
  });
  it("前回に無い id は新規、今回に無い id は無視", () => {
    const r = computeLiveFlip(map({ a: { x: 0, y: 0 }, gone: { x: 5, y: 5 } }), map({ a: { x: 0, y: 0 }, n: { x: 9, y: 9 } }));
    expect(r.entered).toEqual(["n"]);
    expect(r.moves).toEqual([]);
  });
});
