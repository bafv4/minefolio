import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  schema,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

// セッションはモックし、ルート本体（フラグゲート・認証ゲート・入力検証・ステータス）を
// 実DBで検証する。vi.mock は巻き上げられるため、モック関数は vi.hoisted で用意する
// （likes.test.ts と同方式）。
const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../profile-reactions";

const SHARED_URL = "file::memory:?cache=shared";

const ENV_KEYS = [
  "TURSO_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "APP_URL",
  "FEATURE_PROFILE_REACTIONS",
] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("https://minefolio.app/api/profile-reactions", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

async function callAction(body: unknown, method = "POST"): Promise<Response> {
  return action({ request: makeRequest(body, method), params: {}, context: {} } as never);
}

/** 指定 discordId でログイン中にする */
function signInAs(discordId: string) {
  sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: discordId } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  // 既定はフラグON。フラグOFFを検証するテストのみ明示的に delete する
  process.env.FEATURE_PROFILE_REACTIONS = "1";
  db = await createTestDbAt(SHARED_URL);
  sessionMocks.getOptionalSession.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

async function setupProfile(overrides: Record<string, unknown> = {}) {
  const profile = await seedUser(db, {
    slug: "profile",
    discordId: "discord-profile",
    profileVisibility: "public",
    ...overrides,
  });
  const viewer = await seedUser(db, { slug: "viewer", discordId: "discord-viewer" });
  return { profile, viewer };
}

async function reactionRowCount(profileUserId: string): Promise<number> {
  return (
    await db.query.profileReactions.findMany({
      where: eq(schema.profileReactions.profileUserId, profileUserId),
    })
  ).length;
}

describe("フィーチャーフラグ（本番安全性の回帰テスト）", () => {
  it("フラグOFFなら、正当なログイン済みリクエストでも404を返しDBに触れない", async () => {
    delete process.env.FEATURE_PROFILE_REACTIONS;
    const { profile } = await setupProfile();
    signInAs("discord-viewer");

    const res = await callAction({
      profileUserId: profile.id,
      emoji: "👍",
      action: "react",
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(await reactionRowCount(profile.id)).toBe(0);
  });
});

describe("認証ゲート", () => {
  it("未ログインは 401 JSON を返す（リダイレクトしない）", async () => {
    const { profile } = await setupProfile();

    const res = await callAction({ profileUserId: profile.id, emoji: "👍", action: "react" });

    expect(res.status).toBe(401);
    expect(res.redirected).toBe(false);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(await reactionRowCount(profile.id)).toBe(0);
  });

  it("セッションはあるが users 行が無い（未オンボーディング）も 401", async () => {
    const { profile } = await setupProfile();
    signInAs("discord-unknown");

    const res = await callAction({ profileUserId: profile.id, emoji: "👍", action: "react" });

    expect(res.status).toBe(401);
    expect(await reactionRowCount(profile.id)).toBe(0);
  });

  it("POST 以外は 405", async () => {
    const res = await callAction(null, "GET");
    expect(res.status).toBe(405);
  });
});

describe("入力検証", () => {
  let profile: Awaited<ReturnType<typeof setupProfile>>["profile"];

  beforeEach(async () => {
    ({ profile } = await setupProfile());
    signInAs("discord-viewer");
  });

  it("壊れた JSON は 400", async () => {
    const request = new Request("https://minefolio.app/api/profile-reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    const res = await action({ request, params: {}, context: {} } as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
  });

  it.each([
    ["allowlist外の絵文字（VS16なしのハート単体）", { emoji: "❤" }],
    ["allowlist外の絵文字（デビル）", { emoji: "😈" }],
  ])("%s は 400", async (_label, overrides) => {
    const res = await callAction({
      profileUserId: profile.id,
      action: "react",
      ...overrides,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
  });

  it.each([
    ["未知の action", { action: "toggle" }],
    ["action 欠落", { action: undefined }],
  ])("%s は 400", async (_label, overrides) => {
    const res = await callAction({
      profileUserId: profile.id,
      emoji: "👍",
      ...overrides,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
  });

  it("profileUserId が空文字は 400", async () => {
    const res = await callAction({ profileUserId: "", emoji: "👍", action: "react" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
  });

  it("profileUserId が64文字を超えると 400", async () => {
    const res = await callAction({
      profileUserId: "x".repeat(65),
      emoji: "👍",
      action: "react",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
  });
});

describe("リアクションの成否", () => {
  it("react → 200 { reacted: true, count }", async () => {
    const { profile } = await setupProfile();
    signInAs("discord-viewer");

    const res = await callAction({ profileUserId: profile.id, emoji: "👍", action: "react" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reacted: true, count: 1 });
  });

  it("unreact → 200 { reacted: false, count }", async () => {
    const { profile } = await setupProfile();
    signInAs("discord-viewer");

    await callAction({ profileUserId: profile.id, emoji: "👍", action: "react" });
    const res = await callAction({ profileUserId: profile.id, emoji: "👍", action: "unreact" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reacted: false, count: 0 });
  });

  it("自分のプロフィールにも押せる（self 200）", async () => {
    const { profile } = await setupProfile();
    signInAs("discord-profile");

    const res = await callAction({ profileUserId: profile.id, emoji: "🎉", action: "react" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reacted: true, count: 1 });
  });

  it("private な他人のプロフィールと存在しないプロフィールは同一の404応答（列挙オラクルにしない）", async () => {
    const { profile } = await setupProfile({ profileVisibility: "private" });
    signInAs("discord-viewer");

    const privateRes = await callAction({
      profileUserId: profile.id,
      emoji: "👍",
      action: "react",
    });
    const missingRes = await callAction({
      profileUserId: "no-such-user",
      emoji: "👍",
      action: "react",
    });

    expect(privateRes.status).toBe(404);
    expect(missingRes.status).toBe(404);
    expect(await privateRes.json()).toEqual(await missingRes.json());
  });
});

describe("キャッシュ制御", () => {
  it("応答は private, no-store（閲覧者依存のためCDNに載せない）", async () => {
    const { profile } = await setupProfile();
    signInAs("discord-viewer");

    const res = await callAction({ profileUserId: profile.id, emoji: "👍", action: "react" });
    const cacheControl = res.headers.get("Cache-Control") ?? "";

    expect(cacheControl).toContain("no-store");
    expect(cacheControl).not.toContain("s-maxage");
    expect(cacheControl).not.toContain("public");
  });
});

describe("連打（冪等性）", () => {
  it("同じ emoji を2回 react しても行は1件・count は1のまま", async () => {
    const { profile } = await setupProfile();
    signInAs("discord-viewer");

    await callAction({ profileUserId: profile.id, emoji: "👍", action: "react" });
    const second = await callAction({
      profileUserId: profile.id,
      emoji: "👍",
      action: "react",
    });

    expect(await second.json()).toEqual({ reacted: true, count: 1 });
    const rows = await db.query.profileReactions.findMany({
      where: and(
        eq(schema.profileReactions.profileUserId, profile.id),
        eq(schema.profileReactions.emoji, "👍"),
      ),
    });
    expect(rows).toHaveLength(1);
  });
});
