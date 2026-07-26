import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  seedGuide,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { loader } from "../view";

// ガイド詳細のSSRペイロード。
// 以前は行をそのまま展開していたため、著者の未公開ドラフト（draftTitle / draftContent 等）と
// サニタイズ前の生 content が全閲覧者に配信されていた。その回帰テスト。

const SHARED_URL = "file::memory:?cache=shared";
const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

const DRAFT_SECRET = "SECRET_DRAFT_CONTENT_DO_NOT_LEAK";
const RAW_CONTENT_MARKER = "RAW_PUBLISHED_MARKER";

async function callLoader(authorSlug: string, guideSlug: string, search = "") {
  const request = new Request(
    `https://minefolio.app/guides/${authorSlug}/${guideSlug}${search}`,
  );
  return loader({
    request,
    params: { authorSlug, guideSlug },
    context: {},
  } as never) as Promise<Record<string, unknown>>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_URL);
  sessionMocks.getOptionalSession.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

async function seedGuideWithDraft() {
  const author = await seedUser(db, {
    slug: "author",
    discordId: "discord-author",
    displayName: "Author",
    profileVisibility: "public",
  });
  const guide = await seedGuide(db, author.id, {
    slug: "my-guide",
    title: "公開タイトル",
    content: `<p>${RAW_CONTENT_MARKER}</p>`,
    isPublished: true,
    draftTitle: "下書きタイトル",
    draftSummary: "下書き概要",
    draftContent: `<p>${DRAFT_SECRET}</p>`,
    draftUpdatedAt: new Date(),
  });
  return { author, guide };
}

describe("SSRペイロードにドラフトを含めない", () => {
  it("第三者にはドラフト列が一切渡らない", async () => {
    await seedGuideWithDraft();

    const data = await callLoader("author", "my-guide");
    const guide = data.guide as Record<string, unknown>;
    const serialized = JSON.stringify(data);

    // 個別のキーが無いこと
    for (const key of [
      "draftTitle",
      "draftSummary",
      "draftContent",
      "draftCoverImageUrl",
      "draftTags",
      "draftUpdatedAt",
      "content",
      "authorId",
      "isPublished",
    ]) {
      expect(Object.keys(guide)).not.toContain(key);
    }
    // 値としても混入していないこと（ネストのどこかに紛れていないかの保険）
    expect(serialized).not.toContain(DRAFT_SECRET);
    expect(serialized).not.toContain("下書きタイトル");
    // 生の content ではなくサニタイズ済みのみを渡す
    expect(guide.sanitizedContent).toContain(RAW_CONTENT_MARKER);
  });

  it("著者本人がドラフトをプレビューしても、ドラフト列そのものは渡らない（表示値に反映されるだけ）", async () => {
    await seedGuideWithDraft();
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "discord-author" } });

    const data = await callLoader("author", "my-guide", "?draft=1");
    const guide = data.guide as Record<string, unknown>;

    expect(data.previewingDraft).toBe(true);
    // 表示用の値としてドラフトが採用される
    expect(guide.title).toBe("下書きタイトル");
    expect(guide.sanitizedContent).toContain(DRAFT_SECRET);
    // それでも生のドラフト列は渡さない
    expect(Object.keys(guide)).not.toContain("draftContent");
    expect(Object.keys(guide)).not.toContain("draftTitle");
  });

  it("著者情報は表示に使う分だけ渡す（内部の可視性設定を含めない）", async () => {
    await seedGuideWithDraft();

    const data = await callLoader("author", "my-guide");
    const author = data.author as Record<string, unknown>;

    expect(Object.keys(author).sort()).toEqual(
      ["customSkinUrl", "displayName", "displayNameAlphabet", "mcid", "slug", "uuid"].sort(),
    );
  });

  it("公開ガイドでは通常どおり公開版の内容を返す", async () => {
    await seedGuideWithDraft();

    const data = await callLoader("author", "my-guide");
    const guide = data.guide as Record<string, unknown>;

    expect(data.previewingDraft).toBe(false);
    expect(guide.title).toBe("公開タイトル");
    expect(guide.sanitizedContent).not.toContain(DRAFT_SECRET);
  });
});
