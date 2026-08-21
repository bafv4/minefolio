// /api/cron/update-page-views の認証ゲートと成否ステータスの回帰テスト。
//
// 他の cron（twitch-update 等）と同じく requireCronAuth() を通しているが、
// このルートだけ配線の回帰検知が無かった。ゲートを外すと未認証の呼び出しで
// Vercel Web Analytics API のクォータを消費し、page_view_stats を全置換できてしまう。
//
// 同期本体（DB 書き込み + 外部API）は @/lib/page-view-stats.server ごとモックし、
// 認証で拒否された場合に一度も呼ばれないことを併せて確認する
// （app/routes/api/cron/__tests__/twitch-update.test.ts と同方式）。
// isPageViewSyncConfigured は env を読むだけの純粋関数なので実物を使い、
// 環境変数の有無で分岐させる。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const pageViewMocks = vi.hoisted(() => ({
  syncPageViewStats: vi.fn(),
}));

vi.mock("@/lib/page-view-stats.server", () => pageViewMocks);

import { loader } from "../update-page-views";

const ENV_KEYS = [
  "CRON_SECRET",
  "TURSO_DATABASE_URL",
  "VERCEL_API_TOKEN",
  "VERCEL_PROJECT_ID",
] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("Authorization", authHeader);
  return new Request("https://minefolio.app/api/cron/update-page-views", { headers });
}

function callLoader(authHeader?: string): Promise<Response> {
  return loader({ request: makeRequest(authHeader) });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  // createDb() は認証・設定チェック通過後に呼ばれる。クエリはモックにより発生しないが、
  // 既定の file:local.db を掴まないよう in-memory を指す
  process.env.TURSO_DATABASE_URL = ":memory:";
  process.env.VERCEL_API_TOKEN = "vercel-token";
  process.env.VERCEL_PROJECT_ID = "prj_test";
  pageViewMocks.syncPageViewStats.mockResolvedValue({
    profiles: { ok: true, count: 3 },
    guides: { ok: true, count: 2 },
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("認証ゲート", () => {
  it("CRON_SECRET 未設定時は 503 でフェイルクローズし、同期を実行しない", async () => {
    delete process.env.CRON_SECRET;

    const res = await callLoader("Bearer anything");

    expect(res.status).toBe(503);
    expect(pageViewMocks.syncPageViewStats).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 設定済みでトークン欠落なら 401（同期は実行しない）", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await callLoader();

    expect(res.status).toBe(401);
    expect(pageViewMocks.syncPageViewStats).not.toHaveBeenCalled();
  });

  it("トークン不一致なら 401（同期は実行しない）", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await callLoader("Bearer wrong");

    expect(res.status).toBe(401);
    expect(pageViewMocks.syncPageViewStats).not.toHaveBeenCalled();
  });

  it("Bearer 接頭辞なしの生トークンは 401", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await callLoader("s3cret");

    expect(res.status).toBe(401);
    expect(pageViewMocks.syncPageViewStats).not.toHaveBeenCalled();
  });
});

describe("Analytics 未設定時", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });

  it("VERCEL_API_TOKEN が無ければ認証通過でも 500 で同期しない", async () => {
    delete process.env.VERCEL_API_TOKEN;

    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false });
    expect(pageViewMocks.syncPageViewStats).not.toHaveBeenCalled();
  });

  it("VERCEL_PROJECT_ID が無ければ認証通過でも 500 で同期しない", async () => {
    delete process.env.VERCEL_PROJECT_ID;

    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(500);
    expect(pageViewMocks.syncPageViewStats).not.toHaveBeenCalled();
  });
});

describe("同期結果のステータス", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });

  it("profiles / guides ともに成功なら 200 で success: true", async () => {
    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      profiles: { ok: true, count: 3 },
      guides: { ok: true, count: 2 },
    });
    expect(pageViewMocks.syncPageViewStats).toHaveBeenCalledTimes(1);
  });

  it("guides だけ失敗なら 500（片側失敗を握りつぶさない）", async () => {
    pageViewMocks.syncPageViewStats.mockResolvedValue({
      profiles: { ok: true, count: 3 },
      guides: { ok: false, error: "Vercel Web Analytics API error: 500" },
    });

    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      success: false,
      guides: { ok: false },
    });
  });

  it("profiles だけ失敗でも 500", async () => {
    pageViewMocks.syncPageViewStats.mockResolvedValue({
      profiles: { ok: false, error: "boom" },
      guides: { ok: true, count: 2 },
    });

    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, profiles: { ok: false } });
  });

  it("同期が throw した場合も 500 のJSONで返す（関数を落とさない）", async () => {
    pageViewMocks.syncPageViewStats.mockRejectedValue(new Error("network down"));

    const res = await callLoader("Bearer s3cret");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, error: "network down" });
  });
});
