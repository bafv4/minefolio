// /my-guides の action の delete（ガイド削除）の回帰テスト。
//
// ガイド行 + そのガイドの翻訳キャッシュ行が消え、他ガイドの翻訳行やデータには波及しない
// ことを実DBで固定する。所有権外の guideId を指定した場合は何も起きないことも確認する。
// Blob 削除（cleanupGuideBlobs）は BLOB_READ_WRITE_TOKEN 未設定で no-op になるため、
// @vercel/blob をモックして list/del が呼ばれないことだけ確認する。
//
// セッションはモックし、ルート本体（所有権確認・DB書き込み）は実DBで検証する
// （app/routes/my-guides/__tests__/edit.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedGuide,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { guides, contentTranslations } from "@/lib/schema";

const blobMocks = vi.hoisted(() => ({
  list: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@vercel/blob", () => blobMocks);

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../index";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL", "BLOB_READ_WRITE_TOKEN"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/my-guides", {
    method: "POST",
    body: formData,
  });
}

async function callAction(formData: FormData): Promise<unknown> {
  return action({ request: makeRequest(formData), params: {}, context: {} } as never);
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

function deleteFormData(guideId: string): FormData {
  const fd = new FormData();
  fd.set("_action", "delete");
  fd.set("guideId", guideId);
  return fd;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  // ローカル開発を模して未設定のまま（cleanupGuideBlobs が no-op になることの検証を兼ねる）
  delete process.env.BLOB_READ_WRITE_TOKEN;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("delete", () => {
  it("ガイド行とその翻訳行を削除し、他ガイドの翻訳行は残す", async () => {
    const user = await seedUser(db, { slug: "author", discordId: "discord-author" });
    const target = await seedGuide(db, user.id, { id: "target-guide" });
    const other = await seedGuide(db, user.id, { id: "other-guide" });

    await db.insert(contentTranslations).values([
      { targetType: "guide", targetId: target.id, locale: "en", sourceHash: "h", glossaryVersion: 1 },
      { targetType: "guide", targetId: other.id, locale: "en", sourceHash: "h", glossaryVersion: 1 },
    ]);

    signInAs("discord-author");
    await callAction(deleteFormData(target.id));

    const deletedGuide = await db.query.guides.findFirst({ where: eq(guides.id, target.id) });
    expect(deletedGuide).toBeUndefined();
    const remainingGuide = await db.query.guides.findFirst({ where: eq(guides.id, other.id) });
    expect(remainingGuide).toBeDefined();

    const remainingTranslations = await db.query.contentTranslations.findMany();
    expect(remainingTranslations.map((r) => r.targetId)).toEqual([other.id]);

    // BLOB_READ_WRITE_TOKEN 未設定のためバックグラウンドの Blob 削除は no-op のまま
    expect(blobMocks.list).not.toHaveBeenCalled();
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("所有権外の guideId を指定した場合は何も削除しない", async () => {
    const owner = await seedUser(db, { slug: "owner", discordId: "discord-owner" });
    const attacker = await seedUser(db, { slug: "attacker", discordId: "discord-attacker" });
    const guide = await seedGuide(db, owner.id, { id: "owner-guide" });

    signInAs("discord-attacker");
    await callAction(deleteFormData(guide.id));

    const stillThere = await db.query.guides.findFirst({ where: eq(guides.id, guide.id) });
    expect(stillThere).toBeDefined();
    expect(blobMocks.list).not.toHaveBeenCalled();
    expect(blobMocks.del).not.toHaveBeenCalled();

    // attacker が存在することの確認（seedUser の副作用チェック漏れ防止）
    expect(attacker.id).not.toBe(owner.id);
  });
});
