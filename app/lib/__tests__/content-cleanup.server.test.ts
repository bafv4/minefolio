// アカウント削除・ガイド削除時の派生データ掃除（app/lib/content-cleanup.server.ts）の回帰テスト。
//
// DB 系（deleteTranslationsFor*）は createTestDb() で隔離した実 DB に対して検証する。
// Blob 系（cleanup*Blobs）は @vercel/blob の list/del をモックしつつ、内部で
// createDb() を呼ぶため SHARED_MEMORY_URL + TURSO_DATABASE_URL 差し替えで実 DB に向ける
// （test-db.ts の想定用途どおり。方針は app/routes/my-guides/__tests__/edit.test.ts と同じ）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDb,
  createTestDbAt,
  seedUser,
  seedGuide,
  schema,
  SHARED_MEMORY_URL,
  type TestDb,
} from "./helpers/test-db";

const blobMocks = vi.hoisted(() => ({
  list: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@vercel/blob", () => blobMocks);

import {
  deleteTranslationsForGuide,
  deleteTranslationsForUser,
  cleanupUserBlobs,
  cleanupGuideBlobs,
} from "../content-cleanup.server";

type TranslationRow = typeof schema.contentTranslations.$inferInsert;

function translationRow(overrides: Partial<TranslationRow>): TranslationRow {
  return {
    targetType: "guide",
    targetId: "target",
    locale: "en",
    sourceHash: "hash",
    glossaryVersion: 1,
    ...overrides,
  };
}

describe("deleteTranslationsForGuide", () => {
  it("指定ガイドの翻訳行だけを削除し、他ガイドの行は残す", async () => {
    const db = await createTestDb();
    await db.insert(schema.contentTranslations).values([
      translationRow({ targetType: "guide", targetId: "g1", locale: "en" }),
      translationRow({ targetType: "guide", targetId: "g1", locale: "ja" }),
      translationRow({ targetType: "guide", targetId: "g2", locale: "en" }),
    ]);

    await deleteTranslationsForGuide(db, "g1");

    const remaining = await db.query.contentTranslations.findMany();
    expect(remaining.map((r) => r.targetId)).toEqual(["g2"]);
  });
});

describe("deleteTranslationsForUser", () => {
  it("userBio 分 + 指定ガイド分だけを削除し、他ユーザー/他ガイドの行は残す", async () => {
    const db = await createTestDb();
    await db.insert(schema.contentTranslations).values([
      translationRow({ targetType: "userBio", targetId: "u1", locale: "en" }),
      translationRow({ targetType: "userBio", targetId: "u2", locale: "en" }),
      translationRow({ targetType: "guide", targetId: "g1", locale: "en" }),
      translationRow({ targetType: "guide", targetId: "g2", locale: "en" }),
    ]);

    await deleteTranslationsForUser(db, "u1", ["g1"]);

    const remaining = await db.query.contentTranslations.findMany();
    const keys = remaining.map((r) => `${r.targetType}:${r.targetId}`).sort();
    expect(keys).toEqual(["guide:g2", "userBio:u2"]);
  });

  it("guideIds が空なら guide 側の削除をスキップする", async () => {
    const db = await createTestDb();
    await db.insert(schema.contentTranslations).values([
      translationRow({ targetType: "userBio", targetId: "u1", locale: "en" }),
      translationRow({ targetType: "guide", targetId: "g1", locale: "en" }),
    ]);

    await deleteTranslationsForUser(db, "u1", []);

    const remaining = await db.query.contentTranslations.findMany();
    expect(remaining.map((r) => r.targetType)).toEqual(["guide"]);
  });
});

// ── Blob 系（list/del モック） ──────────────────────────────────────
type ListPage = { blobs: { pathname: string; url: string }[]; cursor?: string; hasMore: boolean };

function emptyPage(): ListPage {
  return { blobs: [], cursor: undefined, hasMore: false };
}

const ENV_KEYS = ["TURSO_DATABASE_URL", "BLOB_READ_WRITE_TOKEN"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  blobMocks.list.mockResolvedValue(emptyPage());
  blobMocks.del.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("cleanupUserBlobs", () => {
  it("BLOB_READ_WRITE_TOKEN 未設定なら list/del を呼ばない（no-op）", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;

    await cleanupUserBlobs({ userId: "u1", customSkinUrl: null });

    expect(blobMocks.list).not.toHaveBeenCalled();
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("guides/<userId>/ と skins/<userId>/ の2 prefix を列挙して一括削除する", async () => {
    blobMocks.list.mockImplementation(async ({ prefix }: { prefix: string }): Promise<ListPage> => {
      if (prefix === "guides/u1/") {
        return { blobs: [{ pathname: "guides/u1/g1/cover-1.png", url: "url1" }], cursor: undefined, hasMore: false };
      }
      if (prefix === "skins/u1/") {
        return { blobs: [{ pathname: "skins/u1/skin-1.png", url: "url2" }], cursor: undefined, hasMore: false };
      }
      return emptyPage();
    });

    await cleanupUserBlobs({ userId: "u1", customSkinUrl: null });

    expect(blobMocks.del).toHaveBeenCalledTimes(1);
    expect(blobMocks.del).toHaveBeenCalledWith(
      expect.arrayContaining(["guides/u1/g1/cover-1.png", "skins/u1/skin-1.png"])
    );
  });

  it("cursor がある限りページングして全件集める", async () => {
    blobMocks.list.mockImplementation(async ({ prefix, cursor }: { prefix: string; cursor?: string }): Promise<ListPage> => {
      if (prefix !== "guides/u1/") return emptyPage();
      if (!cursor) {
        return { blobs: [{ pathname: "guides/u1/a.png", url: "a" }], cursor: "next", hasMore: true };
      }
      return { blobs: [{ pathname: "guides/u1/b.png", url: "b" }], cursor: undefined, hasMore: false };
    });

    await cleanupUserBlobs({ userId: "u1", customSkinUrl: null });

    expect(blobMocks.del).toHaveBeenCalledWith(
      expect.arrayContaining(["guides/u1/a.png", "guides/u1/b.png"])
    );
  });

  it("100件ずつバッチで del() する", async () => {
    const pathnames = Array.from({ length: 150 }, (_, i) => `guides/u1/img-${i}.png`);
    blobMocks.list.mockImplementation(async ({ prefix }: { prefix: string }): Promise<ListPage> => {
      if (prefix === "guides/u1/") {
        return { blobs: pathnames.map((p) => ({ pathname: p, url: p })), cursor: undefined, hasMore: false };
      }
      return emptyPage();
    });

    await cleanupUserBlobs({ userId: "u1", customSkinUrl: null });

    expect(blobMocks.del).toHaveBeenCalledTimes(2);
    expect((blobMocks.del.mock.calls[0][0] as string[]).length).toBe(100);
    expect((blobMocks.del.mock.calls[1][0] as string[]).length).toBe(50);
  });

  it("customSkinUrl が正規 Blob URL なら保険として del() する", async () => {
    const skinUrl = "https://xxx.public.blob.vercel-storage.com/skins/legacy/skin.png";

    await cleanupUserBlobs({ userId: "u1", customSkinUrl: skinUrl });

    expect(blobMocks.del).toHaveBeenCalledWith(skinUrl);
  });

  it("list/del が reject しても throw しない", async () => {
    blobMocks.list.mockRejectedValue(new Error("network error"));

    await expect(cleanupUserBlobs({ userId: "u1", customSkinUrl: null })).resolves.toBeUndefined();
  });
});

describe("cleanupGuideBlobs", () => {
  it("BLOB_READ_WRITE_TOKEN 未設定なら list を呼ばない（no-op）", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;

    await cleanupGuideBlobs({
      userId: "u1",
      guideId: "g1",
      guideColumns: { content: "", draftContent: null, coverImageUrl: null, draftCoverImageUrl: null },
    });

    expect(blobMocks.list).not.toHaveBeenCalled();
  });

  it("著者の他ガイドがまだ参照しているパスは削除対象から除く", async () => {
    const user = await seedUser(db, { slug: "author" });
    const sharedPathname = `guides/${user.id}/other-guide/images/shared.png`;
    const sharedUrl = `https://xxx.public.blob.vercel-storage.com/${sharedPathname}`;

    // 削除対象ガイドの本文と同じ画像を参照している「著者の残ガイド」
    await seedGuide(db, user.id, {
      id: "other-guide",
      content: `<img src="${sharedUrl}">`,
    });

    blobMocks.list.mockImplementation(async ({ prefix }: { prefix: string }): Promise<ListPage> => {
      if (prefix === `guides/${user.id}/deleted-guide/`) {
        return {
          blobs: [{ pathname: `guides/${user.id}/deleted-guide/images/own.png`, url: "own" }],
          cursor: undefined,
          hasMore: false,
        };
      }
      return emptyPage();
    });

    await cleanupGuideBlobs({
      userId: user.id,
      guideId: "deleted-guide",
      guideColumns: {
        content: `<img src="${sharedUrl}">`,
        draftContent: null,
        coverImageUrl: null,
        draftCoverImageUrl: null,
      },
    });

    expect(blobMocks.del).toHaveBeenCalledTimes(1);
    const deleted = blobMocks.del.mock.calls[0][0] as string[];
    expect(deleted).toContain(`guides/${user.id}/deleted-guide/images/own.png`);
    expect(deleted).not.toContain(sharedPathname);
  });

  it("他ユーザーの残ガイドに参照が無ければ prefix 配下を丸ごと削除する", async () => {
    const user = await seedUser(db, { slug: "author2" });

    blobMocks.list.mockImplementation(async ({ prefix }: { prefix: string }): Promise<ListPage> => {
      if (prefix === `guides/${user.id}/g1/`) {
        return {
          blobs: [
            { pathname: `guides/${user.id}/g1/cover-1.png`, url: "c" },
            { pathname: `guides/${user.id}/g1/images/x.png`, url: "x" },
          ],
          cursor: undefined,
          hasMore: false,
        };
      }
      return emptyPage();
    });

    await cleanupGuideBlobs({
      userId: user.id,
      guideId: "g1",
      guideColumns: { content: "", draftContent: null, coverImageUrl: null, draftCoverImageUrl: null },
    });

    const deleted = blobMocks.del.mock.calls[0][0] as string[];
    expect(deleted.sort()).toEqual(
      [`guides/${user.id}/g1/cover-1.png`, `guides/${user.id}/g1/images/x.png`].sort()
    );
  });

  it("list/del が reject しても throw しない", async () => {
    const user = await seedUser(db, { slug: "author3" });
    blobMocks.list.mockRejectedValue(new Error("network error"));

    await expect(
      cleanupGuideBlobs({
        userId: user.id,
        guideId: "g1",
        guideColumns: { content: "", draftContent: null, coverImageUrl: null, draftCoverImageUrl: null },
      })
    ).resolves.toBeUndefined();
  });
});
