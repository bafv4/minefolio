import { describe, it, expect } from "vitest";
import {
  feedVideoKey,
  filterOwnVideos,
  videoRetentionCutoff,
  VIDEO_FEED_RETENTION_DAYS,
  type FeedVideo,
} from "../feed-video";

function makeVideo(overrides: Partial<FeedVideo> = {}): FeedVideo {
  return {
    platform: "youtube",
    videoId: "v1",
    title: "video",
    thumbnailUrl: null,
    channelTitle: null,
    publishedAt: new Date(),
    minefolioMcid: null,
    uuid: null,
    slug: null,
    displayName: null,
    discordAvatar: null,
    customSkinUrl: null,
    ...overrides,
  };
}

describe("feedVideoKey", () => {
  it("プラットフォームで名前空間を分ける（IDが同じでも衝突しない）", () => {
    const yt = makeVideo({ platform: "youtube", videoId: "123" });
    const tw = makeVideo({ platform: "twitch", videoId: "123" });
    expect(feedVideoKey(yt)).toBe("youtube:123");
    expect(feedVideoKey(yt)).not.toBe(feedVideoKey(tw));
  });
});

describe("videoRetentionCutoff", () => {
  it("保持期間（90日）ぶん過去の日時を返す", () => {
    const now = Date.UTC(2026, 6, 24);
    const cutoff = videoRetentionCutoff(now);
    expect(VIDEO_FEED_RETENTION_DAYS).toBe(90);
    expect(now - cutoff.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
  });
});

// /videos の件数バッジ（loader が filterOwnVideos で算出）と一覧のカードが
// 同じ判定を共有していることの回帰テスト。
// 以前はバッジが除外前の件数を表示していたため、実際のカード数とずれていた。
describe("filterOwnVideos", () => {
  const videos = [
    makeVideo({ platform: "youtube", videoId: "mine-yt", minefolioMcid: "Runner1" }),
    makeVideo({ platform: "twitch", videoId: "mine-vod", minefolioMcid: "runner1" }),
    makeVideo({ platform: "youtube", videoId: "other", minefolioMcid: "Other" }),
    makeVideo({ platform: "youtube", videoId: "unlinked", minefolioMcid: null }),
  ];

  it("両方表示する設定なら元の配列をそのまま返す", () => {
    const prefs = { mcid: "Runner1", showYoutubeOnHome: true, showTwitchOnHome: true };
    expect(filterOwnVideos(videos, prefs)).toBe(videos);
  });

  it("プラットフォームごとに自分の動画だけを除外する", () => {
    const hideYoutube = filterOwnVideos(videos, {
      mcid: "Runner1",
      showYoutubeOnHome: false,
      showTwitchOnHome: true,
    });
    expect(hideYoutube.map((v) => v.videoId)).toEqual(["mine-vod", "other", "unlinked"]);

    const hideTwitch = filterOwnVideos(videos, {
      mcid: "Runner1",
      showYoutubeOnHome: true,
      showTwitchOnHome: false,
    });
    expect(hideTwitch.map((v) => v.videoId)).toEqual(["mine-yt", "other", "unlinked"]);
  });

  it("MCIDは大文字小文字を無視して比較し、他人・未紐付けの動画は残す", () => {
    const filtered = filterOwnVideos(videos, {
      mcid: "RUNNER1",
      showYoutubeOnHome: false,
      showTwitchOnHome: false,
    });
    expect(filtered.map((v) => v.videoId)).toEqual(["other", "unlinked"]);
  });

  it("MCID未設定のユーザーは何も除外しない", () => {
    const prefs = { mcid: null, showYoutubeOnHome: false, showTwitchOnHome: false };
    expect(filterOwnVideos(videos, prefs)).toHaveLength(4);
  });
});
