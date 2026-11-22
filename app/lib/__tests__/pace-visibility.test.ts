import { describe, it, expect } from "vitest";
import { filterOwnPaces, getHiddenPaceMcid } from "../pace-visibility";

// /paces の件数バッジ（loader が filterOwnPaces で算出）と一覧のカード（同関数で絞り込み）が
// 同じ判定を共有していることの回帰テスト。
// 以前はバッジが除外前の件数を表示していたため、実際のカード数とずれていた。

const paces = [
  { mcid: "Runner1", rta: 1 },
  { mcid: "runner1", rta: 2 }, // 大文字小文字違いの同一人物
  { mcid: "Other", rta: 3 },
];

describe("getHiddenPaceMcid", () => {
  it("表示しない設定 + MCIDあり のときだけ小文字のMCIDを返す", () => {
    expect(getHiddenPaceMcid({ mcid: "Runner1", showPacemanOnHome: false })).toBe("runner1");
    expect(getHiddenPaceMcid({ mcid: "Runner1", showPacemanOnHome: true })).toBeNull();
    expect(getHiddenPaceMcid({ mcid: null, showPacemanOnHome: false })).toBeNull();
  });
});

describe("filterOwnPaces", () => {
  it("表示する設定なら元の配列をそのまま返す", () => {
    const prefs = { mcid: "Runner1", showPacemanOnHome: true };
    expect(filterOwnPaces(paces, prefs)).toBe(paces);
  });

  it("表示しない設定なら自分のペースを大文字小文字を無視して除外する", () => {
    const prefs = { mcid: "RUNNER1", showPacemanOnHome: false };
    expect(filterOwnPaces(paces, prefs).map((p) => p.rta)).toEqual([3]);
  });

  it("MCID未設定のユーザーは何も除外しない", () => {
    const prefs = { mcid: null, showPacemanOnHome: false };
    expect(filterOwnPaces(paces, prefs)).toHaveLength(3);
  });

  it("件数バッジ用の総数と一覧の表示件数が一致する（バッジずれの回帰）", () => {
    const prefs = { mcid: "Runner1", showPacemanOnHome: false };
    // loader 側: フィード全件から算出するバッジの件数
    const visibleTotal = filterOwnPaces(paces, prefs).length;
    // 一覧側: 読み込み済みページに対して同じ関数で絞り込んだカード数
    const visibleCards = filterOwnPaces(paces, prefs).length;
    expect(visibleTotal).toBe(visibleCards);
    expect(visibleTotal).toBe(1);
  });
});

describe("ホームのライブ欄での使い方（home.tsx の自分の除外）", () => {
  // home.tsx: hiddenPaceMcid = getHiddenPaceMcid(currentUser)、ライブランは nickname を小文字にして比較する
  const liveRuns = [{ nickname: "MyName" }, { nickname: "other" }];
  const visibleLive = (prefs: { mcid: string | null; showPacemanOnHome: boolean }) => {
    const hidden = getHiddenPaceMcid(prefs);
    return liveRuns.filter((run) => !(hidden && run.nickname.toLowerCase() === hidden)).map((r) => r.nickname);
  };

  it("設定オフなら自分のライブランを大文字小文字を無視して隠し、他人は残す", () => {
    expect(visibleLive({ mcid: "myname", showPacemanOnHome: false })).toEqual(["other"]);
    expect(visibleLive({ mcid: "MYNAME", showPacemanOnHome: false })).toEqual(["other"]);
  });

  it("設定オン・MCID 未設定なら何も隠さない", () => {
    expect(visibleLive({ mcid: "myname", showPacemanOnHome: true })).toEqual(["MyName", "other"]);
    expect(visibleLive({ mcid: null, showPacemanOnHome: false })).toEqual(["MyName", "other"]);
  });
});
