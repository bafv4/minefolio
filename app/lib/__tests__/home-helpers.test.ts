// ホーム周りで共用する小さな純粋ヘルパーのテスト
import { describe, it, expect } from "vitest";
import { isHiddenOnHome } from "../home-visibility.server";
import { groupByUserId } from "../group-by-user";
import { getRankTier, rankTierOrder } from "../mcsr-ranked-tiers";
import { toUtcDateString } from "../time-utils";
import { twitchChannelUrl } from "../home-live";

describe("isHiddenOnHome", () => {
  it("明示的に false のときだけ隠す（null・未指定・true は表示）", () => {
    expect(isHiddenOnHome({ showPacemanOnHome: false }, "paceman")).toBe(true);
    expect(isHiddenOnHome({ showPacemanOnHome: null }, "paceman")).toBe(false);
    expect(isHiddenOnHome({ showPacemanOnHome: true }, "paceman")).toBe(false);
    expect(isHiddenOnHome({}, "youtube")).toBe(false);
    expect(isHiddenOnHome({ showYoutubeOnHome: false }, "youtube")).toBe(true);
    expect(isHiddenOnHome({ showTwitchOnHome: false }, "twitch")).toBe(true);
  });

  it("種別ごとに独立（他の種別の設定は影響しない）", () => {
    const user = { showPacemanOnHome: false, showYoutubeOnHome: true, showTwitchOnHome: null };
    expect(isHiddenOnHome(user, "youtube")).toBe(false);
    expect(isHiddenOnHome(user, "twitch")).toBe(false);
  });
});

describe("groupByUserId", () => {
  it("userId ごとにまとめ、各グループ内の並びを保つ", () => {
    const rows = [
      { userId: "a", n: 1 },
      { userId: "b", n: 2 },
      { userId: "a", n: 3 },
    ];
    const grouped = groupByUserId(rows);
    expect(grouped.get("a")).toEqual([rows[0], rows[2]]);
    expect(grouped.get("b")).toEqual([rows[1]]);
    expect(grouped.get("c")).toBeUndefined();
  });
});

describe("rankTierOrder", () => {
  it("階級・サブディビジョンが上がるほど大きい", () => {
    expect(rankTierOrder(getRankTier(0))).toBeLessThan(rankTierOrder(getRankTier(500))); // Coal I < Coal III
    expect(rankTierOrder(getRankTier(500))).toBeLessThan(rankTierOrder(getRankTier(600))); // Coal III < Iron I
    expect(rankTierOrder(getRankTier(1800))).toBeLessThan(rankTierOrder(getRankTier(2000))); // Diamond III < Netherite
    expect(rankTierOrder(getRankTier(1200))).toBe(rankTierOrder(getRankTier(1299))); // 同じ Emerald I
  });
});

describe("toUtcDateString", () => {
  it("UTC の YYYY-MM-DD（ローカル時刻ではなく UTC 日）", () => {
    expect(toUtcDateString(new Date("2026-11-10T23:59:59Z"))).toBe("2026-11-10");
    expect(toUtcDateString(new Date("2026-11-11T00:00:00Z"))).toBe("2026-11-11");
  });
});

describe("twitchChannelUrl", () => {
  it("チャンネルURLを組み立て、login はエンコードする", () => {
    expect(twitchChannelUrl("FooBar")).toBe("https://www.twitch.tv/FooBar");
    expect(twitchChannelUrl("a/b")).toBe("https://www.twitch.tv/a%2Fb");
  });
});
