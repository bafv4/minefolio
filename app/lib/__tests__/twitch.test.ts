import { describe, it, expect, vi, afterEach } from "vitest";
import { parseTwitchDuration, getRecentVods } from "../twitch";

// Twitch /videos の duration 文字列（"3h12m5s" 形式）→ 秒変換の回帰テスト
describe("parseTwitchDuration", () => {
  it("時分秒の複合形式をパースする", () => {
    expect(parseTwitchDuration("3h12m5s")).toBe(3 * 3600 + 12 * 60 + 5);
    expect(parseTwitchDuration("1h0m0s")).toBe(3600);
  });

  it("部分的な形式（分のみ・秒のみ・時分など）をパースする", () => {
    expect(parseTwitchDuration("45m")).toBe(45 * 60);
    expect(parseTwitchDuration("58s")).toBe(58);
    expect(parseTwitchDuration("2h30m")).toBe(2 * 3600 + 30 * 60);
    expect(parseTwitchDuration("5m30s")).toBe(5 * 60 + 30);
  });

  it("不正な形式は null を返す", () => {
    expect(parseTwitchDuration("")).toBeNull();
    expect(parseTwitchDuration("abc")).toBeNull();
    expect(parseTwitchDuration("12")).toBeNull();
    expect(parseTwitchDuration("1s2h")).toBeNull();
  });
});

// getRecentVods: /users → /videos（ページング）の一連のHelix呼び出しを global fetch でスタブして検証する
describe("getRecentVods", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function daysAgoIso(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  function makeUsersResponse(broadcasters: Array<{ id: string; login: string }>) {
    return { ok: true, status: 200, json: async () => ({ data: broadcasters }) };
  }

  function makeVideosResponse(items: unknown[], cursor?: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: items, pagination: cursor ? { cursor } : {} }),
    };
  }

  function makeVideoItem(overrides: Record<string, unknown> = {}) {
    return {
      id: "v1",
      user_login: "runner1",
      user_name: "Runner1",
      title: "practice",
      thumbnail_url: "https://example.com/thumb-%{width}x%{height}.jpg",
      published_at: daysAgoIso(1),
      created_at: daysAgoIso(1),
      duration: "1h0m0s",
      type: "archive",
      viewable: "public",
      ...overrides,
    };
  }

  it("viewable が 'private' のVODは除外され、フィールド欠落は public 扱いになる", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/users")) {
        return makeUsersResponse([{ id: "b1", login: "runner1" }]);
      }
      if (u.includes("/videos")) {
        return makeVideosResponse([
          makeVideoItem({ id: "public1", viewable: "public" }),
          makeVideoItem({ id: "private1", viewable: "private" }),
          // viewable がAPI応答から消えた場合に全件除外→差分削除で全消し、とならないための安全側の扱い
          makeVideoItem({ id: "noviewable", viewable: undefined }),
        ]);
      }
      throw new Error(`unexpected url: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { vods, failedLogins } = await getRecentVods("cid", "token", ["runner1"]);

    expect(failedLogins.size).toBe(0);
    expect(vods.get("runner1")?.map((v) => v.id)).toEqual(["public1", "noviewable"]);
  });

  it("保持期間（cutoff）を超えた行に達したらページングを打ち切る", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/users")) {
        return makeUsersResponse([{ id: "b1", login: "runner1" }]);
      }
      if (u.includes("/videos")) {
        // cursor を返しても、cutoff（90日）超過行に達した時点で次ページは取得しないはず
        return makeVideosResponse(
          [
            makeVideoItem({ id: "recent", published_at: daysAgoIso(1) }),
            makeVideoItem({ id: "old", published_at: daysAgoIso(100) }),
          ],
          "cursor-1"
        );
      }
      throw new Error(`unexpected url: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { vods, incompleteLogins } = await getRecentVods("cid", "token", ["runner1"]);

    expect(vods.get("runner1")?.map((v) => v.id)).toEqual(["recent"]);
    const videosCalls = fetchMock.mock.calls.filter(([url]) => (url as string).toString().includes("/videos"));
    expect(videosCalls).toHaveLength(1);
    // cutoff 到達＝保持期間内は全件取得できているので「完全」（差分削除してよい）
    expect(incompleteLogins.size).toBe(0);
  });

  it("カーソルが尽きなくても安全上限（5ページ）でページングを打ち切る", async () => {
    let page = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/users")) {
        return makeUsersResponse([{ id: "b1", login: "runner1" }]);
      }
      if (u.includes("/videos")) {
        const id = `v${page}`;
        page++;
        // 常に cursor を返す＝APIが尽きるまで際限なくページがあるように見せる
        return makeVideosResponse([makeVideoItem({ id, published_at: daysAgoIso(1) })], "cursor-always");
      }
      throw new Error(`unexpected url: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { vods, incompleteLogins } = await getRecentVods("cid", "token", ["runner1"]);

    const videosCalls = fetchMock.mock.calls.filter(([url]) => (url as string).toString().includes("/videos"));
    expect(videosCalls).toHaveLength(5); // VOD_MAX_PAGES_PER_CHANNEL
    expect(vods.get("runner1")).toHaveLength(5);
    // 安全上限による打ち切りで未取得のVODが残りうる＝差分削除の対象にしてはならない
    expect(incompleteLogins.has("runner1")).toBe(true);
  });

  it("/videos 呼び出しが失敗したチャンネルは failedLogins に入り、vods にキーを持たない（差分削除を防ぐ）", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/users")) {
        return makeUsersResponse([{ id: "b1", login: "runner1" }]);
      }
      if (u.includes("/videos")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      throw new Error(`unexpected url: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { vods, failedLogins } = await getRecentVods("cid", "token", ["runner1"]);

    expect(failedLogins.has("runner1")).toBe(true);
    expect(vods.has("runner1")).toBe(false);
  });

  it("/users で解決できなかったloginも failedLogins に入る", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/users")) {
        // login解決できたのは resolvedlogin のみ。missinguser は応答に含まれない（改名・凍結等）
        return makeUsersResponse([{ id: "b1", login: "resolvedlogin" }]);
      }
      if (u.includes("/videos")) {
        return makeVideosResponse([]);
      }
      throw new Error(`unexpected url: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { vods, failedLogins } = await getRecentVods("cid", "token", ["resolvedlogin", "missinguser"]);

    expect(failedLogins.has("missinguser")).toBe(true);
    expect(vods.has("resolvedlogin")).toBe(true);
  });
});
