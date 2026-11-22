import { describe, expect, it } from "vitest";
import {
  INITIAL_BACK_TO_TOP_STATE,
  nextBackToTopState,
  type BackToTopState,
} from "../back-to-top";

const base = { docHeight: 5000, viewportHeight: 800, threshold: 200 };
const at = (prev: BackToTopState, y: number, extra = {}) =>
  nextBackToTopState(prev, { ...base, y, ...extra });

describe("nextBackToTopState", () => {
  it("閾値以下では隠す", () => {
    const s = at({ visible: true, anchorY: 900 }, 150);
    expect(s.visible).toBe(false);
    expect(at(INITIAL_BACK_TO_TOP_STATE, 200).visible).toBe(false);
    expect(at(INITIAL_BACK_TO_TOP_STATE, -20).visible).toBe(false);
  });

  it("下へ読み進めると隠れ、上へ戻ると出る", () => {
    let s = at({ visible: false, anchorY: 200 }, 260);
    expect(s.visible).toBe(false);
    s = at(s, 1000);
    expect(s.visible).toBe(false);
    s = at(s, 960); // 40px 上
    expect(s.visible).toBe(true);
  });

  it("小さな揺れでは切り替わらない", () => {
    let s = at({ visible: false, anchorY: 1000 }, 1000);
    s = at(s, 980);
    expect(s.visible).toBe(false);
    s = at(s, 1010);
    expect(s.visible).toBe(false);
    const v = at({ visible: true, anchorY: 1000 }, 1020);
    expect(v.visible).toBe(true);
  });

  it("下向き中に伸びた極値を基準に、上向きを判定する", () => {
    let s: BackToTopState = { visible: false, anchorY: 1000 };
    s = at(s, 1030); // 下向きだが delta 未満: 基準だけ更新
    expect(s).toEqual({ visible: false, anchorY: 1030 });
    s = at(s, 1000); // 30 戻っただけ
    expect(s.visible).toBe(false);
    s = at(s, 985); // 基準から 45 上
    expect(s.visible).toBe(true);
  });

  it("末尾付近では下向きでも出す", () => {
    const s = at({ visible: false, anchorY: 4000 }, 4100); // 残り 100
    expect(s.visible).toBe(true);
  });

  it("末尾から離れて下向きなら隠す", () => {
    const s = at({ visible: true, anchorY: 1000 }, 1100);
    expect(s.visible).toBe(false);
  });
});
