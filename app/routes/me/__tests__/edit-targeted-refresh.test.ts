// /me/edit の action に組み込まれた外部キャッシュ即時リフレッシュ・削除キック
// （scheduleSocialLinkKicks / set_mcid / delete_link / プロフィール保存の各分岐）の回帰テスト。
//
// @/lib/targeted-refresh.server を丸ごとモックし、変更されたフィールドに対応する関数だけが
// 呼ばれる（他は呼ばれない）ことと、変更が無ければ一切キックされないことを検証する。
// runAfterResponse に渡す Promise は「関数呼び出しの評価」自体が同期的に起きる
// （scheduleSocialLinkKicks 内は `runAfterResponse(fn(...))` の形で fn は即座に呼ばれる）ため、
// 単純なケースは action の await 直後に同期的に検証できる。
// mcid変更・公開切替のように非同期IIFE経由でDBを読んでから呼ばれるケースは vi.waitFor で待つ。
//
// セッション/Mojangのモック方針は edit-mcid-slug-history.test.ts と同じ。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/edit", {
    method: "POST",
    body: formData,
  });
}

async function callAction(formData: FormData) {
  return action({ request: makeRequest(formData), params: {}, context: {} } as never);
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

/** プロフィール更新の default action（_action 未指定）に必要な最小限の有効値一式 */
function baseFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
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
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

function expectOnlyCalled(...called: Array<keyof typeof targetedRefreshMocks>) {
  for (const key of Object.keys(targetedRefreshMocks) as Array<keyof typeof targetedRefreshMocks>) {
    if (key === "runAfterResponse") continue;
    if (called.includes(key)) {
      expect(targetedRefreshMocks[key]).toHaveBeenCalled();
    } else {
      expect(targetedRefreshMocks[key]).not.toHaveBeenCalled();
    }
  }
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

describe("action - create_link のキック", () => {
  it("Twitchリンク新規追加はrefreshTwitchVodsForLoginのみ呼ぶ", async () => {
    await seedUser(db, { slug: "runner1", discordId: "discord-runner1" });
    signInAs("discord-runner1");

    const fd = new FormData();
    fd.set("_action", "create_link");
    fd.set("platform", "twitch");
    fd.set("identifier", "newtwitchuser");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "link" });
    expect(targetedRefreshMocks.refreshTwitchVodsForLogin).toHaveBeenCalledWith("newtwitchuser");
    expectOnlyCalled("refreshTwitchVodsForLogin");
  });

  it("Speedrun.comリンク新規追加はrefreshSrcRankingsForUserのみ呼ぶ", async () => {
    const user = await seedUser(db, { slug: "runner2", discordId: "discord-runner2" });
    signInAs("discord-runner2");

    const fd = new FormData();
    fd.set("_action", "create_link");
    fd.set("platform", "speedruncom");
    fd.set("identifier", "src-runner");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "link" });
    expect(targetedRefreshMocks.refreshSrcRankingsForUser).toHaveBeenCalledWith(user.id);
    expectOnlyCalled("refreshSrcRankingsForUser");
  });
});

describe("action - update_link のキック", () => {
  it("Twitchのidentifier変更は旧chの削除と新chの取得の両方を呼ぶ", async () => {
    const user = await seedUser(db, { slug: "runner3", discordId: "discord-runner3" });
    const [link] = await db
      .insert(schema.socialLinks)
      .values({ userId: user.id, platform: "twitch", identifier: "oldtwitchuser" })
      .returning();
    signInAs("discord-runner3");

    const fd = new FormData();
    fd.set("_action", "update_link");
    fd.set("id", link.id);
    fd.set("platform", "twitch");
    fd.set("identifier", "newtwitchuser");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "link" });
    expect(targetedRefreshMocks.deleteTwitchVodsForLogin).toHaveBeenCalledWith("oldtwitchuser");
    expect(targetedRefreshMocks.refreshTwitchVodsForLogin).toHaveBeenCalledWith("newtwitchuser");
    expectOnlyCalled("deleteTwitchVodsForLogin", "refreshTwitchVodsForLogin");
  });

  it("identifier・platformが変更されていない場合はキックされない（変更なし保存）", async () => {
    const user = await seedUser(db, { slug: "runner4", discordId: "discord-runner4" });
    const [link] = await db
      .insert(schema.socialLinks)
      .values({ userId: user.id, platform: "twitch", identifier: "samechannel" })
      .returning();
    signInAs("discord-runner4");

    const fd = new FormData();
    fd.set("_action", "update_link");
    fd.set("id", link.id);
    fd.set("platform", "twitch");
    fd.set("identifier", "samechannel");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "link" });
    expectOnlyCalled();
  });
});

describe("action - delete_link のキック", () => {
  it("YouTubeリンク削除はdeleteYoutubeVideosForChannelIdentifierのみ呼ぶ", async () => {
    const user = await seedUser(db, { slug: "runner5", discordId: "discord-runner5" });
    const [link] = await db
      .insert(schema.socialLinks)
      .values({ userId: user.id, platform: "youtube", identifier: "@somechannel" })
      .returning();
    signInAs("discord-runner5");

    const fd = new FormData();
    fd.set("_action", "delete_link");
    fd.set("id", link.id);

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "link" });
    expect(targetedRefreshMocks.deleteYoutubeVideosForChannelIdentifier).toHaveBeenCalledWith("@somechannel");
    expectOnlyCalled("deleteYoutubeVideosForChannelIdentifier");
  });

  it("Speedrun.comリンク削除はrefreshSrcRankingsForUserのみ呼ぶ", async () => {
    const user = await seedUser(db, { slug: "runner6", discordId: "discord-runner6" });
    const [link] = await db
      .insert(schema.socialLinks)
      .values({ userId: user.id, platform: "speedruncom", identifier: "src-runner6" })
      .returning();
    signInAs("discord-runner6");

    const fd = new FormData();
    fd.set("_action", "delete_link");
    fd.set("id", link.id);

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "link" });
    expect(targetedRefreshMocks.refreshSrcRankingsForUser).toHaveBeenCalledWith(user.id);
    expectOnlyCalled("refreshSrcRankingsForUser");
  });
});

describe("action - set_mcid のキック", () => {
  it("MCID変更時、既存YouTubeリンクがあればupdateYoutubeCacheMcidとrefreshYoutubeForChannelを呼ぶ", async () => {
    const user = await seedUser(db, {
      slug: "old-mcid-slug",
      discordId: "discord-runner7",
      mcid: "OldMC",
    });
    await db
      .insert(schema.socialLinks)
      .values({ userId: user.id, platform: "youtube", identifier: "@ytchannel" });
    signInAs("discord-runner7");
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("11111111-1111-1111-1111-111111111111");

    const fd = new FormData();
    fd.set("_action", "set_mcid");
    fd.set("mcid", "NewMC");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "mcid", newSlug: "NewMC" });

    await vi.waitFor(() => {
      expect(targetedRefreshMocks.updateYoutubeCacheMcid).toHaveBeenCalledWith("OldMC", "NewMC");
      expect(targetedRefreshMocks.refreshYoutubeForChannel).toHaveBeenCalledWith("@ytchannel", "NewMC");
    });

    expect(targetedRefreshMocks.refreshTwitchVodsForLogin).not.toHaveBeenCalled();
    expect(targetedRefreshMocks.deleteTwitchVodsForLogin).not.toHaveBeenCalled();
    expect(targetedRefreshMocks.deleteYoutubeVideosForChannelIdentifier).not.toHaveBeenCalled();
    expect(targetedRefreshMocks.refreshSrcRankingsForUser).not.toHaveBeenCalled();
  });
});

describe("action - プロフィール保存（default action）のキック", () => {
  it("speedruncomUsernameの変更はrefreshSrcRankingsForUserのみ呼ぶ", async () => {
    const user = await seedUser(db, {
      slug: "runner8",
      discordId: "discord-runner8",
      speedruncomUsername: null,
    });
    signInAs("discord-runner8");

    const res = await callAction(baseFormData({ speedruncomUsername: "newsrcuser" }));

    expect(res).toEqual({ success: true, action: "profile" });
    expect(targetedRefreshMocks.refreshSrcRankingsForUser).toHaveBeenCalledWith(user.id);
    expectOnlyCalled("refreshSrcRankingsForUser");
  });

  it("非公開→公開への切替は連携済みTwitch/YouTubeとSRCランキングを即時リフレッシュする", async () => {
    const user = await seedUser(db, {
      slug: "runner9",
      discordId: "discord-runner9",
      mcid: "SteveMC",
      profileVisibility: "private",
      speedruncomUsername: null,
    });
    await db
      .insert(schema.socialLinks)
      .values([
        { userId: user.id, platform: "twitch", identifier: "twitchlogin" },
        { userId: user.id, platform: "youtube", identifier: "@ytchannel" },
      ]);
    signInAs("discord-runner9");

    const res = await callAction(baseFormData({ profileVisibility: "public" }));

    expect(res).toEqual({ success: true, action: "profile" });

    await vi.waitFor(() => {
      expect(targetedRefreshMocks.refreshTwitchVodsForLogin).toHaveBeenCalledWith("twitchlogin");
      expect(targetedRefreshMocks.refreshYoutubeForChannel).toHaveBeenCalledWith("@ytchannel", "SteveMC");
      // SRC/MCSR Rankedランキングも非公開中はcron対象外のため追いつかせる
      expect(targetedRefreshMocks.refreshSrcRankingsForUser).toHaveBeenCalledWith(user.id);
    });

    expect(targetedRefreshMocks.deleteTwitchVodsForLogin).not.toHaveBeenCalled();
    expect(targetedRefreshMocks.deleteYoutubeVideosForChannelIdentifier).not.toHaveBeenCalled();
    expect(targetedRefreshMocks.updateYoutubeCacheMcid).not.toHaveBeenCalled();
  });

  it("キックの対象になるフィールドを一切変更しない保存ではキックされない", async () => {
    await seedUser(db, {
      slug: "runner10",
      discordId: "discord-runner10",
      displayName: "Runner",
      profileVisibility: "public",
      speedruncomUsername: null,
    });
    signInAs("discord-runner10");

    const res = await callAction(baseFormData());

    expect(res).toEqual({ success: true, action: "profile" });
    expectOnlyCalled();
  });
});
