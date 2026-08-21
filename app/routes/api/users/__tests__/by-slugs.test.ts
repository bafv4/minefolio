// POST /api/users/by-slugs（action）の回帰テスト。
// 未ログイン閲覧者向けの一括取得API。可視性フィルタ（非公開・限定公開の除外）と、
// レスポンスに機微情報を含めないことをルート本体で保証しているため実DBで検証する。
//
// 認証不要のルートのためセッションのモックは不要。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

import { action } from "../by-slugs";

const ENV_KEYS = ["TURSO_DATABASE_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("https://minefolio.app/api/users/by-slugs", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" || method === "PUT" ? JSON.stringify(body) : undefined,
  });
}

async function callAction(body: unknown, method = "POST"): Promise<Response> {
  return action({ request: makeRequest(body, method), params: {}, context: {} } as never);
}

beforeEach(async () => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("action - 可視性フィルタ", () => {
  it("非公開・限定公開ユーザーの slug を混ぜても結果に含まれない", async () => {
    await seedUser(db, { slug: "pub", profileVisibility: "public" });
    await seedUser(db, { slug: "unl", profileVisibility: "unlisted" });
    await seedUser(db, { slug: "prv", profileVisibility: "private" });

    const res = await callAction({ slugs: ["pub", "unl", "prv"] });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<{ slug: string }> };
    expect(body.users.map((u) => u.slug)).toEqual(["pub"]);
  });
});

describe("action - 返却フィールド", () => {
  it("機微情報（discordId 等）を含まない", async () => {
    await seedUser(db, {
      slug: "pub",
      discordId: "discord-secret",
      profileVisibility: "public",
      mcid: "Runner",
    });

    const res = await callAction({ slugs: ["pub"] });
    const body = (await res.json()) as { users: Array<Record<string, unknown>> };

    expect(body.users).toHaveLength(1);
    const user = body.users[0];
    expect(user).not.toHaveProperty("discordId");
    expect(user).not.toHaveProperty("id");
    expect(user).not.toHaveProperty("email");
    expect(Object.keys(user).sort()).toEqual(
      [
        "slug",
        "mcid",
        "uuid",
        "displayName",
        "displayNameAlphabet",
        "pronouns",
        "role",
        "mainEdition",
        "mainPlatform",
        "shortBio",
        "location",
        "updatedAt",
        "customSkinUrl",
        "slimSkin",
      ].sort(),
    );
  });
});

describe("action - 入力順ソート・上限", () => {
  it("入力順どおりにソートされて返る", async () => {
    await seedUser(db, { slug: "c", profileVisibility: "public" });
    await seedUser(db, { slug: "a", profileVisibility: "public" });
    await seedUser(db, { slug: "b", profileVisibility: "public" });

    const res = await callAction({ slugs: ["b", "c", "a"] });
    const body = (await res.json()) as { users: Array<{ slug: string }> };

    expect(body.users.map((u) => u.slug)).toEqual(["b", "c", "a"]);
  });

  it("101件目は切り捨てられる（上限100件）", async () => {
    const slugs: string[] = [];
    for (let i = 0; i < 101; i++) {
      const slug = `user-${String(i).padStart(3, "0")}`;
      slugs.push(slug);
      await seedUser(db, { slug, profileVisibility: "public" });
    }

    const res = await callAction({ slugs });
    const body = (await res.json()) as { users: Array<{ slug: string }> };

    expect(body.users).toHaveLength(100);
    expect(body.users.map((u) => u.slug)).toEqual(slugs.slice(0, 100));
  });

  it("string 以外の要素は除外される", async () => {
    await seedUser(db, { slug: "pub", profileVisibility: "public" });

    const res = await callAction({ slugs: ["pub", 123, null, {}, ["x"]] });
    const body = (await res.json()) as { users: Array<{ slug: string }> };

    expect(body.users.map((u) => u.slug)).toEqual(["pub"]);
  });

  it("129文字の slug は除外される（上限128文字）", async () => {
    const longSlug = "a".repeat(129);
    const okSlug = "a".repeat(128);
    await seedUser(db, { slug: okSlug, profileVisibility: "public" });

    const res = await callAction({ slugs: [longSlug, okSlug] });
    const body = (await res.json()) as { users: Array<{ slug: string }> };

    expect(body.users.map((u) => u.slug)).toEqual([okSlug]);
  });
});

describe("action - メソッド・入力検証", () => {
  it("GET は 405", async () => {
    const res = await callAction(null, "GET");
    expect(res.status).toBe(405);
  });

  it("壊れた JSON は 400", async () => {
    const request = new Request("https://minefolio.app/api/users/by-slugs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    const res = await action({ request, params: {}, context: {} } as never);
    expect(res.status).toBe(400);
  });

  it("JSON の null ボディ（構文的には正しいがオブジェクトでない）は 400", async () => {
    const res = await callAction(null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
  });
});
