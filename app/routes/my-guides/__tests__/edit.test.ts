// /my-guides/:guideSlug の action（ガイド編集の保存）の回帰テスト。
//
// このルートは「公開版（title / content / summary / tags / isPublished / coverImageUrl）」と
// 「ドラフト列（draft*）」という2系統の列を _action の値で書き分ける。書き分けを間違えると
// 執筆中の内容が失われる（仮保存のつもりで公開版を上書きする / 公開版を消す）ため、
// 列の書き分けそのものを実DBで固定する。
//
// 併せて _action の allowlist（"discard" / "draft" / "publish" 以外は publish に倒さず拒否）も
// 固定する。未知・欠落値が publish 扱いになると、意図しない公開版の上書きが起きる。
//
// セッションはモックし、ルート本体（所有権・検証・DB書き込み）は実DBで検証する
// （app/routes/me/__tests__/edit.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedGuide,
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

import { action } from "../edit";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

// pages-ja.ts の meGuides.* に対応する期待文言（既定ロケール = ja）
const ERROR_INVALID_ACTION = "不正な操作です。ページを再読み込みしてから、もう一度お試しください";
const ERROR_NOT_FOUND = "ガイドが見つかりません";
const ERROR_SLUG_REQUIRED = "URLを入力してください（半角英小文字・数字・ハイフン・アンダースコア）";
const ERROR_SLUG_TAKEN = "このURLは既に使われています。別の値を指定してください";
const ERROR_TAGS_INVALID = "タグの形式が不正です";
const ERROR_TAGS_TOO_MANY = "タグは10件までです";
const ERROR_TAG_TOO_LONG = "タグは50文字以内で入力してください";

// 公開版とドラフトを取り違えていないことを判別するためのマーカー
const PUBLISHED_CONTENT = "<p>PUBLISHED_BODY</p>";
const DRAFT_CONTENT = "<p>DRAFT_BODY</p>";

let db: TestDb;

type ActionResult = { success?: boolean; mode?: string; slug?: string; error?: string };

function makeRequest(guideSlug: string, formData: FormData): Request {
  return new Request(`https://minefolio.app/my-guides/${guideSlug}/edit`, {
    method: "POST",
    body: formData,
  });
}

async function callAction(guideSlug: string, formData: FormData): Promise<ActionResult> {
  return action({
    request: makeRequest(guideSlug, formData),
    params: { guideSlug },
    context: {},
  } as never) as never;
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

/** 公開済みガイドを1件持つ著者を用意してログイン状態にする */
async function setupAuthorWithGuide(
  guideOverrides: Partial<typeof schema.guides.$inferInsert> = {},
) {
  const author = await seedUser(db, { slug: "author", discordId: "discord-author" });
  const guide = await seedGuide(db, author.id, {
    slug: "my-guide",
    title: "公開タイトル",
    summary: "公開概要",
    content: PUBLISHED_CONTENT,
    tags: JSON.stringify(["published-tag"]),
    coverImageUrl: "https://example.com/published.png",
    isPublished: true,
    ...guideOverrides,
  });
  signInAs("discord-author");
  return { author, guide };
}

/** 未コミットのドラフトを持つ状態を用意する */
async function setupAuthorWithDraftedGuide() {
  return setupAuthorWithGuide({
    draftTitle: "下書きタイトル",
    draftSummary: "下書き概要",
    draftContent: DRAFT_CONTENT,
    draftCoverImageUrl: "https://example.com/draft.png",
    draftTags: JSON.stringify(["draft-tag"]),
    draftUpdatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

async function findGuide(id: string) {
  const row = await db.query.guides.findFirst({ where: eq(schema.guides.id, id) });
  if (!row) throw new Error(`guide ${id} not found`);
  return row;
}

/** 保存フォームの最小構成。overrides で個別の欄だけ差し替える */
function baseFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    slug: "my-guide",
    title: "送信タイトル",
    content: "<p>SUBMITTED_BODY</p>",
    summary: "送信概要",
    tags: JSON.stringify(["submitted-tag"]),
    isPublished: "true",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

describe("action - 仮保存（_action=draft）", () => {
  it("ドラフト列だけを更新し、公開版の列は一切変更しない", async () => {
    const { guide } = await setupAuthorWithGuide();
    const before = await findGuide(guide.id);

    const res = await callAction(
      "my-guide",
      baseFormData({
        _action: "draft",
        title: "下書きタイトル",
        content: DRAFT_CONTENT,
        summary: "下書き概要",
        tags: JSON.stringify(["draft-tag"]),
        // 公開状態を落とす値を送っても、仮保存では公開版に反映されない
        isPublished: "false",
        coverImageUrl: "https://example.com/draft.png",
      }),
    );

    expect(res).toEqual({ success: true, mode: "draft", slug: "my-guide" });

    const after = await findGuide(guide.id);
    // 公開版は不変
    expect(after.title).toBe(before.title);
    expect(after.summary).toBe(before.summary);
    expect(after.content).toBe(PUBLISHED_CONTENT);
    expect(after.tags).toBe(before.tags);
    expect(after.isPublished).toBe(true);
    expect(after.coverImageUrl).toBe(before.coverImageUrl);
    expect(after.updatedAt).toEqual(before.updatedAt);
    // ドラフト列のみ書かれる
    expect(after.draftTitle).toBe("下書きタイトル");
    expect(after.draftSummary).toBe("下書き概要");
    expect(after.draftContent).toBe(DRAFT_CONTENT);
    expect(after.draftTags).toBe(JSON.stringify(["draft-tag"]));
    expect(after.draftCoverImageUrl).toBe("https://example.com/draft.png");
    expect(after.draftUpdatedAt).toBeInstanceOf(Date);
  });

  it("スラッグはライブ列のため仮保存でも反映される", async () => {
    const { guide } = await setupAuthorWithGuide();

    const res = await callAction(
      "my-guide",
      baseFormData({ _action: "draft", slug: "renamed-guide" }),
    );

    expect(res).toEqual({ success: true, mode: "draft", slug: "renamed-guide" });
    expect((await findGuide(guide.id)).slug).toBe("renamed-guide");
  });
});

describe("action - 保存（_action=publish）", () => {
  it("公開版の列を更新し、ドラフト列をクリアする", async () => {
    const { guide } = await setupAuthorWithDraftedGuide();

    const res = await callAction(
      "my-guide",
      baseFormData({
        _action: "publish",
        title: "新しい公開タイトル",
        content: "<p>NEW_PUBLISHED_BODY</p>",
        summary: "新しい公開概要",
        tags: JSON.stringify(["a", "b"]),
        isPublished: "true",
        coverImageUrl: "https://example.com/new-cover.png",
      }),
    );

    expect(res).toEqual({ success: true, mode: "publish", slug: "my-guide" });

    const after = await findGuide(guide.id);
    expect(after.title).toBe("新しい公開タイトル");
    expect(after.content).toBe("<p>NEW_PUBLISHED_BODY</p>");
    expect(after.summary).toBe("新しい公開概要");
    expect(after.tags).toBe(JSON.stringify(["a", "b"]));
    expect(after.isPublished).toBe(true);
    expect(after.coverImageUrl).toBe("https://example.com/new-cover.png");
    // コミット済みとしてドラフトは全消し
    expect(after.draftTitle).toBeNull();
    expect(after.draftSummary).toBeNull();
    expect(after.draftContent).toBeNull();
    expect(after.draftCoverImageUrl).toBeNull();
    expect(after.draftTags).toBeNull();
    expect(after.draftUpdatedAt).toBeNull();
  });

  it("isPublished=false は非公開化として公開版へ反映される", async () => {
    const { guide } = await setupAuthorWithGuide();

    const res = await callAction("my-guide", baseFormData({ _action: "publish", isPublished: "false" }));

    expect(res).toEqual({ success: true, mode: "publish", slug: "my-guide" });
    expect((await findGuide(guide.id)).isPublished).toBe(false);
  });
});

describe("action - 破棄（_action=discard）", () => {
  it("ドラフト列だけを null 化し、公開版は不変", async () => {
    const { guide } = await setupAuthorWithDraftedGuide();
    const before = await findGuide(guide.id);

    const fd = new FormData();
    fd.set("_action", "discard");
    const res = await callAction("my-guide", fd);

    expect(res).toEqual({ success: true, mode: "discard", slug: "my-guide" });

    const after = await findGuide(guide.id);
    expect(after.draftTitle).toBeNull();
    expect(after.draftSummary).toBeNull();
    expect(after.draftContent).toBeNull();
    expect(after.draftCoverImageUrl).toBeNull();
    expect(after.draftTags).toBeNull();
    expect(after.draftUpdatedAt).toBeNull();
    // 公開版とスラッグは触らない
    expect(after.slug).toBe(before.slug);
    expect(after.title).toBe(before.title);
    expect(after.summary).toBe(before.summary);
    expect(after.content).toBe(PUBLISHED_CONTENT);
    expect(after.tags).toBe(before.tags);
    expect(after.isPublished).toBe(before.isPublished);
    expect(after.coverImageUrl).toBe(before.coverImageUrl);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});

describe("action - _action の allowlist", () => {
  it("未知の _action は publish に倒さず拒否し、ガイド行を変更しない", async () => {
    const { guide } = await setupAuthorWithDraftedGuide();
    const before = await findGuide(guide.id);

    const res = await callAction("my-guide", baseFormData({ _action: "banana" }));

    expect(res).toEqual({ error: ERROR_INVALID_ACTION });
    expect(await findGuide(guide.id)).toEqual(before);
  });

  it("_action 欠落も拒否し、ガイド行を変更しない", async () => {
    const { guide } = await setupAuthorWithDraftedGuide();
    const before = await findGuide(guide.id);

    const res = await callAction("my-guide", baseFormData());

    expect(res).toEqual({ error: ERROR_INVALID_ACTION });
    expect(await findGuide(guide.id)).toEqual(before);
  });

  it("空文字の _action も拒否する", async () => {
    const { guide } = await setupAuthorWithDraftedGuide();
    const before = await findGuide(guide.id);

    const res = await callAction("my-guide", baseFormData({ _action: "" }));

    expect(res).toEqual({ error: ERROR_INVALID_ACTION });
    expect(await findGuide(guide.id)).toEqual(before);
  });
});

describe("action - tags の検証", () => {
  it("JSON配列でない（オブジェクト）値は拒否し、ガイド行を変更しない", async () => {
    const { guide } = await setupAuthorWithGuide();
    const before = await findGuide(guide.id);

    const res = await callAction(
      "my-guide",
      baseFormData({ _action: "publish", tags: JSON.stringify({ a: 1 }) }),
    );

    expect(res).toEqual({ error: ERROR_TAGS_INVALID });
    expect(await findGuide(guide.id)).toEqual(before);
  });

  it("壊れたJSONは拒否する", async () => {
    const { guide } = await setupAuthorWithGuide();
    const before = await findGuide(guide.id);

    const res = await callAction("my-guide", baseFormData({ _action: "draft", tags: "[oops" }));

    expect(res).toEqual({ error: ERROR_TAGS_INVALID });
    expect(await findGuide(guide.id)).toEqual(before);
  });

  it("11件以上のタグは拒否する", async () => {
    const { guide } = await setupAuthorWithGuide();
    const before = await findGuide(guide.id);
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);

    const res = await callAction(
      "my-guide",
      baseFormData({ _action: "publish", tags: JSON.stringify(tags) }),
    );

    expect(res).toEqual({ error: ERROR_TAGS_TOO_MANY });
    expect(await findGuide(guide.id)).toEqual(before);
  });

  it("51文字のタグは拒否する", async () => {
    const { guide } = await setupAuthorWithGuide();
    const before = await findGuide(guide.id);

    const res = await callAction(
      "my-guide",
      baseFormData({ _action: "publish", tags: JSON.stringify(["a".repeat(51)]) }),
    );

    expect(res).toEqual({ error: ERROR_TAG_TOO_LONG });
    expect(await findGuide(guide.id)).toEqual(before);
  });

  it("10件・50文字ちょうどは許可され、空白のみのタグは捨てられる", async () => {
    // 件数上限は trim/空要素の除去より前に判定されるため、空白要素も 10 件の枠を消費する
    const { guide } = await setupAuthorWithGuide();
    const kept = Array.from({ length: 8 }, (_, i) => `tag${i}`);
    const tags = [...kept, "a".repeat(50), "   "];

    const res = await callAction(
      "my-guide",
      baseFormData({ _action: "publish", tags: JSON.stringify(tags) }),
    );

    expect(res).toEqual({ success: true, mode: "publish", slug: "my-guide" });
    expect((await findGuide(guide.id)).tags).toBe(JSON.stringify([...kept, "a".repeat(50)]));
  });
});

describe("action - タイトル・概要の長さ検証", () => {
  it("201文字のタイトルは draft でも publish でも errorTitleTooLong を返し、ガイド行を変更しない", async () => {
    const { guide } = await setupAuthorWithGuide();
    const before = await findGuide(guide.id);
    const longTitle = "a".repeat(201);

    const draftRes = await callAction(
      "my-guide",
      baseFormData({ _action: "draft", title: longTitle }),
    );
    expect(draftRes).toEqual({ error: "タイトルは200文字以内で入力してください" });
    expect(await findGuide(guide.id)).toEqual(before);

    const publishRes = await callAction(
      "my-guide",
      baseFormData({ _action: "publish", title: longTitle }),
    );
    expect(publishRes).toEqual({ error: "タイトルは200文字以内で入力してください" });
    expect(await findGuide(guide.id)).toEqual(before);
  });

  it("501文字の概要は errorSummaryTooLong を返し、ガイド行を変更しない", async () => {
    const { guide } = await setupAuthorWithGuide();
    const before = await findGuide(guide.id);

    const res = await callAction(
      "my-guide",
      baseFormData({ _action: "publish", summary: "a".repeat(501) }),
    );

    expect(res).toEqual({ error: "概要は500文字以内で入力してください" });
    expect(await findGuide(guide.id)).toEqual(before);
  });
});

describe("action - スラッグと所有権", () => {
  it("同一著者内で既存スラッグと重複する場合は拒否し、ガイド行を変更しない", async () => {
    const { author, guide } = await setupAuthorWithGuide();
    await seedGuide(db, author.id, { slug: "taken-slug", title: "別のガイド" });
    const before = await findGuide(guide.id);

    const res = await callAction("my-guide", baseFormData({ _action: "publish", slug: "taken-slug" }));

    expect(res).toEqual({ error: ERROR_SLUG_TAKEN });
    expect(await findGuide(guide.id)).toEqual(before);
  });

  it("他の著者が同じスラッグを使っていても衝突しない（著者内でのみ一意）", async () => {
    const { guide } = await setupAuthorWithGuide();
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    await seedGuide(db, other.id, { slug: "shared-slug" });

    const res = await callAction("my-guide", baseFormData({ _action: "publish", slug: "shared-slug" }));

    expect(res).toEqual({ success: true, mode: "publish", slug: "shared-slug" });
    expect((await findGuide(guide.id)).slug).toBe("shared-slug");
  });

  it("正規化後に空になるスラッグは拒否し、ガイド行を変更しない", async () => {
    const { guide } = await setupAuthorWithGuide();
    const before = await findGuide(guide.id);

    const res = await callAction("my-guide", baseFormData({ _action: "draft", slug: "日本語のみ" }));

    expect(res).toEqual({ error: ERROR_SLUG_REQUIRED });
    expect(await findGuide(guide.id)).toEqual(before);
  });

  it("他人のガイドは編集できない（所有権エラーで対象行も不変）", async () => {
    const { guide } = await setupAuthorWithDraftedGuide();
    const before = await findGuide(guide.id);
    // 別ユーザーとしてログインし直し、著者のガイドスラッグを対象にする
    await seedUser(db, { slug: "intruder", discordId: "discord-intruder" });
    signInAs("discord-intruder");

    const res = await callAction(
      "my-guide",
      baseFormData({ _action: "publish", title: "乗っ取りタイトル" }),
    );

    expect(res).toEqual({ error: ERROR_NOT_FOUND });
    expect(await findGuide(guide.id)).toEqual(before);
  });
});
