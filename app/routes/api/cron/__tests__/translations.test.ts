// /api/cron/translations の認証ゲート・機能無効時の挙動・結果レスポンスの回帰テスト。
//
// 翻訳本体（DB・Anthropic API）は @/lib/content-translation.server ごとモックする
// （cleanup-auth.test.ts と同方式）。機能無効時に何もしないこと自体は基盤側
// （content-translation のテスト）の責務で、ここでは実物の processPendingTranslations が
// ANTHROPIC_API_KEY 無しで DB を触らないことだけを別 describe で確認する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const translationMocks = vi.hoisted(() => ({
  DEFAULT_CRON_LIMIT: 10,
  processPendingTranslations: vi.fn(),
}));

vi.mock("@/lib/content-translation.server", () => translationMocks);

import { loader, config } from "../translations";

const ENV_KEYS = ["CRON_SECRET", "TURSO_DATABASE_URL", "ANTHROPIC_API_KEY"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function callLoader(authHeader?: string): Promise<Response> {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("Authorization", authHeader);
  return loader({
    request: new Request("https://minefolio.app/api/cron/translations", { headers }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = ":memory:";
  translationMocks.processPendingTranslations.mockResolvedValue({
    processed: 3,
    translated: 2,
    upToDate: 1,
    failed: 0,
    skipped: 0,
    removed: 0,
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("認証ゲート", () => {
  it("CRON_SECRET 未設定時は 503 でフェイルクローズし、翻訳を実行しない", async () => {
    delete process.env.CRON_SECRET;

    const res = await callLoader("Bearer anything");

    expect(res.status).toBe(503);
    expect(translationMocks.processPendingTranslations).not.toHaveBeenCalled();
  });

  it("トークン欠落・不一致は 401（翻訳は実行しない）", async () => {
    process.env.CRON_SECRET = "s3cret";

    expect((await callLoader()).status).toBe(401);
    expect((await callLoader("Bearer wrong")).status).toBe(401);
    expect(translationMocks.processPendingTranslations).not.toHaveBeenCalled();
  });
});

describe("実行結果", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });

  it("正しい Bearer なら limit と timeBudgetMs（maxDuration より短い）を渡し、結果を返す", async () => {
    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      processed: 3,
      translated: 2,
      upToDate: 1,
      failed: 0,
    });
    expect(translationMocks.processPendingTranslations).toHaveBeenCalledTimes(1);
    const options = translationMocks.processPendingTranslations.mock.calls[0][1];
    expect(options.limit).toBe(10);
    expect(options.timeBudgetMs).toBeLessThan(config.maxDuration * 1000);
  });

  it("処理が throw した場合は 500 のJSONで返す", async () => {
    translationMocks.processPendingTranslations.mockRejectedValue(new Error("db down"));

    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, error: "db down" });
  });
});

describe("機能無効（ANTHROPIC_API_KEY 未設定）", () => {
  it("実物の processPendingTranslations は何もせず全件 0 を返す", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const actual = await vi.importActual<typeof import("@/lib/content-translation.server")>(
      "@/lib/content-translation.server",
    );
    const { createDb } = await import("@/lib/db");

    // :memory: にテーブルは無い。走査していれば例外になる
    const result = await actual.processPendingTranslations(createDb());

    expect(result).toEqual({
      processed: 0,
      translated: 0,
      upToDate: 0,
      failed: 0,
      skipped: 0,
      removed: 0,
    });
  });
});
