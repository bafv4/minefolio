// /me/edit の action の delete_account（アカウント削除）の回帰テスト。
//
// 派生データ（favorites の孤児行・content_translations）が users 行の削除と一緒に
// 正しく消え、他ユーザーのデータには波及しないことを実 DB で固定する。
// Blob 削除（cleanupUserBlobs）は BLOB_READ_WRITE_TOKEN 未設定で no-op になるため、
// ここでは @vercel/blob をモックして list/del が一切呼ばれないことだけ確認する
// （ローカル開発でアカウント削除が Blob 処理でブロックされないことの固定）。
//
// セッションはモックし、ルート本体（confirmText 検証・DB 書き込み）は実DBで検証する
// （app/routes/me/__tests__/edit.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedGuide,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { users, favorites, contentTranslations } from "@/lib/schema";

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

import { action } from "../edit";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL", "BLOB_READ_WRITE_TOKEN"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/edit", {
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

function deleteAccountFormData(confirmText: string): FormData {
  const fd = new FormData();
  fd.set("_action", "delete_account");
  fd.set("confirmText", confirmText);
  return fd;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  // ローカル開発を模して未設定のまま（cleanupUserBlobs が no-op になることの検証を兼ねる）
  delete process.env.BLOB_READ_WRITE_TOKEN;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("delete_account", () => {
  it("confirmText が一致しない場合は何も削除しない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner", mcid: "Runner" });
    signInAs("discord-runner");

    const result = await callAction(deleteAccountFormData("wrong-text"));

    expect(result).toEqual(expect.objectContaining({ error: "入力が一致しません", action: "delete" }));
    const stillThere = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(stillThere).toBeDefined();
    expect(blobMocks.list).not.toHaveBeenCalled();
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("confirmText 一致で users・favoriteSlug一致行・翻訳キャッシュが消え、他ユーザーのデータは残る", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner", mcid: "Runner" });
    const other = await seedUser(db, { slug: "other-user", discordId: "discord-other" });
    const guide = await seedGuide(db, user.id, { id: "g1" });

    // 他ユーザーが自分（削除対象）を favorite していた孤児行 → 削除されるべき
    await db.insert(favorites).values({ userId: other.id, favoriteSlug: user.slug });
    // 自分が他ユーザーを favorite していた行 → userId の FK cascade で消える
    await db.insert(favorites).values({ userId: user.id, favoriteSlug: other.slug });
    // 他ユーザーが別の他ユーザー(自分自身)を favorite → 無関係なので残るべき
    await db.insert(favorites).values({ userId: other.id, favoriteSlug: other.slug });

    await db.insert(contentTranslations).values([
      { targetType: "userBio", targetId: user.id, locale: "en", sourceHash: "h", glossaryVersion: 1 },
      { targetType: "guide", targetId: guide.id, locale: "en", sourceHash: "h", glossaryVersion: 1 },
      { targetType: "userBio", targetId: other.id, locale: "en", sourceHash: "h", glossaryVersion: 1 },
    ]);

    signInAs("discord-runner");
    const result = await callAction(deleteAccountFormData("Runner"));

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");

    const deletedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(deletedUser).toBeUndefined();
    const untouchedUser = await db.query.users.findFirst({ where: eq(users.id, other.id) });
    expect(untouchedUser).toBeDefined();

    const remainingFavorites = await db.query.favorites.findMany();
    expect(remainingFavorites).toHaveLength(1);
    expect(remainingFavorites[0]).toMatchObject({ userId: other.id, favoriteSlug: other.slug });

    const remainingTranslations = await db.query.contentTranslations.findMany();
    expect(remainingTranslations.map((r) => r.targetId)).toEqual([other.id]);

    // BLOB_READ_WRITE_TOKEN 未設定のためバックグラウンドの Blob 削除は no-op のまま
    expect(blobMocks.list).not.toHaveBeenCalled();
    expect(blobMocks.del).not.toHaveBeenCalled();
  });
});
