// /dev/login のキルスイッチ回帰テスト。
//
// isDevAuthEnabled()（app/lib/env.server.ts）は「NODE_ENV 非 production」「DEV_AUTH=1」
// 「接続先がローカルDB（file: スキーム）」の3条件 AND で有効になり、いずれか欠けると
// loader/action は createDb() より前に 404 を throw する（フェイルクローズ＝本番混入時の
// 固定パスワード認証キルスイッチ）。本番環境変数の設定ミスでも常に無効側に倒れることを保証する。
//
// セッションのモック方針は app/routes/me/__tests__/edit.test.ts / devices.test.ts と同じ。
// ケース1〜4は 404 を確認するだけなので実DBは不要（createDb() より前に throw される）。
// ケース5（3条件成立）は「404 を投げないこと」だけを確認し、better-auth 実体が要る先の処理
// （signInEmail/signUpEmail の実行）までは踏み込まない。
//   - loader は getOptionalSession をモックして通過させ、404 を投げずに returnTo を
//     返すことを確認する（createDb()/createAuth() の構築自体は許容するが、モックのため
//     実クエリは発生しない）。
//   - action は USERNAME_PATTERN 不正な入力で早期 return させ（createDb() 到達前に
//     バリデーションエラーを返す分岐）、404 チェックを通過したことのみを確認する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { loader, action } from "../dev-login";

const ENV_KEYS = [
  "NODE_ENV",
  "DEV_AUTH",
  "TURSO_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "APP_URL",
] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function makeGetRequest(url = "https://minefolio.app/dev/login"): Request {
  return new Request(url);
}

function makePostRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/dev/login", { method: "POST", body: formData });
}

function callLoader(request: Request = makeGetRequest()) {
  return loader({ request, params: {}, context: {} } as never);
}

function callAction(request: Request) {
  return action({ request, params: {}, context: {} } as never);
}

/** fn() 実行が 404 の Response を throw することだけを確認する */
async function expect404(fn: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(Response);
  expect((caught as Response).status).toBe(404);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("キルスイッチ: NODE_ENV=production", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.DEV_AUTH = "1";
    process.env.TURSO_DATABASE_URL = "file:local.db";
  });

  it("DEV_AUTH=1 かつローカルDBでも loader は 404 を throw する（本番キルスイッチ優先）", async () => {
    await expect404(() => callLoader());
  });

  it("同条件で action も 404 を throw する", async () => {
    const fd = new FormData();
    fd.set("username", "dev");
    await expect404(() => callAction(makePostRequest(fd)));
  });
});

describe("キルスイッチ: DEV_AUTH 未設定/'1' 以外", () => {
  it("DEV_AUTH 未設定では非 production でも loader が 404", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.DEV_AUTH;
    process.env.TURSO_DATABASE_URL = "file:local.db";

    await expect404(() => callLoader());
  });

  it("DEV_AUTH='true'（'1' 以外の値）では action が 404", async () => {
    process.env.NODE_ENV = "test";
    process.env.DEV_AUTH = "true";
    process.env.TURSO_DATABASE_URL = "file:local.db";

    const fd = new FormData();
    fd.set("username", "dev");
    await expect404(() => callAction(makePostRequest(fd)));
  });
});

describe("キルスイッチ: 接続先がリモートDB", () => {
  it("TURSO_DATABASE_URL が libsql:// では loader が 404", async () => {
    process.env.NODE_ENV = "test";
    process.env.DEV_AUTH = "1";
    process.env.TURSO_DATABASE_URL = "libsql://example.turso.io";

    await expect404(() => callLoader());
  });

  it("同条件で action も 404", async () => {
    process.env.NODE_ENV = "test";
    process.env.DEV_AUTH = "1";
    process.env.TURSO_DATABASE_URL = "libsql://example.turso.io";

    const fd = new FormData();
    fd.set("username", "dev");
    await expect404(() => callAction(makePostRequest(fd)));
  });
});

describe("3条件成立時（NODE_ENV=test, DEV_AUTH=1, ローカルDB）は 404 にならない", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.DEV_AUTH = "1";
    process.env.TURSO_DATABASE_URL = "file::memory:";
    process.env.BETTER_AUTH_SECRET = "test-secret";
    process.env.APP_URL = "https://minefolio.app";
  });

  it("loader は 404 を投げず returnTo を返す（未ログイン扱い）", async () => {
    sessionMocks.getOptionalSession.mockResolvedValue(null);

    const result = await callLoader();

    expect(result).toEqual({ returnTo: null });
  });

  it("action は 404 チェックを通過し、フォームバリデーション分岐まで進む", async () => {
    const fd = new FormData();
    fd.set("username", "Invalid Name!"); // USERNAME_PATTERN 不正 → createDb() 到達前に return

    const result = await callAction(makePostRequest(fd));

    expect(result).toEqual({
      error: "ユーザー名は半角英小文字・数字・ハイフン1〜20文字で入力してください",
    });
  });
});
