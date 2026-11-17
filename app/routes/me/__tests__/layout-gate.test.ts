// /me/* の登録完了ゲート（me/_layout.tsx の middleware）。layout の loader は action の前に走らないため、
// 未登録アカウントが /me/* の action を直接叩けた。ミドルウェアが action の前に弾くことを固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { registeredUserContext } from "@/lib/session";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  createAuth: () => ({ api: { getSession: authMocks.getSession } }),
}));

import { middleware } from "../_layout";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let db: TestDb;

async function runMiddleware(method = "POST") {
  const context = new RouterContextProvider();
  const request = new Request("https://minefolio.app/me/account", { method });
  const next = vi.fn();
  try {
    await middleware[0]({ request, params: {}, context } as never, next);
    return { context, thrown: null as unknown };
  } catch (e) {
    return { context, thrown: e };
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  authMocks.getSession.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("/me/* ミドルウェア", () => {
  it("未ログインは /login へ redirect", async () => {
    const { thrown } = await runMiddleware();
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toContain("/login");
  });

  it("オンボーディング未完了は /onboarding へ redirect し、context にユーザーを積まない", async () => {
    await seedUser(db, { slug: "wip", discordId: "discord-wip", onboardingCompleted: false });
    authMocks.getSession.mockResolvedValue({ user: { id: "discord-wip" } });
    const { thrown, context } = await runMiddleware();
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe("/onboarding");
    expect(context.get(registeredUserContext)).toBeNull();
  });

  it("users 行が無いセッションも /onboarding へ redirect", async () => {
    authMocks.getSession.mockResolvedValue({ user: { id: "discord-nobody" } });
    const { thrown } = await runMiddleware();
    expect((thrown as Response).headers.get("Location")).toBe("/onboarding");
  });

  it("登録済みは通り、context にユーザー行を積む", async () => {
    await seedUser(db, { slug: "done", discordId: "discord-done", onboardingCompleted: true });
    authMocks.getSession.mockResolvedValue({ user: { id: "discord-done" } });
    const { thrown, context } = await runMiddleware();
    expect(thrown).toBeNull();
    expect(context.get(registeredUserContext)?.slug).toBe("done");
  });
});
