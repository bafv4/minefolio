import { describe, it, expect, afterEach } from "vitest";
import { loader } from "../update-rankings";

// このcronエンドポイントの認証ガードが fail closed であることの回帰テスト。
// いずれのケースも createDb() 到達前に return されるため、DB を用意せず検証できる。
describe("update-rankings cron auth (fail closed)", () => {
  const original = process.env.CRON_SECRET;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = original;
    }
  });

  function requestWith(authHeader?: string): Request {
    return new Request("https://example.com/api/cron/update-rankings", {
      headers: authHeader ? { Authorization: authHeader } : {},
    });
  }

  it("CRON_SECRET 未設定なら重い処理を実行せず 503 で拒否する", async () => {
    delete process.env.CRON_SECRET;
    const res = await loader({ request: requestWith() });
    expect(res.status).toBe(503);
  });

  it("CRON_SECRET 未設定なら正しそうに見えるトークンでも 503", async () => {
    delete process.env.CRON_SECRET;
    const res = await loader({ request: requestWith("Bearer anything") });
    expect(res.status).toBe(503);
  });

  it("CRON_SECRET 設定時、Authorization ヘッダーが無ければ 401", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await loader({ request: requestWith() });
    expect(res.status).toBe(401);
  });

  it("CRON_SECRET 設定時、誤ったトークンなら 401", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await loader({ request: requestWith("Bearer wrong-token") });
    expect(res.status).toBe(401);
  });
});
