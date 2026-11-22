// /me/playstyle の action の回帰テスト。
// playstyles と users の2回の書き込みが1トランザクションであること（片方だけ書かれない）、
// 不正な値は何も書かずにエラーを返すことを固定する。セッションはモックし、DB は実DBで検証する
// （records.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTranslator } from "@/lib/messages";

const t = createTranslator("ja");
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  schema,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { ALL_VERSION_KEYS, CATEGORY_KEYS, HOTBAR_SWITCHING_OPTIONS, editionOfVersion } from "@/lib/playstyle";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));
vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../playstyle";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

async function callAction(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
    else fd.set(k, v);
  }
  const request = new Request("https://minefolio.app/me/playstyle", { method: "POST", body: fd });
  return action({ request, params: {}, context: {} } as never) as Promise<{ success?: boolean; error?: string }>;
}

const VERSION = ALL_VERSION_KEYS[0];
const CATEGORY = CATEGORY_KEYS[0];
const HOTBAR = HOTBAR_SWITCHING_OPTIONS[0].value;

/** 画面の handleSave が送る形（空の欄は空文字） */
function validFields(overrides: Record<string, string | string[]> = {}): Record<string, string | string[]> {
  return {
    inputMethod: "keyboard_mouse",
    versions: [VERSION],
    categories: [CATEGORY],
    mainVersion: VERSION,
    mainCategory: CATEGORY,
    hotbarSwitching: HOTBAR,
    searchCraft: "",
    halfShift: "",
    itemLayoutPolicy: "",
    clickMethods: [],
    dragTapeType: "",
    usesMousepad: "",
    mousepadType: "",
    zeroCycle: "",
    groundZero: "",
    oneshot: "",
    favoriteBastion: "",
    ...overrides,
  };
}

async function playstyleRows(userId: string) {
  return db.query.playstyles.findMany({ where: eq(schema.playstyles.userId, userId) });
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

describe("action - 正常系", () => {
  it("playstyles を作成し、users の入力方法とメインエディションも更新する", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    const res = await callAction(validFields());

    expect(res).toEqual({ success: true });
    const [row] = await playstyleRows(user.id);
    expect(row).toMatchObject({ mainVersion: VERSION, mainCategory: CATEGORY, hotbarSwitching: HOTBAR });
    expect(JSON.parse(row.versions ?? "[]")).toEqual([VERSION]);
    const after = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(after).toMatchObject({ inputMethod: "keyboard_mouse", mainEdition: editionOfVersion(VERSION) });
  });

  it("2回目の保存は既存の playstyles 行を更新する（行は増えない）", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    await callAction(validFields());

    const res = await callAction(validFields({ inputMethod: "controller" }));

    expect(res).toEqual({ success: true });
    expect(await playstyleRows(user.id)).toHaveLength(1);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))?.inputMethod).toBe("controller");
  });
});

describe("action - 不正な値は何も書かずにエラーを返す", () => {
  it.each([
    ["hotbarSwitching", { hotbarSwitching: "evil" }],
    ["halfShift", { halfShift: "evil" }],
    ["usesMousepad", { usesMousepad: "evil" }],
    ["favoriteBastion", { favoriteBastion: "evil" }],
    ["mainVersion が選択外", { versions: [], mainVersion: VERSION }],
  ])("%s", async (_name, overrides) => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner", inputMethod: "touch" });
    signInAs("discord-runner");

    const res = await callAction(validFields(overrides));

    expect(res.error).toBeTruthy();
    expect(await playstyleRows(user.id)).toHaveLength(0);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))?.inputMethod).toBe("touch");
  });

  it("不正な入力方法は拒否し、playstyles も書かない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    const res = await callAction(validFields({ inputMethod: "gamepad" }));

    expect(res).toEqual({ error: t("meEdit.invalidOption") });
    expect(await playstyleRows(user.id)).toHaveLength(0);
  });

  it("テープの種類が101文字なら拒否する", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    const res = await callAction(validFields({ dragTapeType: "a".repeat(101) }));

    expect(res.error).toBe("テープの種類は100文字以下にしてください");
    expect(await playstyleRows(user.id)).toHaveLength(0);
  });
});

describe("action - 書き込みは1トランザクション", () => {
  it("users の更新が失敗したら playstyles も書かれず、エラーを返す（throw しない）", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    // 2回目の書き込み（users の UPDATE）だけを失敗させる
    await db.run(
      `CREATE TRIGGER fail_users_update BEFORE UPDATE ON users BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await callAction(validFields());

    expect(res).toEqual({ error: "プレイスタイルを保存できませんでした。時間をおいて、もう一度お試しください。" });
    expect(await playstyleRows(user.id)).toHaveLength(0);
    errorSpy.mockRestore();
  });
});
