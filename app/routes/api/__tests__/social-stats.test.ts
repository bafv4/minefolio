import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  schema,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

// 外部API層（YouTube Data API / Twitch Helix）はモックし、実フェッチさせない。
// ルート本体の可視性ゲート・キャッシュ・レスポンス形状を実DB（in-memory libSQL）で検証する。
// vi.mock は先頭へ巻き上げられるため、モック関数は vi.hoisted で用意する。
const youtubeMocks = vi.hoisted(() => ({
  getChannelStats: vi.fn(),
}));
const twitchMocks = vi.hoisted(() => ({
  getTwitchAppToken: vi.fn(),
  getChannelStats: vi.fn(),
}));

vi.mock("@/lib/youtube", () => youtubeMocks);
vi.mock("@/lib/twitch", () => twitchMocks);

import { loader } from "../social-stats";

// loader は内部で createDb()（= process.env.TURSO_DATABASE_URL）を使うため、
// 共有メモリ DB に向けて同一 URL でシードする（home-user-data.server.test.ts と同じ方式）
const SHARED_URL = "file::memory:?cache=shared";

const ENV_KEYS = [
  "TURSO_DATABASE_URL",
  "YOUTUBE_API_KEY",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "BETTER_AUTH_SECRET",
  "APP_URL",
] as const;

let db: TestDb;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function makeRequest(slug?: string) {
  const url = slug
    ? `https://minefolio.app/api/social-stats?slug=${encodeURIComponent(slug)}`
    : "https://minefolio.app/api/social-stats";
  return new Request(url);
}

async function callLoader(slug?: string): Promise<Response> {
  return loader({ request: makeRequest(slug), params: {}, context: {} } as never);
}

async function seedSocialLink(
  userId: string,
  platform: "youtube" | "twitch",
  identifier: string,
) {
  await db.insert(schema.socialLinks).values({ userId, platform, identifier });
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
  }
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  process.env.YOUTUBE_API_KEY = "test-youtube-key";
  process.env.TWITCH_CLIENT_ID = "test-twitch-id";
  process.env.TWITCH_CLIENT_SECRET = "test-twitch-secret";
  process.env.BETTER_AUTH_SECRET = "test-better-auth-secret";
  process.env.APP_URL = "https://minefolio.app";
  // 毎テストまっさらなスキーマを貼り直す（api_cache も空になるためDBキャッシュも隔離される）
  db = await createTestDbAt(SHARED_URL);

  youtubeMocks.getChannelStats.mockResolvedValue({
    subscriberCount: 12000,
    latestVideoAt: "2026-07-20T12:00:00Z",
  });
  twitchMocks.getTwitchAppToken.mockResolvedValue("test-app-token");
  twitchMocks.getChannelStats.mockResolvedValue({
    followerCount: 3400,
    isLive: false,
    lastStreamAt: "2026-07-22T20:00:00Z",
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("/api/social-stats - 入力と存在チェック", () => {
  it("slug なしは 400", async () => {
    const res = await callLoader();
    expect(res.status).toBe(400);
  });

  it("存在しない slug は 404", async () => {
    const res = await callLoader("no-such-user");
    expect(res.status).toBe(404);
  });
});

describe("/api/social-stats - 可視性ゲート", () => {
  it("private プロフィールは未ログインでは 404 で、外部APIも呼ばない", async () => {
    const user = await seedUser(db, { slug: "hidden", profileVisibility: "private" });
    await seedSocialLink(user.id, "youtube", "hiddenchannel");

    const res = await callLoader("hidden");

    expect(res.status).toBe(404);
    expect(youtubeMocks.getChannelStats).not.toHaveBeenCalled();
    expect(twitchMocks.getChannelStats).not.toHaveBeenCalled();
  });

  it("unlisted プロフィールは取得できる", async () => {
    const user = await seedUser(db, { slug: "unlisted1", profileVisibility: "unlisted" });
    await seedSocialLink(user.id, "twitch", "unlistedtv");

    const res = await callLoader("unlisted1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.twitch).toEqual({
      followerCount: 3400,
      isLive: false,
      lastStreamAt: "2026-07-22T20:00:00Z",
    });
  });
});

describe("/api/social-stats - レスポンス形状とキャッシュ", () => {
  it("public プロフィールの YouTube/Twitch 統計を返し、CDNキャッシュヘッダーを付ける", async () => {
    const user = await seedUser(db, { slug: "Runner1", profileVisibility: "public" });
    await seedSocialLink(user.id, "youtube", "runnerchannel");
    await seedSocialLink(user.id, "twitch", "runnertv");

    // slug は大文字小文字を無視して一致する（プロフィールページ本体と同じ）
    const res = await callLoader("runner1");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=");
    const body = await res.json();
    expect(body).toEqual({
      youtube: { subscriberCount: 12000, latestVideoAt: "2026-07-20T12:00:00Z" },
      twitch: { followerCount: 3400, isLive: false, lastStreamAt: "2026-07-22T20:00:00Z" },
    });
    expect(youtubeMocks.getChannelStats).toHaveBeenCalledWith("test-youtube-key", "runnerchannel");
    expect(twitchMocks.getChannelStats).toHaveBeenCalledWith(
      "test-twitch-id",
      "test-app-token",
      "runnertv",
    );
  });

  it("YouTube/Twitch リンクが無いユーザーは両方 null を返し、外部APIを呼ばない", async () => {
    const user = await seedUser(db, { slug: "nolinks", profileVisibility: "public" });
    await db.insert(schema.socialLinks).values({
      userId: user.id,
      platform: "twitter",
      identifier: "someone",
    });

    const res = await callLoader("nolinks");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ youtube: null, twitch: null });
    expect(youtubeMocks.getChannelStats).not.toHaveBeenCalled();
    expect(twitchMocks.getChannelStats).not.toHaveBeenCalled();
  });

  it("APIキー未設定のプラットフォームは null になり、外部APIを呼ばない", async () => {
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
    const user = await seedUser(db, { slug: "nokeys", profileVisibility: "public" });
    await seedSocialLink(user.id, "youtube", "chan");
    await seedSocialLink(user.id, "twitch", "tv");

    const res = await callLoader("nokeys");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ youtube: null, twitch: null });
    expect(youtubeMocks.getChannelStats).not.toHaveBeenCalled();
    expect(twitchMocks.getChannelStats).not.toHaveBeenCalled();
  });

  it("2回目の呼び出しはDBキャッシュから返し、外部APIを再度呼ばない", async () => {
    const user = await seedUser(db, { slug: "cached", profileVisibility: "public" });
    await seedSocialLink(user.id, "youtube", "cachedchannel");

    const first = await callLoader("cached");
    expect(first.status).toBe(200);
    const second = await callLoader("cached");
    expect(second.status).toBe(200);

    expect(youtubeMocks.getChannelStats).toHaveBeenCalledTimes(1);
    expect(await second.json()).toEqual({
      youtube: { subscriberCount: 12000, latestVideoAt: "2026-07-20T12:00:00Z" },
      twitch: null,
    });
  });
});
