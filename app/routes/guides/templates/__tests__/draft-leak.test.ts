// 下書き（draft_* 列）が公開側の出力へ漏れないことの回帰テスト。
// 公開中のテンプレートの下書き列に目印を全部入れ、公開側の loader / action の出力（JSON.stringify）や
// DB に書かれた行に目印が含まれないことを確かめる。本人の編集 loader だけは、目印を返すのが正しい。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedGuide,
  seedSearchCraftTemplate,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import * as schema from "@/lib/schema";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

// 自動翻訳の読み取りは外部 API 前提なので null 固定にする
vi.mock("@/lib/content-translation.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content-translation.server")>();
  return { ...actual, getGuideTranslation: vi.fn().mockResolvedValue(null) };
});

import { loader as indexLoader } from "../index";
import { loader as viewLoader, action as viewAction } from "../view";
import { loader as playgroundLoader } from "@/routes/playground";
import { loader as guideViewLoader } from "@/routes/guides/view";
import { loader as searchLoader } from "@/routes/api/guides/templates-search";
import { loader as myTemplatesLoader } from "@/routes/my-guides/templates";
import { loader as editLoader } from "@/routes/my-guides/template-edit";

const MARKER = "DRAFT_LEAK_MARKER";
const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

const PUBLIC_CRAFTS = JSON.stringify([
  { items: ["stick"], comment: null, timing: null, variations: [{ str: "pubstr", withShift: false }] },
]);
const DRAFT_CRAFTS = JSON.stringify([
  {
    items: [MARKER],
    comment: MARKER,
    timing: null,
    variations: [{ str: MARKER, withShift: false }],
  },
]);
const DRAFT_REMAPS = JSON.stringify([{ sourceKey: MARKER, targetKey: MARKER }]);
const PUBLIC_REMAPS = JSON.stringify([{ sourceKey: "key.keyboard.a", targetKey: "key.keyboard.b" }]);
const DRAFT_LOOPS = JSON.stringify([{ comment: MARKER, steps: [{ craftIndex: 0, transition: null }] }]);

const DRAFT_COLUMNS = {
  draftTitle: MARKER,
  draftDescription: MARKER,
  draftGameLanguage: MARKER,
  draftCraftsData: DRAFT_CRAFTS,
  draftRemapsData: DRAFT_REMAPS,
  draftLoopsData: DRAFT_LOOPS,
  draftUpdatedAt: new Date("2026-04-01T00:00:00Z"),
};

async function seedAuthor(slug = "author", visibility: "public" | "private" | "unlisted" = "public") {
  return seedUser(db, {
    slug,
    discordId: `discord-${slug}`,
    displayName: "Author",
    profileVisibility: visibility,
  });
}

/** 公開中・公開版は目印なし・下書き列だけ目印を入れたテンプレート */
async function seedLeakyTemplate(userId: string, overrides = {}) {
  return seedSearchCraftTemplate(db, userId, {
    title: "Public Title",
    description: "Public Desc",
    gameLanguage: "en_us",
    craftsData: PUBLIC_CRAFTS,
    remapsData: PUBLIC_REMAPS,
    loopsData: null,
    isPublished: true,
    publishedAt: new Date("2026-02-01T00:00:00Z"),
    ...DRAFT_COLUMNS,
    ...overrides,
  });
}

function signInAs(discordId: string | null) {
  const session = discordId ? { user: { id: discordId } } : null;
  sessionMocks.getOptionalSession.mockResolvedValue(session);
  sessionMocks.getSession.mockResolvedValue(session);
}

function req(path: string, init?: RequestInit) {
  return new Request(`https://minefolio.app${path}`, init);
}

/** loader の結果（Response なら本文、throw された Response なら status）を文字列にする */
async function dump(run: () => unknown): Promise<string> {
  try {
    const out = await run();
    if (out instanceof Response) return await out.text();
    return JSON.stringify(out);
  } catch (e) {
    if (e instanceof Response) return `RESPONSE ${e.status}`;
    throw e;
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  signInAs(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("下書きが公開側へ漏れない", () => {
  it("公開一覧の loader", async () => {
    const author = await seedAuthor();
    await seedLeakyTemplate(author.id);

    const out = await dump(() =>
      indexLoader({ request: req("/guides/templates"), params: {}, context: {} } as never),
    );

    expect(out).toContain("Public Title"); // 空振りでないことの確認
    expect(out).not.toContain(MARKER);
  });

  it.each([
    ["本人が見たとき", "discord-author"],
    ["他人が見たとき", "discord-viewer"],
    ["未ログイン", null],
  ])("詳細の loader（%s）", async (_label, viewer) => {
    const author = await seedAuthor();
    await seedUser(db, { slug: "viewer", discordId: "discord-viewer" });
    const tpl = await seedLeakyTemplate(author.id);
    signInAs(viewer);

    const out = await dump(() =>
      viewLoader({
        request: req(`/guides/templates/${tpl.id}`),
        params: { templateId: tpl.id },
        context: {},
      } as never),
    );

    expect(out).toContain("Public Title");
    expect(out).not.toContain(MARKER);
  });

  it("詳細の loader（本人が未公開のテンプレートに古い下書きを持つ場合）", async () => {
    const author = await seedAuthor();
    const tpl = await seedLeakyTemplate(author.id, { isPublished: false });
    signInAs("discord-author");

    const out = await dump(() =>
      viewLoader({
        request: req(`/guides/templates/${tpl.id}`),
        params: { templateId: tpl.id },
        context: {},
      } as never),
    );

    expect(out).toContain("Public Title");
    expect(out).not.toContain(MARKER);
  });

  it.each(["new", "existing"] as const)(
    "「反映」の action（target=%s）が DB に書く設定・プリセット・履歴と、その戻り値",
    async (target) => {
      const author = await seedAuthor();
      const applier = await seedUser(db, { slug: "applier", discordId: "discord-applier" });
      const tpl = await seedLeakyTemplate(author.id);
      signInAs("discord-applier");

      const fd = new FormData();
      fd.set("_action", "apply");
      fd.set("applyRemaps", "1");
      fd.set("target", target);
      if (target === "new") {
        fd.set("name", "From Template");
      } else {
        const [preset] = await db
          .insert(schema.configPresets)
          .values({ userId: applier.id, name: "Existing", isActive: false })
          .returning();
        fd.set("presetId", preset.id);
      }
      const res = (await viewAction({
        request: req(`/guides/templates/${tpl.id}`, { method: "POST", body: fd }),
        params: { templateId: tpl.id },
        context: {},
      } as never)) as { success?: boolean; error?: string };
      expect(res.success, JSON.stringify(res)).toBe(true);

      const written = {
        res,
        presets: await db.query.configPresets.findMany({ where: eq(schema.configPresets.userId, applier.id) }),
        crafts: await db.select().from(schema.searchCrafts).where(eq(schema.searchCrafts.userId, applier.id)),
        loops: await db
          .select()
          .from(schema.searchCraftLoops)
          .where(eq(schema.searchCraftLoops.userId, applier.id)),
        remaps: await db.select().from(schema.keyRemaps).where(eq(schema.keyRemaps.userId, applier.id)),
        history: await db.select().from(schema.configHistory).where(eq(schema.configHistory.userId, applier.id)),
      };
      const out = JSON.stringify(written);

      expect(out).toContain("pubstr"); // 公開版は反映されている
      expect(out).not.toContain(MARKER);
    },
  );

  it.each([
    ["本人が見たとき", "discord-author"],
    ["他人が見たとき", "discord-viewer"],
    ["未ログイン", null],
  ])("Playground の ?template= の loader（%s）", async (_label, viewer) => {
    const author = await seedAuthor();
    await seedUser(db, { slug: "viewer", discordId: "discord-viewer" });
    const tpl = await seedLeakyTemplate(author.id);
    signInAs(viewer);

    const out = await dump(() =>
      playgroundLoader({
        request: req(`/playground?template=${tpl.id}`),
        params: {},
        context: {},
      } as never),
    );

    expect(out).toContain("Public Title");
    expect(out).not.toContain(MARKER);
  });

  it("ガイド記事の埋め込み（テンプレートを埋め込んだガイドの loader）", async () => {
    const author = await seedAuthor();
    const tpl = await seedLeakyTemplate(author.id);
    await seedGuide(db, author.id, {
      slug: "embed-guide",
      title: "Embed Guide",
      content: `<p>x</p><div data-sctemplate-embed="" data-template-id="${tpl.id}"></div>`,
      isPublished: true,
    });

    const out = await dump(() =>
      guideViewLoader({
        request: req("/guides/author/embed-guide"),
        params: { authorSlug: "author", guideSlug: "embed-guide" },
        context: {},
      } as never),
    );

    expect(out).toContain("Public Title");
    expect(out).toContain("pubstr");
    expect(out).not.toContain(MARKER);
  });

  it.each([
    ["q 検索", "?q=Public"],
    ["新着", ""],
    ["id 指定", "ID"],
  ])("templates-search の API（本人として呼ぶ・%s）", async (_label, qs) => {
    const author = await seedAuthor();
    const tpl = await seedLeakyTemplate(author.id);
    signInAs("discord-author");
    const search = qs === "ID" ? `?id=${tpl.id}` : qs;

    const out = await dump(() =>
      searchLoader({
        request: req(`/api/guides/templates-search${search}`),
        params: {},
        context: {},
      } as never),
    );

    expect(out).toContain("Public Title");
    expect(out).not.toContain(MARKER);
  });

  it("/my-guides/templates の loader（本人）は下書きの有無だけを返す", async () => {
    const author = await seedAuthor();
    await seedLeakyTemplate(author.id);
    signInAs("discord-author");

    const raw = (await myTemplatesLoader({
      request: req("/my-guides/templates"),
      params: {},
      context: {},
    } as never)) as { templates: Array<{ hasDraft: boolean }> };
    const out = JSON.stringify(raw);

    expect(raw.templates[0].hasDraft).toBe(true);
    expect(out).not.toContain(MARKER);
  });

  it("対照: 本人の編集 loader は下書きの値（目印）を返す", async () => {
    const author = await seedAuthor();
    const tpl = await seedLeakyTemplate(author.id);
    signInAs("discord-author");

    const out = await dump(() =>
      editLoader({
        request: req(`/my-guides/templates/${tpl.id}/edit`),
        params: { templateId: tpl.id },
        context: {},
      } as never),
    );

    expect(out).toContain(MARKER);
  });
});

describe("非公開のテンプレートは公開側に出ない", () => {
  it("公開一覧・他人の詳細（404）・Playground・埋め込み・検索（他人）", async () => {
    const author = await seedAuthor();
    await seedUser(db, { slug: "viewer", discordId: "discord-viewer" });
    const tpl = await seedSearchCraftTemplate(db, author.id, {
      title: "HiddenTemplate",
      craftsData: PUBLIC_CRAFTS,
      isPublished: false,
    });
    await seedGuide(db, author.id, {
      slug: "embed-guide",
      content: `<div data-sctemplate-embed="" data-template-id="${tpl.id}"></div>`,
      isPublished: true,
    });
    signInAs("discord-viewer");

    const list = await dump(() =>
      indexLoader({ request: req("/guides/templates"), params: {}, context: {} } as never),
    );
    const detail = await dump(() =>
      viewLoader({
        request: req(`/guides/templates/${tpl.id}`),
        params: { templateId: tpl.id },
        context: {},
      } as never),
    );
    const playground = await dump(() =>
      playgroundLoader({
        request: req(`/playground?template=${tpl.id}`),
        params: {},
        context: {},
      } as never),
    );
    const embed = await dump(() =>
      guideViewLoader({
        request: req("/guides/author/embed-guide"),
        params: { authorSlug: "author", guideSlug: "embed-guide" },
        context: {},
      } as never),
    );
    const search = await dump(() =>
      searchLoader({
        request: req("/api/guides/templates-search?q=Hidden"),
        params: {},
        context: {},
      } as never),
    );
    const searchById = await dump(() =>
      searchLoader({
        request: req(`/api/guides/templates-search?id=${tpl.id}`),
        params: {},
        context: {},
      } as never),
    );

    expect(list).not.toContain("HiddenTemplate");
    expect(detail).toBe("RESPONSE 404");
    expect(playground).not.toContain("HiddenTemplate");
    expect(embed).not.toContain("HiddenTemplate");
    expect(search).not.toContain("HiddenTemplate");
    expect(searchById).not.toContain("HiddenTemplate");
  });
});
