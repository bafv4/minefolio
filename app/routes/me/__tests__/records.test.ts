import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedCategoryRecord,
  schema,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action, isHttpVideoUrl } from "../records";

// pbVideoUrl の Stored XSS 対策（http/https スキーム許可リスト）の回帰テスト。
describe("isHttpVideoUrl", () => {
  it("accepts http/https URLs", () => {
    expect(isHttpVideoUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isHttpVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isHttpVideoUrl("http://example.com/clip")).toBe(true);
  });

  it("rejects javascript: and other dangerous schemes", () => {
    expect(isHttpVideoUrl("javascript:alert(document.domain)")).toBe(false);
    expect(isHttpVideoUrl("JavaScript:alert(1)")).toBe(false);
    expect(isHttpVideoUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpVideoUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isHttpVideoUrl("ftp://example.com/file")).toBe(false);
  });

  it("rejects non-URL and schemeless values", () => {
    expect(isHttpVideoUrl("not a url")).toBe(false);
    expect(isHttpVideoUrl("//example.com")).toBe(false);
    expect(isHttpVideoUrl("")).toBe(false);
  });
});

// /me/records の action の回帰テスト（カテゴリ名の長さ検証・登録上限50件）。
// セッションはモックし、ルート本体を実DBで検証する（app/routes/me/__tests__/devices.test.ts と同じ方針）。
const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/records", {
    method: "POST",
    body: formData,
  });
}

async function callAction(formData: FormData): Promise<{ success?: boolean; error?: string }> {
  return action({ request: makeRequest(formData), params: {}, context: {} } as never) as never;
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function baseCreateFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    _action: "create",
    category: "any_glitchless",
    categoryDisplayName: "Any% Glitchless",
    personalBest: "",
    isVisible: "true",
    isPinned: "false",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

async function recordCount(userId: string): Promise<number> {
  return (
    await db.query.categoryRecords.findMany({ where: eq(schema.categoryRecords.userId, userId) })
  ).length;
}

describe("action - category の検証", () => {
  it("101文字のカテゴリ名は categoryTooLong エラーになり、行を作らない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    const res = await callAction(baseCreateFormData({ category: "a".repeat(101) }));

    expect(res).toEqual({ error: "カテゴリ名は100文字以内で入力してください" });
    expect(await recordCount(user.id)).toBe(0);
  });
});

describe("action - 登録上限（50件）", () => {
  it("既存50件がある状態での create は errorLimitReached を返し、件数が増えない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    await db.insert(schema.categoryRecords).values(
      Array.from({ length: 50 }, (_, i) => ({
        userId: user.id,
        category: `cat-${i}`,
        categoryDisplayName: `Category ${i}`,
        recordType: "custom" as const,
      })),
    );

    const res = await callAction(baseCreateFormData());

    expect(res).toEqual({ error: "記録は50件まで登録できます" });
    expect(await recordCount(user.id)).toBe(50);
  });

  it("49件の状態では create が成功し50件になる", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    for (let i = 0; i < 49; i++) {
      await seedCategoryRecord(db, user.id, { category: `cat-${i}`, recordType: "custom" });
    }

    const res = await callAction(baseCreateFormData());

    expect(res).toEqual({ success: true });
    expect(await recordCount(user.id)).toBe(50);
  });
});
