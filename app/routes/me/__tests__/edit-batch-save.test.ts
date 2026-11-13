// /me/edit の「保存バーでの一括保存」（_action=save_all + changes JSON）の統合テスト。
// 本体は app/lib/profile-edit.server.ts。MCID・リンク・動画の差分を1リクエスト・1トランザクションで保存すること、
// 検証・Mojang 照合に失敗したら DB が1行も変わらないこと、speedrun.com リンクの優先規則を検証する。
//
// セッション/Mojang/targeted-refresh のモック方針は edit-targeted-refresh.test.ts と同じ。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq, asc } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  schema,
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

const mojangMocks = vi.hoisted(() => ({
  fetchUuidFromMcid: vi.fn(),
}));
vi.mock("@/lib/mojang", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mojang")>();
  return {
    ...actual,
    fetchUuidFromMcid: mojangMocks.fetchUuidFromMcid,
  };
});

const targetedRefreshMocks = vi.hoisted(() => ({
  runAfterResponse: vi.fn(),
  refreshTwitchVodsForLogin: vi.fn().mockResolvedValue(undefined),
  deleteTwitchVodsForLogin: vi.fn().mockResolvedValue(undefined),
  refreshYoutubeForChannel: vi.fn().mockResolvedValue(undefined),
  deleteYoutubeVideosForChannelIdentifier: vi.fn().mockResolvedValue(undefined),
  updateYoutubeCacheMcid: vi.fn().mockResolvedValue(undefined),
  refreshSrcRankingsForUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/targeted-refresh.server", () => targetedRefreshMocks);

import { action } from "../edit";
import { MojangError } from "@/lib/mojang";
import type { ProfileChanges } from "@/lib/profile-edit-validation";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

async function callAction(formData: FormData) {
  const request = new Request("https://minefolio.app/me/edit", { method: "POST", body: formData });
  return action({ request, params: {}, context: {} } as never);
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

/** 一括保存の FormData（有効なプロフィール値一式 + changes）。overrides でプロフィール値を上書きできる */
function saveAllForm(changes: ProfileChanges | null, overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    _action: "save_all",
    displayName: "Runner",
    profileVisibility: "public",
    profilePose: "waving",
    slimSkin: "false",
    showPacemanOnHome: "true",
    showTwitchOnHome: "true",
    showYoutubeOnHome: "true",
    showRankedStats: "true",
    showPacemanStats: "true",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) fd.set(k, v);
  if (changes) fd.set("changes", JSON.stringify(changes));
  return fd;
}

async function userRow(id: string) {
  return db.query.users.findFirst({ where: eq(schema.users.id, id) });
}
async function linksOf(userId: string) {
  return db.query.socialLinks.findMany({ where: eq(schema.socialLinks.userId, userId) });
}
async function videosOf(userId: string) {
  return db.query.profileVideos.findMany({
    where: eq(schema.profileVideos.userId, userId),
    orderBy: [asc(schema.profileVideos.displayOrder)],
  });
}
async function seedVideo(userId: string, id: string, order: number, url = `https://youtu.be/${id}aaaaaaa`) {
  await db.insert(schema.profileVideos).values({ id, userId, url, title: id, isPinned: false, displayOrder: order });
}

const YT = (id: string) => `https://www.youtube.com/watch?v=${id}`;

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

describe("save_all - 全セクションの一括保存", () => {
  it("MCID・Bedrock・リンク・動画の差分とプロフィール列を1リクエストで保存する", async () => {
    const user = await seedUser(db, { slug: "old-slug", discordId: "d-all", mcid: "OldMcid" });
    await db.insert(schema.socialLinks).values({ id: "l-old", userId: user.id, platform: "twitch", identifier: "oldtw" });
    await db.insert(schema.socialLinks).values({ id: "l-del", userId: user.id, platform: "twitter", identifier: "gone" });
    await seedVideo(user.id, "v1", 0);
    await seedVideo(user.id, "v2", 1);
    signInAs("d-all");
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("11111111-1111-1111-1111-111111111111");

    const res = await callAction(
      saveAllForm({
        mcid: { op: "set", value: "NewMcid" },
        bedrockMcid: { op: "set", value: "BedrockTag" },
        links: {
          create: [{ key: "new-a", platform: "youtube", identifier: "newyt", customLabel: null, customUrl: null }],
          update: [{ id: "l-old", platform: "twitch", identifier: "newtw", customLabel: null, customUrl: null }],
          delete: ["l-del"],
        },
        videos: {
          create: [{ key: "new-v", url: YT("abcdefghijk"), title: "New", isPinned: true }],
          update: [{ id: "v1", url: YT("bbbbbbbbbbb"), title: "Edited", isPinned: false }],
          order: ["v2", "new:new-v", "v1"],
        },
      }),
    );

    expect(res).toEqual({ success: true, action: "profile", newSlug: "NewMcid" });

    const after = await userRow(user.id);
    expect(after?.mcid).toBe("NewMcid");
    expect(after?.uuid).toBe("11111111-1111-1111-1111-111111111111");
    expect(after?.slug).toBe("NewMcid");
    expect(after?.bedrockMcid).toBe("BedrockTag");
    expect(after?.displayName).toBe("Runner");

    const links = await linksOf(user.id);
    expect(links.map((l) => `${l.platform}:${l.identifier}`).sort()).toEqual(["twitch:newtw", "youtube:newyt"]);

    const videos = await videosOf(user.id);
    expect(videos.map((v) => v.id === "v1" || v.id === "v2" ? v.id : "new")).toEqual(["v2", "new", "v1"]);
    expect(videos.map((v) => v.displayOrder)).toEqual([0, 1, 2]);
    expect(videos.find((v) => v.id === "v1")?.title).toBe("Edited");
    expect(videos.find((v) => v.id !== "v1" && v.id !== "v2")?.isPinned).toBe(true);

    // slug 変更の履歴（commit 後に旧slugへの参照が残る）
    const history = await db.query.slugHistory.findFirst({ where: eq(schema.slugHistory.slug, "old-slug") });
    expect(history?.userId).toBe(user.id);
  });

  it("changes が無い・空でも、プロフィール列だけ従来どおり保存できる（後方互換）", async () => {
    const user = await seedUser(db, { discordId: "d-plain" });
    signInAs("d-plain");

    const fd = saveAllForm(null, { displayName: "Renamed" });
    fd.delete("_action");
    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "profile" });
    expect((await userRow(user.id))?.displayName).toBe("Renamed");
  });

  it("MCID の削除は slug を @discordId 形式へ戻し、旧slugを履歴へ記録する", async () => {
    const user = await seedUser(db, { slug: "McidSlug", discordId: "d-rm", mcid: "McidSlug", uuid: "u" });
    signInAs("d-rm");

    const res = await callAction(saveAllForm({ mcid: { op: "remove" } }));

    expect(res).toMatchObject({ success: true, action: "profile" });
    const after = await userRow(user.id);
    expect(after?.mcid).toBeNull();
    expect(after?.uuid).toBeNull();
    expect(after?.slug).not.toBe("McidSlug");
    expect((await db.query.slugHistory.findFirst({ where: eq(schema.slugHistory.slug, "mcidslug") }))?.userId).toBe(user.id);
  });

  it("現在と同じ MCID の set は何もしない（Mojang も呼ばない）", async () => {
    const user = await seedUser(db, { slug: "Same", discordId: "d-same", mcid: "Same" });
    signInAs("d-same");

    const res = await callAction(saveAllForm({ mcid: { op: "set", value: "Same" } }));

    expect(res).toEqual({ success: true, action: "profile" });
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
    expect((await userRow(user.id))?.slug).toBe("Same");
  });
});

describe("save_all - 検証エラー時は DB を1行も変えない", () => {
  it("Mojang 照合で MCID が見つからない: fieldErrors.mcid を返し、他の変更も保存されない", async () => {
    const user = await seedUser(db, { slug: "keep", discordId: "d-nf", mcid: "Keep", displayName: "Before" });
    signInAs("d-nf");
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(new MojangError("MCID_NOT_FOUND", "nf"));

    const res = await callAction(
      saveAllForm(
        {
          mcid: { op: "set", value: "Ghost" },
          links: { create: [{ key: "k", platform: "twitter", identifier: "tw", customLabel: null, customUrl: null }] },
        },
        { displayName: "After" },
      ),
    );

    expect(res).toMatchObject({ error: expect.any(String), fieldErrors: { mcid: expect.any(String) } });
    expect("success" in res && res.success).toBeFalsy();
    const after = await userRow(user.id);
    expect(after?.mcid).toBe("Keep");
    expect(after?.slug).toBe("keep");
    expect(after?.displayName).toBe("Before");
    expect(await linksOf(user.id)).toHaveLength(0);
  });

  it("Mojang API 障害（照合失敗）でも保存されず、再試行できる形で fieldErrors.mcid を返す", async () => {
    const user = await seedUser(db, { discordId: "d-api", displayName: "Before" });
    signInAs("d-api");
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(new MojangError("API_ERROR", "down"));

    const res = await callAction(saveAllForm({ mcid: { op: "set", value: "SomeOne" } }, { displayName: "After" }));

    expect(res).toMatchObject({ fieldErrors: { mcid: expect.any(String) } });
    expect((await userRow(user.id))?.displayName).toBe("Before");
  });

  it("他ユーザーが使用中の MCID は mcidTaken（Mojang は呼ばない）", async () => {
    await seedUser(db, { discordId: "d-other", mcid: "Taken", slug: "Taken" });
    const user = await seedUser(db, { discordId: "d-me", displayName: "Before" });
    signInAs("d-me");

    const res = await callAction(saveAllForm({ mcid: { op: "set", value: "Taken" } }, { displayName: "After" }));

    expect(res).toMatchObject({ fieldErrors: { mcid: expect.any(String) } });
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
    expect((await userRow(user.id))?.displayName).toBe("Before");
  });

  it("リンクの形式エラーは行ごとの fieldErrors（キー付き）で返り、何も保存されない", async () => {
    const user = await seedUser(db, { discordId: "d-lerr", displayName: "Before" });
    signInAs("d-lerr");

    const res = await callAction(
      saveAllForm(
        {
          links: {
            create: [
              { key: "ok", platform: "twitter", identifier: "fine", customLabel: null, customUrl: null },
              { key: "bad", platform: "twitter", identifier: "has space", customLabel: null, customUrl: null },
            ],
          },
        },
        { displayName: "After" },
      ),
    );

    expect(res).toMatchObject({ fieldErrors: { links: { bad: expect.any(String) } } });
    expect("fieldErrors" in res && res.fieldErrors?.links?.ok).toBeUndefined();
    expect(await linksOf(user.id)).toHaveLength(0);
    expect((await userRow(user.id))?.displayName).toBe("Before");
  });

  it("カスタムリンクの javascript: URL は拒否される", async () => {
    const user = await seedUser(db, { discordId: "d-xss" });
    signInAs("d-xss");

    const res = await callAction(
      saveAllForm({
        links: {
          create: [
            { key: "x", platform: "custom", identifier: "id", customLabel: "L", customUrl: "javascript:alert(1)" },
          ],
        },
      }),
    );

    expect(res).toMatchObject({ fieldErrors: { links: { x: expect.any(String) } } });
    expect(await linksOf(user.id)).toHaveLength(0);
  });

  it("動画: 解決できないURLは行ごとのエラー、10件を超える追加は全体エラーで保存されない", async () => {
    const user = await seedUser(db, { discordId: "d-verr" });
    for (let i = 0; i < 9; i++) await seedVideo(user.id, `s${i}`, i);
    signInAs("d-verr");

    const bad = await callAction(
      saveAllForm({ videos: { create: [{ key: "b", url: "https://example.com/x", title: null, isPinned: false }] } }),
    );
    expect(bad).toMatchObject({ fieldErrors: { videos: { b: expect.any(String) } } });

    const tooMany = await callAction(
      saveAllForm({
        videos: {
          create: [
            { key: "a", url: YT("aaaaaaaaaaa"), title: null, isPinned: false },
            { key: "b", url: YT("bbbbbbbbbbb"), title: null, isPinned: false },
          ],
        },
      }),
    );
    expect(tooMany).toMatchObject({ error: expect.any(String) });
    expect(await videosOf(user.id)).toHaveLength(9);
  });

  it("削除と同じ保存でなら、同一プラットフォームの入れ替えは通る。最終状態で重複するなら拒否する", async () => {
    const user = await seedUser(db, { discordId: "d-dup" });
    await db.insert(schema.socialLinks).values({ id: "l1", userId: user.id, platform: "twitch", identifier: "old" });
    signInAs("d-dup");

    const swap = await callAction(
      saveAllForm({
        links: {
          delete: ["l1"],
          create: [{ key: "n", platform: "twitch", identifier: "new", customLabel: null, customUrl: null }],
        },
      }),
    );
    expect(swap).toMatchObject({ success: true });
    expect((await linksOf(user.id)).map((l) => l.identifier)).toEqual(["new"]);

    const dup = await callAction(
      saveAllForm({
        links: { create: [{ key: "d", platform: "twitch", identifier: "another", customLabel: null, customUrl: null }] },
      }),
    );
    expect(dup).toMatchObject({ fieldErrors: { links: { d: expect.any(String) } } });
    expect(await linksOf(user.id)).toHaveLength(1);
  });

  it("他ユーザーのリンク/動画 id は更新も削除もできない（IDOR）", async () => {
    const owner = await seedUser(db, { discordId: "d-owner" });
    await db.insert(schema.socialLinks).values({ id: "foreign-l", userId: owner.id, platform: "twitter", identifier: "owner" });
    await seedVideo(owner.id, "foreign-v", 0);
    const me = await seedUser(db, { discordId: "d-attacker" });
    signInAs("d-attacker");

    const update = await callAction(
      saveAllForm({
        links: { update: [{ id: "foreign-l", platform: "twitter", identifier: "hacked", customLabel: null, customUrl: null }] },
      }),
    );
    expect(update).toMatchObject({ fieldErrors: { links: { "foreign-l": expect.any(String) } } });

    await callAction(saveAllForm({ links: { delete: ["foreign-l"] }, videos: { delete: ["foreign-v"] } }));
    expect((await linksOf(owner.id))[0]?.identifier).toBe("owner");
    expect(await videosOf(owner.id)).toHaveLength(1);
    expect(await linksOf(me.id)).toHaveLength(0);
  });

  it("changes が不正な JSON / スキーマ不一致なら何も保存せずエラー", async () => {
    const user = await seedUser(db, { discordId: "d-badjson", displayName: "Before" });
    signInAs("d-badjson");

    const fd = saveAllForm(null, { displayName: "After" });
    fd.set("changes", "{not json");
    expect(await callAction(fd)).toMatchObject({ error: expect.any(String) });

    const fd2 = saveAllForm(null, { displayName: "After" });
    fd2.set("changes", JSON.stringify({ links: { delete: "nope" } }));
    expect(await callAction(fd2)).toMatchObject({ error: expect.any(String) });

    expect((await userRow(user.id))?.displayName).toBe("Before");
  });
});

describe("save_all - 動画の並び", () => {
  it("並び替えのみ: order で displayOrder を振り直し、order に無い既存は元の順で後ろへ", async () => {
    const user = await seedUser(db, { discordId: "d-order" });
    await seedVideo(user.id, "a", 0);
    await seedVideo(user.id, "b", 1);
    await seedVideo(user.id, "c", 2);
    signInAs("d-order");

    await callAction(saveAllForm({ videos: { order: ["c", "a"] } }));

    expect((await videosOf(user.id)).map((v) => v.id)).toEqual(["c", "a", "b"]);
  });

  it("削除した動画を含まず詰めて振り直す", async () => {
    const user = await seedUser(db, { discordId: "d-orderdel" });
    await seedVideo(user.id, "a", 0);
    await seedVideo(user.id, "b", 1);
    await seedVideo(user.id, "c", 2);
    signInAs("d-orderdel");

    await callAction(saveAllForm({ videos: { delete: ["a"], order: ["c", "b"] } }));

    const videos = await videosOf(user.id);
    expect(videos.map((v) => [v.id, v.displayOrder])).toEqual([["c", 0], ["b", 1]]);
  });
});

describe("save_all - speedruncomUsername の優先規則（リンクの変更を優先）", () => {
  it("同じ保存に speedrun.com リンクの作成があれば、フォームの値ではなくリンクから列を決める", async () => {
    const user = await seedUser(db, { discordId: "d-sr1" });
    signInAs("d-sr1");

    await callAction(
      saveAllForm(
        { links: { create: [{ key: "s", platform: "speedruncom", identifier: "FromLink", customLabel: null, customUrl: null }] } },
        { speedruncomUsername: "FromForm" },
      ),
    );

    expect((await userRow(user.id))?.speedruncomUsername).toBe("FromLink");
    expect((await linksOf(user.id)).map((l) => l.identifier)).toEqual(["FromLink"]);
  });

  it("speedrun.com リンクの削除があれば、フォームに値が残っていても列は null になりリンクも復活しない", async () => {
    const user = await seedUser(db, { discordId: "d-sr2", speedruncomUsername: "Old" });
    await db.insert(schema.socialLinks).values({ id: "sr", userId: user.id, platform: "speedruncom", identifier: "Old" });
    signInAs("d-sr2");

    await callAction(saveAllForm({ links: { delete: ["sr"] } }, { speedruncomUsername: "Old" }));

    expect((await userRow(user.id))?.speedruncomUsername).toBeNull();
    expect(await linksOf(user.id)).toHaveLength(0);
  });

  it("speedrun.com リンクの更新（identifier 変更）は列とリンクの両方がリンクの値になる", async () => {
    const user = await seedUser(db, { discordId: "d-sr3", speedruncomUsername: "Old", speedruncomId: "resolved" });
    await db.insert(schema.socialLinks).values({ id: "sr", userId: user.id, platform: "speedruncom", identifier: "Old" });
    signInAs("d-sr3");

    await callAction(
      saveAllForm(
        { links: { update: [{ id: "sr", platform: "speedruncom", identifier: "New", customLabel: null, customUrl: null }] } },
        { speedruncomUsername: "Old" },
      ),
    );

    const after = await userRow(user.id);
    expect(after?.speedruncomUsername).toBe("New");
    expect(after?.speedruncomId).toBeNull();
    expect((await linksOf(user.id))[0]?.identifier).toBe("New");
  });

  it("speedrun.com に関わらないリンクの変更だけなら、フォームの値を使い social_links へ逆方向同期する", async () => {
    const user = await seedUser(db, { discordId: "d-sr4" });
    signInAs("d-sr4");

    await callAction(
      saveAllForm(
        { links: { create: [{ key: "t", platform: "twitter", identifier: "tw", customLabel: null, customUrl: null }] } },
        { speedruncomUsername: "FromForm" },
      ),
    );

    expect((await userRow(user.id))?.speedruncomUsername).toBe("FromForm");
    expect((await linksOf(user.id)).map((l) => `${l.platform}:${l.identifier}`).sort()).toEqual([
      "speedruncom:FromForm",
      "twitter:tw",
    ]);
  });
});

describe("save_all - commit 後の外部キャッシュキック", () => {
  it("検証エラーで保存されなかったときは一切キックしない", async () => {
    await seedUser(db, { discordId: "d-nokick", mcid: "Has" });
    signInAs("d-nokick");
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(new MojangError("MCID_NOT_FOUND", "nf"));

    await callAction(
      saveAllForm({
        mcid: { op: "set", value: "Ghost" },
        links: { create: [{ key: "k", platform: "twitch", identifier: "tw", customLabel: null, customUrl: null }] },
      }),
    );

    expect(targetedRefreshMocks.refreshTwitchVodsForLogin).not.toHaveBeenCalled();
    expect(targetedRefreshMocks.updateYoutubeCacheMcid).not.toHaveBeenCalled();
  });

  it("リンク作成・更新・削除と MCID 変更に対応するキックだけが走る", async () => {
    const user = await seedUser(db, { discordId: "d-kick", mcid: "OldM", slug: "OldM" });
    await db.insert(schema.socialLinks).values({ id: "tw", userId: user.id, platform: "twitch", identifier: "gone" });
    signInAs("d-kick");
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("22222222-2222-2222-2222-222222222222");

    await callAction(
      saveAllForm({
        mcid: { op: "set", value: "NewM" },
        links: {
          create: [{ key: "y", platform: "youtube", identifier: "ytchan", customLabel: null, customUrl: null }],
          delete: ["tw"],
        },
      }),
    );

    expect(targetedRefreshMocks.deleteTwitchVodsForLogin).toHaveBeenCalledWith("gone");
    // 新MCID で YouTube を取得する（mcid 変更後の値を使う）
    expect(targetedRefreshMocks.refreshYoutubeForChannel).toHaveBeenCalledWith("ytchan", "NewM");
    await vi.waitFor(() => expect(targetedRefreshMocks.updateYoutubeCacheMcid).toHaveBeenCalledWith("OldM", "NewM"));
    expect(targetedRefreshMocks.refreshSrcRankingsForUser).not.toHaveBeenCalled();
  });
});

describe("save_all - レビュー指摘の回帰", () => {
  it("大文字小文字違いで uuid が他ユーザーと衝突する MCID は mcidTaken（DB の UNIQUE 違反にしない）", async () => {
    await seedUser(db, { discordId: "d-uo", mcid: "Notch", slug: "Notch", uuid: "uuid-notch" });
    const me = await seedUser(db, { discordId: "d-uc", displayName: "Before" });
    signInAs("d-uc");
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("uuid-notch");

    const res = await callAction(saveAllForm({ mcid: { op: "set", value: "NOTCH" } }, { displayName: "After" }));

    expect(res).toMatchObject({ fieldErrors: { mcid: expect.any(String) } });
    const after = await userRow(me.id);
    expect(after?.mcid).toBeNull();
    expect(after?.displayName).toBe("Before");
  });

  it("動画の削除 id を重複して送っても、10 件上限をすり抜けられない", async () => {
    const user = await seedUser(db, { discordId: "d-dupdel" });
    for (let i = 0; i < 10; i++) await seedVideo(user.id, `s${i}`, i);
    signInAs("d-dupdel");

    const res = await callAction(
      saveAllForm({
        videos: {
          delete: ["s0", "s0"],
          create: [
            { key: "a", url: YT("aaaaaaaaaaa"), title: null, isPinned: false },
            { key: "b", url: YT("bbbbbbbbbbb"), title: null, isPinned: false },
          ],
        },
      }),
    );

    expect(res).toMatchObject({ error: expect.any(String) });
    expect(await videosOf(user.id)).toHaveLength(10);
  });

  it("同じ保存で同じリンクを削除して作り直しても、削除キックは走らず refresh だけが走る", async () => {
    const user = await seedUser(db, { discordId: "d-recreate" });
    await db.insert(schema.socialLinks).values({ id: "tw", userId: user.id, platform: "twitch", identifier: "SameName" });
    signInAs("d-recreate");

    await callAction(
      saveAllForm({
        links: {
          delete: ["tw"],
          create: [{ key: "n", platform: "twitch", identifier: "samename", customLabel: null, customUrl: null }],
        },
      }),
    );

    expect(targetedRefreshMocks.deleteTwitchVodsForLogin).not.toHaveBeenCalled();
    expect(targetedRefreshMocks.refreshTwitchVodsForLogin).toHaveBeenCalledWith("samename");
  });

  it("MCID 変更と YouTube リンク作成が同じ保存にあっても、YouTube の取得は1回だけ", async () => {
    const user = await seedUser(db, { discordId: "d-yt1", mcid: "OldM", slug: "OldM" });
    signInAs("d-yt1");
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("33333333-3333-3333-3333-333333333333");

    await callAction(
      saveAllForm({
        mcid: { op: "set", value: "NewM" },
        links: { create: [{ key: "y", platform: "youtube", identifier: "ytchan", customLabel: null, customUrl: null }] },
      }),
    );
    await vi.waitFor(() => expect(targetedRefreshMocks.updateYoutubeCacheMcid).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    expect(targetedRefreshMocks.refreshYoutubeForChannel).toHaveBeenCalledTimes(1);
    expect(user.id).toBeTruthy();
  });

  it("過去データで同じプラットフォームのリンクが重複・動画が上限超でも、プロフィール列だけの保存は通る", async () => {
    const user = await seedUser(db, { discordId: "d-legacy", displayName: "Before" });
    await db.insert(schema.socialLinks).values({ id: "t1", userId: user.id, platform: "twitch", identifier: "a" });
    await db.insert(schema.socialLinks).values({ id: "t2", userId: user.id, platform: "twitch", identifier: "b" });
    for (let i = 0; i < 11; i++) await seedVideo(user.id, `lv${i}`, i);
    signInAs("d-legacy");

    const res = await callAction(saveAllForm(null, { displayName: "After" }));

    expect(res).toMatchObject({ success: true });
    expect((await userRow(user.id))?.displayName).toBe("After");
  });

  it("重複が残るプラットフォームでも、今回触れたリンクが重複を作るならエラー", async () => {
    const user = await seedUser(db, { discordId: "d-legacy2" });
    await db.insert(schema.socialLinks).values({ id: "t1", userId: user.id, platform: "twitch", identifier: "a" });
    await db.insert(schema.socialLinks).values({ id: "t2", userId: user.id, platform: "twitch", identifier: "b" });
    signInAs("d-legacy2");

    const res = await callAction(
      saveAllForm({ links: { update: [{ id: "t1", platform: "twitch", identifier: "a2", customLabel: null, customUrl: null }] } }),
    );

    expect(res).toMatchObject({ fieldErrors: { links: { t1: expect.any(String) } } });
  });

  it("speedrun.com リンクから決まるユーザー名が50文字を超えるなら行エラー（列の上限）", async () => {
    const user = await seedUser(db, { discordId: "d-srlong" });
    signInAs("d-srlong");

    const res = await callAction(
      saveAllForm({
        links: { create: [{ key: "s", platform: "speedruncom", identifier: "a".repeat(60), customLabel: null, customUrl: null }] },
      }),
    );

    expect(res).toMatchObject({ fieldErrors: { links: { s: expect.any(String) } } });
    expect(await linksOf(user.id)).toHaveLength(0);
  });
});
