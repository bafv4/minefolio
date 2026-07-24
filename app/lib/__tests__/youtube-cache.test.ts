import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  daysAgo,
  schema,
  type TestDb,
} from "./helpers/test-db";
import { verifyVideosExistence } from "../youtube-cache";

// verifyVideosExistence の存在確認: YouTube Data API はグローバル fetch 経由のためスタブする。
// 特に「API障害時に全件を削除済み扱いにしない」（フェイルオープン）の回帰を検証する

const SHARED_URL = "file::memory:?cache=shared";

let db: TestDb;
let originalUrl: string | undefined;

async function seedVideo(videoId: string, overrides: Partial<typeof schema.youtubeVideoCache.$inferInsert> = {}) {
  await db.insert(schema.youtubeVideoCache).values({
    videoId,
    channelId: "UCtest",
    title: `video ${videoId}`,
    publishedAt: daysAgo(5),
    lastVerifiedAt: daysAgo(1), // VERIFICATION_INTERVAL(12h) より古い＝検証対象
    ...overrides,
  });
}

function stubFetchWithPublicIds(ids: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: ids.map((id) => ({ id, status: { privacyStatus: "public" } })),
      }),
    }),
  );
}

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

describe("verifyVideosExistence", () => {
  it("存在しない動画のみ isAvailable=false にマークし、存在する動画は検証日時を更新する", async () => {
    await seedVideo("alive");
    await seedVideo("deleted");
    stubFetchWithPublicIds(["alive"]);

    const result = await verifyVideosExistence("test-key");

    expect(result).toEqual({ verified: 1, removed: 1 });
    const rows = await db.query.youtubeVideoCache.findMany();
    const byId = new Map(rows.map((r) => [r.videoId, r]));
    expect(byId.get("alive")?.isAvailable).toBe(true);
    expect(byId.get("deleted")?.isAvailable).toBe(false);
  });

  it("API障害時は何もマークしない（フェイルオープン。全件削除済み扱いにしない）", async () => {
    await seedVideo("v1");
    await seedVideo("v2");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    const result = await verifyVideosExistence("test-key");

    expect(result).toEqual({ verified: 0, removed: 0 });
    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows.every((r) => r.isAvailable)).toBe(true);
  });

  it("fetch 例外時も何もマークしない", async () => {
    await seedVideo("v1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await verifyVideosExistence("test-key");

    expect(result).toEqual({ verified: 0, removed: 0 });
    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows.every((r) => r.isAvailable)).toBe(true);
  });
});
