// /my-guides/templates の action（サーチクラフトテンプレートの公開切替・削除）の回帰テスト。
//
// 所有権チェック（userId AND templateId の where 条件）が、無条件 update/delete に対する
// 唯一の防壁になっている。他人の templateId を渡しても行を変更・削除できないことを実DBで検証する
// （app/routes/me/__tests__/edit.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedSearchCraftTemplate,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { searchCraftTemplates } from "@/lib/schema";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../templates";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/my-guides/templates", {
    method: "POST",
    body: formData,
  });
}

async function callAction(
  formData: FormData,
): Promise<{ success?: boolean; error?: string; action?: string; published?: boolean }> {
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

async function findTemplate(templateId: string) {
  return db.query.searchCraftTemplates.findFirst({
    where: eq(searchCraftTemplates.id, templateId),
  });
}

function actionFormData(_action: string, templateId: string): FormData {
  const fd = new FormData();
  fd.set("_action", _action);
  fd.set("templateId", templateId);
  return fd;
}

describe("action - 所有権チェック（他人のテンプレート）", () => {
  it("他人の templateId の delete は拒否され、行が残る", async () => {
    const owner = await seedUser(db, { slug: "owner", discordId: "discord-owner" });
    await seedUser(db, { slug: "attacker", discordId: "discord-attacker" });
    const template = await seedSearchCraftTemplate(db, owner.id, { title: "Owner's Template" });
    signInAs("discord-attacker");

    const res = await callAction(actionFormData("delete", template.id));

    expect(res).toEqual({ error: "テンプレートが見つかりません" });
    expect(await findTemplate(template.id)).toBeDefined();
  });

  it("他人の templateId の toggle-publish は拒否され、isPublished は不変", async () => {
    const owner = await seedUser(db, { slug: "owner", discordId: "discord-owner" });
    await seedUser(db, { slug: "attacker", discordId: "discord-attacker" });
    const template = await seedSearchCraftTemplate(db, owner.id, {
      title: "Owner's Template",
      isPublished: true,
    });
    signInAs("discord-attacker");

    const res = await callAction(actionFormData("toggle-publish", template.id));

    expect(res).toEqual({ error: "テンプレートが見つかりません" });
    expect((await findTemplate(template.id))?.isPublished).toBe(true);
  });
});

describe("action - 本人操作は成功する", () => {
  it("toggle-publish は成功し isPublished が反転する", async () => {
    const owner = await seedUser(db, { slug: "owner", discordId: "discord-owner" });
    const template = await seedSearchCraftTemplate(db, owner.id, {
      title: "My Template",
      isPublished: true,
    });
    signInAs("discord-owner");

    const res = await callAction(actionFormData("toggle-publish", template.id));

    expect(res).toEqual({ success: true, action: "toggle-publish", published: false });
    expect((await findTemplate(template.id))?.isPublished).toBe(false);
  });

  it("delete は成功し行が削除される", async () => {
    const owner = await seedUser(db, { slug: "owner", discordId: "discord-owner" });
    const template = await seedSearchCraftTemplate(db, owner.id, { title: "My Template" });
    signInAs("discord-owner");

    const res = await callAction(actionFormData("delete", template.id));

    expect(res).toEqual({ success: true, action: "delete" });
    expect(await findTemplate(template.id)).toBeUndefined();
  });
});
