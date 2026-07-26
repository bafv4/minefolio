import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedGuide,
  seedSearchCraftTemplate,
  schema,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

// セッションはモックし、ルート本体（認証ゲート・入力検証・ステータス）を実DBで検証する。
// vi.mock は巻き上げられるため、モック関数は vi.hoisted で用意する。
const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../likes";

const SHARED_URL = "file::memory:?cache=shared";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("https://minefolio.app/api/likes", {
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
  db = await createTestDbAt(SHARED_URL);
  sessionMocks.getOptionalSession.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

async function setupGuide(authorOverrides: Record<string, unknown> = {}) {
  const author = await seedUser(db, {
    slug: "author",
    discordId: "discord-author",
    profileVisibility: "public",
    ...authorOverrides,
  });
  const viewer = await seedUser(db, { slug: "viewer", discordId: "discord-viewer" });
  const guide = await seedGuide(db, author.id, { isPublished: true });
  return { author, viewer, guide };
}

async function guideLikeRowCount(): Promise<number> {
  return (await db.query.guideLikes.findMany()).length;
}

describe("認証ゲート", () => {
  it("未ログインは 401 JSON を返す（リダイレクトしない）", async () => {
    const { guide } = await setupGuide();

    const res = await callAction({ targetType: "guide", targetId: guide.id, action: "like" });

    expect(res.status).toBe(401);
    // getSession を使うと throw redirect("/login") になり、fetch 側は
    // 「200 + ログインHTML」を受け取って res.json() が壊れる。その回帰を捕まえる
    expect(res.redirected).toBe(false);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(await guideLikeRowCount()).toBe(0);
  });

  it("セッションはあるが users 行が無い（未オンボーディング）も 401", async () => {
    const { guide } = await setupGuide();
    signInAs("discord-unknown");

    const res = await callAction({ targetType: "guide", targetId: guide.id, action: "like" });

    expect(res.status).toBe(401);
    expect(await guideLikeRowCount()).toBe(0);
  });

  it("POST 以外は 405", async () => {
    const res = await callAction(null, "GET");
    expect(res.status).toBe(405);
  });
});

describe("入力検証", () => {
  beforeEach(async () => {
    await setupGuide();
    signInAs("discord-viewer");
  });

  it("壊れた JSON は 400", async () => {
    const request = new Request("https://minefolio.app/api/likes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    const res = await action({ request, params: {}, context: {} } as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
  });

  it.each([
    ["未知の targetType", { targetType: "video", targetId: "x", action: "like" }],
    ["targetId 欠落", { targetType: "guide", action: "like" }],
    ["未知の action", { targetType: "guide", targetId: "x", action: "toggle" }],
    ["過大な targetId", { targetType: "guide", targetId: "x".repeat(65), action: "like" }],
  ])("%s は 400", async (_label, body) => {
    const res = await callAction(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
  });
});

describe("いいねの成否", () => {
  it("成功時は書き込み後の権威ある件数を返す", async () => {
    const { guide } = await setupGuide();
    signInAs("discord-viewer");

    const res = await callAction({ targetType: "guide", targetId: guide.id, action: "like" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ liked: true, count: 1 });

    const unliked = await callAction({
      targetType: "guide",
      targetId: guide.id,
      action: "unlike",
    });
    expect(await unliked.json()).toEqual({ liked: false, count: 0 });
  });

  it("自分のガイドは 403（行も作られない）", async () => {
    const { guide } = await setupGuide();
    signInAs("discord-author");

    const res = await callAction({ targetType: "guide", targetId: guide.id, action: "like" });

    expect(res.status).toBe(403);
    expect(await guideLikeRowCount()).toBe(0);
  });

  it("非公開著者のガイドと存在しないガイドは同一の応答（列挙オラクルにしない）", async () => {
    const { guide } = await setupGuide({ profileVisibility: "private" });
    signInAs("discord-viewer");

    const privateRes = await callAction({
      targetType: "guide",
      targetId: guide.id,
      action: "like",
    });
    const missingRes = await callAction({
      targetType: "guide",
      targetId: "no-such-id",
      action: "like",
    });

    expect(privateRes.status).toBe(404);
    expect(missingRes.status).toBe(missingRes.status);
    expect(privateRes.status).toBe(missingRes.status);
    expect(await privateRes.json()).toEqual(await missingRes.json());
  });

  it("テンプレートにもいいねできる", async () => {
    const owner = await seedUser(db, { slug: "owner", discordId: "discord-owner" });
    await seedUser(db, { slug: "viewer", discordId: "discord-viewer" });
    const template = await seedSearchCraftTemplate(db, owner.id);
    signInAs("discord-viewer");

    const res = await callAction({
      targetType: "template",
      targetId: template.id,
      action: "like",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ liked: true, count: 1 });
  });
});

describe("キャッシュ制御", () => {
  it("応答は private, no-store（閲覧者依存のためCDNに載せない）", async () => {
    const { guide } = await setupGuide();
    signInAs("discord-viewer");

    const res = await callAction({ targetType: "guide", targetId: guide.id, action: "like" });
    const cacheControl = res.headers.get("Cache-Control") ?? "";

    expect(cacheControl).toContain("no-store");
    expect(cacheControl).not.toContain("s-maxage");
    expect(cacheControl).not.toContain("public");
  });
});

describe("連打（冪等性）", () => {
  it("同じ like を2回送っても行は1件のまま", async () => {
    const { guide } = await setupGuide();
    signInAs("discord-viewer");

    await callAction({ targetType: "guide", targetId: guide.id, action: "like" });
    const second = await callAction({ targetType: "guide", targetId: guide.id, action: "like" });

    expect(await second.json()).toEqual({ liked: true, count: 1 });
    const rows = await db.query.guideLikes.findMany({
      where: eq(schema.guideLikes.guideId, guide.id),
    });
    expect(rows).toHaveLength(1);
  });
});
