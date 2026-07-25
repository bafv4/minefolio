import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  seedUser,
  seedGuide,
  seedSearchCraftTemplate,
  seedGuideLike,
  schema,
  type TestDb,
} from "./helpers/test-db";
import {
  likeGuide,
  unlikeGuide,
  likeTemplate,
  unlikeTemplate,
  setLike,
  getGuideLikeCount,
  getTemplateLikeCount,
  getGuideLikeCounts,
  getTemplateLikeCounts,
  getViewerLikedIds,
} from "../likes.server";

// いいねのサーバー層。可視性ルール（public+unlisted は可 / private は不可）、
// 自分の投稿の拒否、冪等性、cascade を実DB（in-memory libSQL）で検証する。

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

/** 著者・第三者・公開ガイドの一式を用意する */
async function setupGuide(authorOverrides: Record<string, unknown> = {}) {
  const author = await seedUser(db, { slug: "author", profileVisibility: "public", ...authorOverrides });
  const viewer = await seedUser(db, { slug: "viewer" });
  const guide = await seedGuide(db, author.id, { isPublished: true });
  return { author, viewer, guide };
}

async function countGuideLikeRows(guideId: string): Promise<number> {
  const rows = await db.query.guideLikes.findMany({
    where: eq(schema.guideLikes.guideId, guideId),
  });
  return rows.length;
}

describe("cascade（設計の前提: libSQL は外部キーを既定で有効にする）", () => {
  it("ガイドを削除するといいねも消える", async () => {
    const { viewer, guide } = await setupGuide();
    await seedGuideLike(db, viewer.id, guide.id);
    expect(await countGuideLikeRows(guide.id)).toBe(1);

    await db.delete(schema.guides).where(eq(schema.guides.id, guide.id));

    expect(await countGuideLikeRows(guide.id)).toBe(0);
  });

  it("いいねしたユーザーを削除するといいねも消え、件数が減る", async () => {
    const { viewer, guide } = await setupGuide();
    await seedGuideLike(db, viewer.id, guide.id);

    await db.delete(schema.users).where(eq(schema.users.id, viewer.id));

    expect(await getGuideLikeCount(db, guide.id)).toBe(0);
  });

  it("テンプレートを削除するといいねも消える", async () => {
    const owner = await seedUser(db, { slug: "owner" });
    const viewer = await seedUser(db, { slug: "viewer" });
    const template = await seedSearchCraftTemplate(db, owner.id);
    await likeTemplate(db, viewer.id, template.id);
    expect(await getTemplateLikeCount(db, template.id)).toBe(1);

    await db
      .delete(schema.searchCraftTemplates)
      .where(eq(schema.searchCraftTemplates.id, template.id));

    const rows = await db.query.searchCraftTemplateLikes.findMany();
    expect(rows).toHaveLength(0);
  });
});

describe("likeGuide / unlikeGuide", () => {
  it("いいね→件数1、解除→件数0", async () => {
    const { viewer, guide } = await setupGuide();

    const liked = await likeGuide(db, viewer.id, guide.id);
    expect(liked).toEqual({ ok: true, liked: true, count: 1 });

    const unliked = await unlikeGuide(db, viewer.id, guide.id);
    expect(unliked).toEqual({ ok: true, liked: false, count: 0 });
  });

  it("二重いいねは冪等（行は1件のまま）", async () => {
    const { viewer, guide } = await setupGuide();

    await likeGuide(db, viewer.id, guide.id);
    const second = await likeGuide(db, viewer.id, guide.id);

    expect(second).toEqual({ ok: true, liked: true, count: 1 });
    expect(await countGuideLikeRows(guide.id)).toBe(1);
  });

  it("いいねしていない状態で解除しても落ちない", async () => {
    const { viewer, guide } = await setupGuide();
    await expect(unlikeGuide(db, viewer.id, guide.id)).resolves.toEqual({
      ok: true,
      liked: false,
      count: 0,
    });
  });

  it("別ユーザーのいいねは加算される", async () => {
    const { viewer, guide } = await setupGuide();
    const other = await seedUser(db, { slug: "other" });

    await likeGuide(db, viewer.id, guide.id);
    await likeGuide(db, other.id, guide.id);

    expect(await getGuideLikeCount(db, guide.id)).toBe(2);
  });

  it("自分のガイドにはいいねできない（行も作られない）", async () => {
    const { author, guide } = await setupGuide();

    const result = await likeGuide(db, author.id, guide.id);

    expect(result).toEqual({ ok: false, reason: "self" });
    expect(await countGuideLikeRows(guide.id)).toBe(0);
  });

  it("未公開ガイドにはいいねできない", async () => {
    const author = await seedUser(db, { slug: "author" });
    const viewer = await seedUser(db, { slug: "viewer" });
    const draft = await seedGuide(db, author.id, { isPublished: false });

    const result = await likeGuide(db, viewer.id, draft.id);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(await countGuideLikeRows(draft.id)).toBe(0);
  });

  it("存在しないガイドは not_found（非公開著者と同じ結果＝列挙オラクルにしない）", async () => {
    const viewer = await seedUser(db, { slug: "viewer" });
    await expect(likeGuide(db, viewer.id, "no-such-guide")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("非公開（private）著者のガイドにはいいねできない", async () => {
    const { viewer, guide } = await setupGuide({ profileVisibility: "private" });

    const result = await likeGuide(db, viewer.id, guide.id);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(await countGuideLikeRows(guide.id)).toBe(0);
  });

  it("限定公開（unlisted）著者のガイドにはいいねできる（URL共有で閲覧可のため）", async () => {
    const { viewer, guide } = await setupGuide({ profileVisibility: "unlisted" });

    const result = await likeGuide(db, viewer.id, guide.id);

    expect(result).toEqual({ ok: true, liked: true, count: 1 });
  });

  it("非公開化された後でも自分のいいねは外せる", async () => {
    const { viewer, guide } = await setupGuide();
    await likeGuide(db, viewer.id, guide.id);

    await db
      .update(schema.guides)
      .set({ isPublished: false })
      .where(eq(schema.guides.id, guide.id));

    await expect(unlikeGuide(db, viewer.id, guide.id)).resolves.toEqual({
      ok: true,
      liked: false,
      count: 0,
    });
  });

  it("非公開→再公開でいいねは保持される", async () => {
    const { viewer, guide } = await setupGuide();
    await likeGuide(db, viewer.id, guide.id);

    await db.update(schema.guides).set({ isPublished: false }).where(eq(schema.guides.id, guide.id));
    await db.update(schema.guides).set({ isPublished: true }).where(eq(schema.guides.id, guide.id));

    expect(await getGuideLikeCount(db, guide.id)).toBe(1);
  });

  it("いいねしたユーザーが後から非公開・viewer になっても件数は変わらない", async () => {
    const { viewer, guide } = await setupGuide();
    await likeGuide(db, viewer.id, guide.id);

    await db
      .update(schema.users)
      .set({ profileVisibility: "private", role: "viewer" })
      .where(eq(schema.users.id, viewer.id));

    expect(await getGuideLikeCount(db, guide.id)).toBe(1);
  });
});

describe("likeTemplate / unlikeTemplate", () => {
  it("いいね→解除の往復", async () => {
    const owner = await seedUser(db, { slug: "owner" });
    const viewer = await seedUser(db, { slug: "viewer" });
    const template = await seedSearchCraftTemplate(db, owner.id);

    expect(await likeTemplate(db, viewer.id, template.id)).toEqual({
      ok: true,
      liked: true,
      count: 1,
    });
    expect(await unlikeTemplate(db, viewer.id, template.id)).toEqual({
      ok: true,
      liked: false,
      count: 0,
    });
  });

  it("自分のテンプレートにはいいねできない（所有者列が userId であることの回帰）", async () => {
    const owner = await seedUser(db, { slug: "owner" });
    const template = await seedSearchCraftTemplate(db, owner.id);

    expect(await likeTemplate(db, owner.id, template.id)).toEqual({
      ok: false,
      reason: "self",
    });
    expect(await getTemplateLikeCount(db, template.id)).toBe(0);
  });

  it("未公開テンプレート・非公開著者は not_found", async () => {
    const owner = await seedUser(db, { slug: "owner" });
    const privateOwner = await seedUser(db, { slug: "priv", profileVisibility: "private" });
    const viewer = await seedUser(db, { slug: "viewer" });
    const unpublished = await seedSearchCraftTemplate(db, owner.id, { isPublished: false });
    const byPrivate = await seedSearchCraftTemplate(db, privateOwner.id);

    expect(await likeTemplate(db, viewer.id, unpublished.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await likeTemplate(db, viewer.id, byPrivate.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("対象種別の分離", () => {
  it("同じ id 文字列でもガイドとテンプレートのいいねは混ざらない", async () => {
    const owner = await seedUser(db, { slug: "owner" });
    const viewer = await seedUser(db, { slug: "viewer" });
    // 同一の id を持つガイドとテンプレートを用意する
    const sharedId = "shared-id-0001";
    const guide = await seedGuide(db, owner.id, { id: sharedId });
    const template = await seedSearchCraftTemplate(db, owner.id, { id: sharedId });

    await likeTemplate(db, viewer.id, template.id);

    expect(await getTemplateLikeCount(db, sharedId)).toBe(1);
    expect(await getGuideLikeCount(db, guide.id)).toBe(0);
  });
});

describe("getViewerLikedIds", () => {
  it("自分のいいねだけを返し、他人のいいねは含まない", async () => {
    const owner = await seedUser(db, { slug: "owner" });
    const me = await seedUser(db, { slug: "me" });
    const other = await seedUser(db, { slug: "other" });
    const guide = await seedGuide(db, owner.id);
    const otherGuide = await seedGuide(db, owner.id, { slug: "g2" });
    const template = await seedSearchCraftTemplate(db, owner.id);

    await likeGuide(db, me.id, guide.id);
    await likeTemplate(db, me.id, template.id);
    await likeGuide(db, other.id, otherGuide.id);

    const mine = await getViewerLikedIds(db, me.id);
    expect(mine.guideIds).toEqual([guide.id]);
    expect(mine.templateIds).toEqual([template.id]);
  });

  it("未ログイン（null）は空を返す", async () => {
    await expect(getViewerLikedIds(db, null)).resolves.toEqual({
      guideIds: [],
      templateIds: [],
    });
  });
});

describe("件数のバッチ取得", () => {
  it("いいね0件の id はマップに含まれない（呼び出し側で ?? 0）", async () => {
    const owner = await seedUser(db, { slug: "owner" });
    const viewer = await seedUser(db, { slug: "viewer" });
    const liked = await seedGuide(db, owner.id, { slug: "liked" });
    const unliked = await seedGuide(db, owner.id, { slug: "unliked" });
    await likeGuide(db, viewer.id, liked.id);

    const counts = await getGuideLikeCounts(db, [liked.id, unliked.id]);

    expect(counts.get(liked.id)).toBe(1);
    expect(counts.has(unliked.id)).toBe(false);
  });

  it("空配列は空のマップ（SQLを発行しない）", async () => {
    await expect(getGuideLikeCounts(db, [])).resolves.toEqual(new Map());
    await expect(getTemplateLikeCounts(db, [])).resolves.toEqual(new Map());
  });
});

describe("setLike ディスパッチャ", () => {
  it("targetType に応じて正しいテーブルを操作する", async () => {
    const owner = await seedUser(db, { slug: "owner" });
    const viewer = await seedUser(db, { slug: "viewer" });
    const guide = await seedGuide(db, owner.id);
    const template = await seedSearchCraftTemplate(db, owner.id);

    await setLike(db, viewer.id, "guide", guide.id, true);
    await setLike(db, viewer.id, "template", template.id, true);

    expect(await getGuideLikeCount(db, guide.id)).toBe(1);
    expect(await getTemplateLikeCount(db, template.id)).toBe(1);

    await setLike(db, viewer.id, "guide", guide.id, false);
    expect(await getGuideLikeCount(db, guide.id)).toBe(0);
  });
});
