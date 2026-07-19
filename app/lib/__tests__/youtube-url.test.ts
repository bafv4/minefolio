import { describe, it, expect } from "vitest";
import { getYouTubeVideoId, getYouTubeEmbedUrl, getYouTubeThumbnailUrl } from "../youtube-url";

describe("getYouTubeVideoId", () => {
  it("watch?v= 形式を解析する", () => {
    expect(getYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(getYouTubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s")).toBe("dQw4w9WgXcQ");
    expect(getYouTubeVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("youtu.be 短縮形式を解析する", () => {
    expect(getYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(getYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc123")).toBe("dQw4w9WgXcQ");
  });

  it("live / shorts / embed 形式を解析する（Firefoxブロック問題の回帰テスト）", () => {
    expect(getYouTubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(getYouTubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared")).toBe("dQw4w9WgXcQ");
    expect(getYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(getYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("解析できないURLは null を返す（生URLを埋め込まないため）", () => {
    expect(getYouTubeVideoId("https://www.youtube.com/@channelname")).toBeNull();
    expect(getYouTubeVideoId("https://www.youtube.com/playlist?list=PLxyz")).toBeNull();
    expect(getYouTubeVideoId("https://www.twitch.tv/somechannel")).toBeNull();
    expect(getYouTubeVideoId("not a url")).toBeNull();
    expect(getYouTubeVideoId("")).toBeNull();
    expect(getYouTubeVideoId("javascript:alert(1)")).toBeNull();
  });
});

describe("getYouTubeEmbedUrl", () => {
  it("embed URL へ変換し、変換できなければ null", () => {
    expect(getYouTubeEmbedUrl("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
    expect(getYouTubeEmbedUrl("https://example.com/video")).toBeNull();
  });
});

describe("getYouTubeThumbnailUrl", () => {
  it("サムネイルURLを返し、解決できなければ null", () => {
    expect(getYouTubeThumbnailUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(getYouTubeThumbnailUrl("https://example.com")).toBeNull();
  });
});
