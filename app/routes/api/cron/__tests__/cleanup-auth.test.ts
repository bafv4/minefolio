// /api/cron/cleanup-auth の認証ゲートと成否ステータスの回帰テスト。
//
// 他の cron（update-page-views 等）と同じく requireCronAuth() を通しているので、
// 認証ゲートを外すと未認証の呼び出しで期限切れ判定前の DB 削除が実行できてしまう。
//
// 削除本体（DB 書き込み）は @/lib/auth-cleanup.server ごとモックし、認証で拒否された
// 場合に一度も呼ばれないことを併せて確認する（update-page-views.test.ts と同方式）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const authCleanupMocks = vi.hoisted(() => ({
  cleanupExpiredAuthRows: vi.fn(),
}));

vi.mock("@/lib/auth-cleanup.server", () => authCleanupMocks);

import { loader } from "../cleanup-auth";

const ENV_KEYS = ["CRON_SECRET", "TURSO_DATABASE_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("Authorization", authHeader);
  return new Request("https://minefolio.app/api/cron/cleanup-auth", { headers });
}

function callLoader(authHeader?: string): Promise<Response> {
  return loader({ request: makeRequest(authHeader) });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  // createDb() は認証通過後に呼ばれる。クエリはモックにより発生しないが、
  // 既定の file:local.db を掴まないよう in-memory を指す
  process.env.TURSO_DATABASE_URL = ":memory:";
  authCleanupMocks.cleanupExpiredAuthRows.mockResolvedValue({
    deletedSessions: 3,
    deletedVerifications: 1,
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("認証ゲート", () => {
  it("CRON_SECRET 未設定時は 503 でフェイルクローズし、削除を実行しない", async () => {
    delete process.env.CRON_SECRET;

    const res = await callLoader("Bearer anything");

    expect(res.status).toBe(503);
    expect(authCleanupMocks.cleanupExpiredAuthRows).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 設定済みでトークン欠落なら 401（削除は実行しない）", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await callLoader();

    expect(res.status).toBe(401);
    expect(authCleanupMocks.cleanupExpiredAuthRows).not.toHaveBeenCalled();
  });

  it("トークン不一致なら 401（削除は実行しない）", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await callLoader("Bearer wrong");

    expect(res.status).toBe(401);
    expect(authCleanupMocks.cleanupExpiredAuthRows).not.toHaveBeenCalled();
  });

  it("Bearer 接頭辞なしの生トークンは 401", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await callLoader("s3cret");

    expect(res.status).toBe(401);
    expect(authCleanupMocks.cleanupExpiredAuthRows).not.toHaveBeenCalled();
  });
});

describe("削除結果のステータス", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });

  it("正しい Bearer なら 200 で success: true と削除件数を返す", async () => {
    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      deletedSessions: 3,
      deletedVerifications: 1,
    });
    expect(authCleanupMocks.cleanupExpiredAuthRows).toHaveBeenCalledTimes(1);
  });

  it("削除処理が throw した場合は 500 のJSONで返す（関数を落とさない）", async () => {
    authCleanupMocks.cleanupExpiredAuthRows.mockRejectedValue(new Error("db down"));

    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, error: "db down" });
  });
});
