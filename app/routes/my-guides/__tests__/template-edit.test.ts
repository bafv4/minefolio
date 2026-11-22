// /my-guides/templates/:templateId/edit の loader / action（公開版と下書きを分ける保存経路）の回帰テスト。
// draft = 下書き列だけ書く、publish = 公開版へ反映して下書きを消す、discard = 下書きを消す。
// 所有権チェックと「draft が公開列に触れない」ことを、実DBの列を1つずつ確かめて検証する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTranslator } from "@/lib/messages";

const t = createTranslator("ja");
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

import { action, loader } from "../template-edit";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

const PUBLISHED_AT = new Date("2026-02-01T00:00:00Z");
const PUBLISHED_UPDATED_AT = new Date("2026-03-01T00:00:00Z");
const DRAFT_AT = new Date("2026-04-01T00:00:00Z");

const PUBLIC_CRAFTS = JSON.stringify([{ items: ["stick"], variations: [{ str: "pub", withShift: false }] }]);
const PUBLIC_REMAPS = JSON.stringify([{ sourceKey: "key.keyboard.a", targetKey: "key.keyboard.b" }]);

/** フォームが送る形（crafts は searchStr だけの旧形式でも受理される） */
function craftsJson(str: string) {
  return JSON.stringify([{ items: ["stick"], variations: [{ str, withShift: false }] }]);
}

function form(action: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("_action", action);
  fd.set("title", "New Title");
  fd.set("description", "New Desc");
  fd.set("gameLanguage", "ja_jp");
  fd.set("crafts", craftsJson("new"));
  fd.set("remaps", "[]");
  fd.set("loops", "[]");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

async function callAction(templateId: string, formData: FormData) {
  const request = new Request(`https://minefolio.app/my-guides/templates/${templateId}/edit`, {
    method: "POST",
    body: formData,
  });
  return action({ request, params: { templateId }, context: {} } as never) as Promise<{
    success?: boolean;
    error?: string;
    action?: string;
  }>;
}

async function callLoader(templateId: string) {
  const request = new Request(`https://minefolio.app/my-guides/templates/${templateId}/edit`);
  return loader({ request, params: { templateId }, context: {} } as never) as Promise<{
    template: {
      id: string;
      title: string;
      description: string;
      gameLanguage: string;
      crafts: Array<{ variations: Array<{ str: string }> }>;
      remaps: unknown[];
      loops: unknown[];
      isPublished: boolean;
      hasDraft: boolean;
      draftUpdatedAt: string | null;
    };
  }>;
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

async function findTemplate(id: string) {
  const row = await db.query.searchCraftTemplates.findFirst({
    where: eq(searchCraftTemplates.id, id),
  });
  if (!row) throw new Error("template not found");
  return row;
}

const DRAFT_NULL = {
  draftTitle: null,
  draftDescription: null,
  draftGameLanguage: null,
  draftCraftsData: null,
  draftRemapsData: null,
  draftLoopsData: null,
  draftUpdatedAt: null,
};

async function seedOwner() {
  return seedUser(db, { slug: "owner", discordId: "discord-owner" });
}

/** 公開中で、下書きなしのテンプレート */
async function seedPublished(userId: string, overrides = {}) {
  return seedSearchCraftTemplate(db, userId, {
    title: "Public Title",
    description: "Public Desc",
    gameLanguage: "en_us",
    craftsData: PUBLIC_CRAFTS,
    remapsData: PUBLIC_REMAPS,
    loopsData: null,
    isPublished: true,
    publishedAt: PUBLISHED_AT,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: PUBLISHED_UPDATED_AT,
    ...overrides,
  });
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

describe("action - _action の検証", () => {
  it("未知の _action は拒否され、DB は変わらない", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id);
    signInAs("discord-owner");

    const res = await callAction(tpl.id, form("bogus"));

    expect(res).toEqual({ error: t("meTemplates.unknownAction") });
    expect(await findTemplate(tpl.id)).toEqual(tpl);
  });

  it("_action が無いときも拒否され、DB は変わらない", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id);
    signInAs("discord-owner");
    const fd = form("draft");
    fd.delete("_action");

    const res = await callAction(tpl.id, fd);

    expect(res).toHaveProperty("error");
    expect(await findTemplate(tpl.id)).toEqual(tpl);
  });
});

describe("action - discard", () => {
  it("下書き列7つを null にし、公開列は変えない", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id, {
      draftTitle: "d-title",
      draftDescription: "d-desc",
      draftGameLanguage: "ja_jp",
      draftCraftsData: craftsJson("d"),
      draftRemapsData: PUBLIC_REMAPS,
      draftLoopsData: "[]",
      draftUpdatedAt: DRAFT_AT,
    });
    signInAs("discord-owner");

    const res = await callAction(tpl.id, form("discard"));

    expect(res).toEqual({ success: true, action: "discard" });
    expect(await findTemplate(tpl.id)).toEqual({ ...tpl, ...DRAFT_NULL });
  });
});

describe("action - draft", () => {
  it("公開中: draft 6列と draftUpdatedAt だけが変わり、公開列・isPublished・updatedAt・publishedAt は不変", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id);
    signInAs("discord-owner");

    const res = await callAction(
      tpl.id,
      form("draft", {
        remaps: JSON.stringify([{ sourceKey: "key.keyboard.q", targetKey: "key.keyboard.w" }]),
      }),
    );

    expect(res).toEqual({ success: true, action: "draft" });
    const after = await findTemplate(tpl.id);
    // 公開列は1つずつ確かめる
    expect(after.title).toBe("Public Title");
    expect(after.description).toBe("Public Desc");
    expect(after.gameLanguage).toBe("en_us");
    expect(after.craftsData).toBe(PUBLIC_CRAFTS);
    expect(after.remapsData).toBe(PUBLIC_REMAPS);
    expect(after.loopsData).toBeNull();
    expect(after.isPublished).toBe(true);
    expect(after.updatedAt).toEqual(PUBLISHED_UPDATED_AT);
    expect(after.publishedAt).toEqual(PUBLISHED_AT);
    // 下書き列
    expect(after.draftTitle).toBe("New Title");
    expect(after.draftDescription).toBe("New Desc");
    expect(after.draftGameLanguage).toBe("ja_jp");
    expect(after.draftCraftsData).toContain("new");
    expect(after.draftRemapsData).toContain("key.keyboard.q");
    expect(after.draftLoopsData).toBeNull();
    expect(after.draftUpdatedAt).toBeInstanceOf(Date);
    expect(after.draftUpdatedAt!.getTime()).toBeGreaterThan(DRAFT_AT.getTime() - 1);
  });

  it("下書きで説明・言語を空にして保存すると、下書き側は null で保存される（公開版は不変）", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id);
    signInAs("discord-owner");

    await callAction(tpl.id, form("draft", { description: "", gameLanguage: "" }));

    const after = await findTemplate(tpl.id);
    expect(after.draftDescription).toBeNull();
    expect(after.draftGameLanguage).toBeNull();
    expect(after.draftUpdatedAt).not.toBeNull();
    expect(after.description).toBe("Public Desc");
    expect(after.gameLanguage).toBe("en_us");
  });

  it("未公開: error を返し、DB は変わらない", async () => {
    const owner = await seedOwner();
    const tpl = await seedSearchCraftTemplate(db, owner.id, {
      title: "Hidden",
      isPublished: false,
    });
    signInAs("discord-owner");

    const res = await callAction(tpl.id, form("draft"));

    expect(res).toHaveProperty("error");
    expect(res.success).toBeUndefined();
    expect(await findTemplate(tpl.id)).toEqual(tpl);
  });

  it("検証エラー（タイトル空）は error を返し、DB は変わらない", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id);
    signInAs("discord-owner");

    const res = await callAction(tpl.id, form("draft", { title: "   " }));

    expect(res).toHaveProperty("error");
    expect(await findTemplate(tpl.id)).toEqual(tpl);
  });
});

describe("action - publish", () => {
  it("公開列を上書きし、updatedAt を更新、下書き列7つを null にする。publishedAt は既存のまま", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id, {
      draftTitle: "d-title",
      draftDescription: "d-desc",
      draftGameLanguage: "ja_jp",
      draftCraftsData: craftsJson("d"),
      draftRemapsData: PUBLIC_REMAPS,
      draftLoopsData: "[]",
      draftUpdatedAt: DRAFT_AT,
    });
    signInAs("discord-owner");

    const res = await callAction(tpl.id, form("publish", { isPublished: "true" }));

    expect(res).toEqual({ success: true, action: "publish" });
    const after = await findTemplate(tpl.id);
    expect(after.title).toBe("New Title");
    expect(after.description).toBe("New Desc");
    expect(after.gameLanguage).toBe("ja_jp");
    expect(after.craftsData).toContain("new");
    expect(after.remapsData).toBeNull();
    expect(after.loopsData).toBeNull();
    expect(after.isPublished).toBe(true);
    expect(after.publishedAt).toEqual(PUBLISHED_AT);
    expect(after.updatedAt.getTime()).toBeGreaterThan(PUBLISHED_UPDATED_AT.getTime());
    expect(after).toMatchObject(DRAFT_NULL);
  });

  it("isPublished は \"true\" のときだけ true（それ以外は false）", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id);
    signInAs("discord-owner");

    await callAction(tpl.id, form("publish", { isPublished: "false" }));
    expect((await findTemplate(tpl.id)).isPublished).toBe(false);

    await callAction(tpl.id, form("publish", { isPublished: "true" }));
    expect((await findTemplate(tpl.id)).isPublished).toBe(true);

    await callAction(tpl.id, form("publish", { isPublished: "1" }));
    expect((await findTemplate(tpl.id)).isPublished).toBe(false);

    await callAction(tpl.id, form("publish"));
    expect((await findTemplate(tpl.id)).isPublished).toBe(false);
  });

  it("検証エラーは error を返し、DB は変わらない", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id, { draftTitle: "keep", draftUpdatedAt: DRAFT_AT });
    signInAs("discord-owner");

    const res = await callAction(tpl.id, form("publish", { isPublished: "true", crafts: "[]" }));

    expect(res).toHaveProperty("error");
    expect(await findTemplate(tpl.id)).toEqual(tpl);
  });
});

describe("action - publishedAt", () => {
  it("未公開→公開で入る", async () => {
    const owner = await seedOwner();
    const tpl = await seedSearchCraftTemplate(db, owner.id, {
      isPublished: false,
      publishedAt: null,
    });
    signInAs("discord-owner");
    const before = Date.now();

    await callAction(tpl.id, form("publish", { isPublished: "true" }));

    const after = await findTemplate(tpl.id);
    expect(after.isPublished).toBe(true);
    expect(after.publishedAt).toBeInstanceOf(Date);
    expect(after.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("未公開のまま保存しても null のまま", async () => {
    const owner = await seedOwner();
    const tpl = await seedSearchCraftTemplate(db, owner.id, {
      isPublished: false,
      publishedAt: null,
    });
    signInAs("discord-owner");

    await callAction(tpl.id, form("publish", { isPublished: "false" }));

    const after = await findTemplate(tpl.id);
    expect(after.isPublished).toBe(false);
    expect(after.publishedAt).toBeNull();
    expect(after.title).toBe("New Title");
  });

  it("公開→取り下げ→再公開で publishedAt は変わらない", async () => {
    const owner = await seedOwner();
    const tpl = await seedSearchCraftTemplate(db, owner.id, {
      isPublished: false,
      publishedAt: null,
    });
    signInAs("discord-owner");

    await callAction(tpl.id, form("publish", { isPublished: "true" }));
    const first = (await findTemplate(tpl.id)).publishedAt;
    expect(first).not.toBeNull();

    await callAction(tpl.id, form("publish", { isPublished: "false" }));
    expect((await findTemplate(tpl.id)).publishedAt).toEqual(first);

    await new Promise((r) => setTimeout(r, 1100));
    await callAction(tpl.id, form("publish", { isPublished: "true" }));
    const last = await findTemplate(tpl.id);
    expect(last.isPublished).toBe(true);
    expect(last.publishedAt).toEqual(first);
  });

  it("publishedAt が null の公開行（バックフィル前）を公開保存すると now が入る", async () => {
    const owner = await seedOwner();
    const tpl = await seedSearchCraftTemplate(db, owner.id, {
      isPublished: true,
      publishedAt: null,
    });
    signInAs("discord-owner");

    await callAction(tpl.id, form("publish", { isPublished: "true" }));

    expect((await findTemplate(tpl.id)).publishedAt).toBeInstanceOf(Date);
  });
});

describe("action - 所有権", () => {
  it.each(["draft", "publish", "discard"])(
    "他人のテンプレートへの %s は拒否され、DB は変わらない",
    async (act) => {
      const owner = await seedOwner();
      await seedUser(db, { slug: "attacker", discordId: "discord-attacker" });
      const tpl = await seedPublished(owner.id);
      signInAs("discord-attacker");

      const res = await callAction(tpl.id, form(act, { isPublished: "true" }));

      expect(res).toEqual({ error: "テンプレートが見つかりません" });
      expect(await findTemplate(tpl.id)).toEqual(tpl);
    },
  );

  it("存在しない id は error", async () => {
    await seedOwner();
    signInAs("discord-owner");

    const res = await callAction("nonexistentid000000000000", form("publish"));

    expect(res).toEqual({ error: "テンプレートが見つかりません" });
  });
});

describe("loader", () => {
  async function seedWithDraft(userId: string, draftOverrides = {}) {
    return seedPublished(userId, {
      draftTitle: "Draft Title",
      draftDescription: "Draft Desc",
      draftGameLanguage: "ja_jp",
      draftCraftsData: craftsJson("draftstr"),
      draftRemapsData: PUBLIC_REMAPS,
      draftLoopsData: null,
      draftUpdatedAt: DRAFT_AT,
      ...draftOverrides,
    });
  }

  it("下書きがあるとき、下書きの値を返す（hasDraft・draftUpdatedAt つき）", async () => {
    const owner = await seedOwner();
    const tpl = await seedWithDraft(owner.id);
    signInAs("discord-owner");

    const { template } = await callLoader(tpl.id);

    expect(template.hasDraft).toBe(true);
    expect(template.draftUpdatedAt).toBe(DRAFT_AT.toISOString());
    expect(template.title).toBe("Draft Title");
    expect(template.description).toBe("Draft Desc");
    expect(template.gameLanguage).toBe("ja_jp");
    expect(template.crafts[0].variations[0].str).toBe("draftstr");
    expect(template.remaps).toHaveLength(1);
    expect(template.isPublished).toBe(true);
  });

  it("下書きで description / gameLanguage / remaps を空にしたとき、公開版へ落ちない", async () => {
    const owner = await seedOwner();
    const tpl = await seedWithDraft(owner.id, {
      draftDescription: null,
      draftGameLanguage: null,
      draftRemapsData: null,
    });
    signInAs("discord-owner");

    const { template } = await callLoader(tpl.id);

    expect(template.hasDraft).toBe(true);
    expect(template.description).toBe("");
    expect(template.gameLanguage).toBe("");
    expect(template.remaps).toEqual([]);
  });

  it("下書きが無いとき、公開版を返す", async () => {
    const owner = await seedOwner();
    const tpl = await seedPublished(owner.id);
    signInAs("discord-owner");

    const { template } = await callLoader(tpl.id);

    expect(template.hasDraft).toBe(false);
    expect(template.draftUpdatedAt).toBeNull();
    expect(template.title).toBe("Public Title");
    expect(template.description).toBe("Public Desc");
    expect(template.gameLanguage).toBe("en_us");
    expect(template.crafts[0].variations[0].str).toBe("pub");
    expect(template.remaps).toHaveLength(1);
  });

  it("他人のテンプレートは読めない（404）", async () => {
    const owner = await seedOwner();
    await seedUser(db, { slug: "other", discordId: "discord-other" });
    const tpl = await seedWithDraft(owner.id);
    signInAs("discord-other");

    const thrown = await callLoader(tpl.id).then(
      () => null,
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });
});
