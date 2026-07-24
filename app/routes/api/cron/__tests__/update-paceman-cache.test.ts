import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// DB / PaceMan API 呼び出しをモックし、認証ゲートが「いかなる作業よりも前に」
// 拒否することを検証する。呼ばれたら失敗するようにしておく。
const { createDb, fetchRecentRunsForUsers, cachePacemanPaces } = vi.hoisted(() => ({
  createDb: vi.fn(() => {
    throw new Error("createDb must not be called when auth fails");
  }),
  fetchRecentRunsForUsers: vi.fn(() => {
    throw new Error("fetchRecentRunsForUsers must not be called when auth fails");
  }),
  cachePacemanPaces: vi.fn(() => {
    throw new Error("cachePacemanPaces must not be called when auth fails");
  }),
}));

vi.mock("@/lib/db", () => ({ createDb }));
vi.mock("@/lib/paceman", () => ({ fetchRecentRunsForUsers }));
vi.mock("@/lib/paceman-cache", () => ({ cachePacemanPaces }));

import { loader } from "../update-paceman-cache";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/cron/update-paceman-cache", {
    headers,
  });
}

function expectNoWorkPerformed() {
  expect(createDb).not.toHaveBeenCalled();
  expect(fetchRecentRunsForUsers).not.toHaveBeenCalled();
  expect(cachePacemanPaces).not.toHaveBeenCalled();
}

describe("update-paceman-cache loader auth gate", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    createDb.mockClear();
    fetchRecentRunsForUsers.mockClear();
    cachePacemanPaces.mockClear();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = original;
    }
  });

  it("CRON_SECRET 未設定なら 503 を返し、DB / PaceMan を一切呼ばない（fail-closed）", async () => {
    delete process.env.CRON_SECRET;

    const res = await loader({
      request: makeRequest({ authorization: "Bearer anything" }),
    });

    expect(res.status).toBe(503);
    expectNoWorkPerformed();
  });

  it("CRON_SECRET が空文字なら 503 を返す（fail-closed）", async () => {
    process.env.CRON_SECRET = "";

    const res = await loader({
      request: makeRequest({ authorization: "Bearer " }),
    });

    expect(res.status).toBe(503);
    expectNoWorkPerformed();
  });

  it("トークン不一致なら 401 を返し、DB / PaceMan を一切呼ばない", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await loader({
      request: makeRequest({ authorization: "Bearer wrong" }),
    });

    expect(res.status).toBe(401);
    expectNoWorkPerformed();
  });

  it("Authorization ヘッダが欠落していれば 401 を返す", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await loader({ request: makeRequest() });

    expect(res.status).toBe(401);
    expectNoWorkPerformed();
  });
});
