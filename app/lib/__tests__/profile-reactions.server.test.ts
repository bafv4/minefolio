import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, schema, type TestDb } from "./helpers/test-db";
import {
  getProfileReactionCounts,
  getViewerProfileReactions,
  setProfileReaction,
} from "../profile-reactions.server";
import { PROFILE_REACTION_EMOJIS } from "../profile-reactions";

// プロフィール絵文字リアクションのサーバー層。likes.server.test.ts の相似形だが、
// self 許可・private 本人可・3列ユニークキー・整列順など likes と異なる点を重点的に検証する。

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

async function countReactionRows(profileUserId: string): Promise<number> {
  const rows = await db.query.profileReactions.findMany({
    where: eq(schema.profileReactions.profileUserId, profileUserId),
  });
  return rows.length;
}

describe("getProfileReactionCounts", () => {
  it("リアクションが無ければ空配列", async () => {
    const profile = await seedUser(db, { slug: "profile" });

    expect(await getProfileReactionCounts(db, profile.id)).toEqual([]);
  });

  it("複数ユーザー×複数絵文字を絵文字ごとに正しく集計する", async () => {
    const profile = await seedUser(db, { slug: "profile" });
    const viewer1 = await seedUser(db, { slug: "viewer1" });
    const viewer2 = await seedUser(db, { slug: "viewer2" });

    await setProfileReaction(db, viewer1.id, profile.id, "👍", true);
    await setProfileReaction(db, viewer2.id, profile.id, "👍", true);
    await setProfileReaction(db, viewer1.id, profile.id, "❤️", true);

    const counts = await getProfileReactionCounts(db, profile.id);
    const byEmoji = new Map(counts.map((c) => [c.emoji, c.count]));
    expect(byEmoji.get("👍")).toBe(2);
    expect(byEmoji.get("❤️")).toBe(1);
    expect(counts).toHaveLength(2);
  });

  it("返却順は PROFILE_REACTION_EMOJIS の並び順（カウント数順ではない）", async () => {
    const profile = await seedUser(db, { slug: "profile" });
    const viewer1 = await seedUser(db, { slug: "viewer1" });
    const viewer2 = await seedUser(db, { slug: "viewer2" });
    const viewer3 = await seedUser(db, { slug: "viewer3" });

    // 挿入順を PROFILE_REACTION_EMOJIS と逆にしても、返却順は固定順になることを確認する
    await setProfileReaction(db, viewer1.id, profile.id, "💯", true);
    await setProfileReaction(db, viewer2.id, profile.id, "🔥", true);
    await setProfileReaction(db, viewer3.id, profile.id, "👍", true);

    const counts = await getProfileReactionCounts(db, profile.id);

    expect(counts.map((c) => c.emoji)).toEqual(
      PROFILE_REACTION_EMOJIS.filter((emoji): emoji is "👍" | "🔥" | "💯" =>
        (["👍", "🔥", "💯"] as const).includes(emoji as never),
      ),
    );
  });

  it("許可リスト外の遺物行（DB直接insert）は除外される", async () => {
    const profile = await seedUser(db, { slug: "profile" });
    const viewer = await seedUser(db, { slug: "viewer" });
    await db.insert(schema.profileReactions).values({
      profileUserId: profile.id,
      reactorUserId: viewer.id,
      emoji: "😈",
    });

    expect(await getProfileReactionCounts(db, profile.id)).toEqual([]);
  });
});

describe("getViewerProfileReactions", () => {
  it("viewerUserId が null なら SQL を発行せず空配列", async () => {
    const profile = await seedUser(db, { slug: "profile" });

    expect(await getViewerProfileReactions(db, profile.id, null)).toEqual([]);
  });

  it("自分の押下のみ返り、他人の押下は含まない", async () => {
    const profile = await seedUser(db, { slug: "profile" });
    const me = await seedUser(db, { slug: "me" });
    const other = await seedUser(db, { slug: "other" });

    await setProfileReaction(db, me.id, profile.id, "👍", true);
    await setProfileReaction(db, other.id, profile.id, "❤️", true);

    expect(await getViewerProfileReactions(db, profile.id, me.id)).toEqual(["👍"]);
  });
});

describe("setProfileReaction 追加（react）", () => {
  it("同じ絵文字を二重に押しても冪等（行は1件のまま・count 1）", async () => {
    const profile = await seedUser(db, { slug: "profile" });
    const viewer = await seedUser(db, { slug: "viewer" });

    const first = await setProfileReaction(db, viewer.id, profile.id, "👍", true);
    const second = await setProfileReaction(db, viewer.id, profile.id, "👍", true);

    expect(first).toEqual({ ok: true, reacted: true, count: 1 });
    expect(second).toEqual({ ok: true, reacted: true, count: 1 });
    expect(await countReactionRows(profile.id)).toBe(1);
  });

  it("自分の public プロフィールにも押せる（self 拒否なし）", async () => {
    const profile = await seedUser(db, { slug: "profile", profileVisibility: "public" });

    const result = await setProfileReaction(db, profile.id, profile.id, "🔥", true);

    expect(result).toEqual({ ok: true, reacted: true, count: 1 });
  });

  it("private な自分のプロフィールにも本人は押せる", async () => {
    const profile = await seedUser(db, { slug: "profile", profileVisibility: "private" });

    const result = await setProfileReaction(db, profile.id, profile.id, "🎉", true);

    expect(result).toEqual({ ok: true, reacted: true, count: 1 });
  });

  it("private な他人のプロフィールには押せない（not_found）", async () => {
    const profile = await seedUser(db, { slug: "profile", profileVisibility: "private" });
    const viewer = await seedUser(db, { slug: "viewer" });

    const result = await setProfileReaction(db, viewer.id, profile.id, "😢", true);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(await countReactionRows(profile.id)).toBe(0);
  });

  it("unlisted な他人のプロフィールには押せる（URL共有で閲覧可のため）", async () => {
    const profile = await seedUser(db, { slug: "profile", profileVisibility: "unlisted" });
    const viewer = await seedUser(db, { slug: "viewer" });

    const result = await setProfileReaction(db, viewer.id, profile.id, "😮", true);

    expect(result).toEqual({ ok: true, reacted: true, count: 1 });
  });

  it("存在しないプロフィールは not_found", async () => {
    const viewer = await seedUser(db, { slug: "viewer" });

    const result = await setProfileReaction(db, viewer.id, "no-such-user", "😂", true);

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("setProfileReaction 解除（unreact）", () => {
  it("押していない状態で解除しても落ちない（冪等）", async () => {
    const profile = await seedUser(db, { slug: "profile" });
    const viewer = await seedUser(db, { slug: "viewer" });

    const result = await setProfileReaction(db, viewer.id, profile.id, "👍", false);

    expect(result).toEqual({ ok: true, reacted: false, count: 0 });
  });

  it("非公開化された後でも自分のリアクションは無検査で解除できる", async () => {
    const profile = await seedUser(db, { slug: "profile", profileVisibility: "public" });
    const viewer = await seedUser(db, { slug: "viewer" });
    await setProfileReaction(db, viewer.id, profile.id, "👍", true);

    await db
      .update(schema.users)
      .set({ profileVisibility: "private" })
      .where(eq(schema.users.id, profile.id));

    const result = await setProfileReaction(db, viewer.id, profile.id, "👍", false);

    expect(result).toEqual({ ok: true, reacted: false, count: 0 });
    expect(await countReactionRows(profile.id)).toBe(0);
  });
});

describe("count の絵文字ごとの独立性", () => {
  it("👍2件・❤️1件の状態でそれぞれの count が正しい", async () => {
    const profile = await seedUser(db, { slug: "profile" });
    const viewer1 = await seedUser(db, { slug: "viewer1" });
    const viewer2 = await seedUser(db, { slug: "viewer2" });

    await setProfileReaction(db, viewer1.id, profile.id, "👍", true);
    const thumbsUp = await setProfileReaction(db, viewer2.id, profile.id, "👍", true);
    const heart = await setProfileReaction(db, viewer1.id, profile.id, "❤️", true);

    expect(thumbsUp).toEqual({ ok: true, reacted: true, count: 2 });
    expect(heart).toEqual({ ok: true, reacted: true, count: 1 });
  });
});
