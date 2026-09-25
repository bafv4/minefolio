// /onboarding のウィザード式 action（start / save_profile / save_minecraft / save_links /
// save_visibility）と loader の回帰テスト。
//
// 特に save_minecraft の「フォームの偽 uuid を信用せず、必ず Mojang から mcid→uuid を
// 再導出する」性質（onboarding.tsx のコメント参照）は、旧テスト（verify/complete 時代）から
// 引き継ぐ最優先の契約。
//
// セッションのモック方針は app/routes/me/__tests__/edit.test.ts / devices.test.ts と同じ。
// @/lib/mojang は fetchUuidFromMcid のみ差し替え、MojangError は実クラスをそのまま使う
// （action 側の `error instanceof MojangError` 判定と同一クラス参照にするため importOriginal
// で実モジュールを土台にする）。
// @/lib/targeted-refresh.server は丸ごとモックする（save_links の speedruncom 変更・
// save_visibility の非公開→公開切替が runAfterResponse 経由で本物の外部API（Twitch/YouTube/
// Speedrun.com/MCSR Ranked）へ fetch するのを防ぐ。方針は edit-targeted-refresh.test.ts と同じ）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { users, socialLinks } from "@/lib/schema";

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

import { MojangError } from "@/lib/mojang";
import { action, loader } from "../onboarding";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData, url = "https://minefolio.app/onboarding"): Request {
  return new Request(url, { method: "POST", body: formData });
}

async function callAction(formData: FormData, url?: string) {
  return action({ request: makeRequest(formData, url), params: {}, context: {} } as never);
}

async function callLoader(url = "https://minefolio.app/onboarding") {
  return loader({ request: new Request(url), params: {}, context: {} } as never);
}

function signInAs(discordId: string, name: string | null = "Runner", image: string | null = null) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId, name, image } });
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

async function findUserByDiscordId(discordId: string) {
  return db.query.users.findFirst({ where: eq(users.discordId, discordId) });
}

async function userCount(): Promise<number> {
  return (await db.query.users.findMany()).length;
}

function makeStartFormData(): FormData {
  const fd = new FormData();
  fd.set("_action", "start");
  return fd;
}

describe("action - start", () => {
  it("印字可能ASCIIのDiscord名なら private/未完了/@形式slugでusers行を作り、displayNameAlphabetにも採用される", async () => {
    signInAs("discord-runner", "Runner123");

    const res = await callAction(makeStartFormData());

    expect(res).toEqual({ success: true, action: "start" });

    const created = await findUserByDiscordId("discord-runner");
    expect(created).toBeTruthy();
    expect(created?.profileVisibility).toBe("private");
    expect(created?.onboardingCompleted).toBe(false);
    expect(created?.displayName).toBe("Runner123");
    expect(created?.displayNameAlphabet).toBe("Runner123");
    expect(created?.slug).toBe("@discord-runner");
    expect(created?.mcid).toBeNull();
    expect(created?.uuid).toBeNull();
  });

  it("日本語のDiscord名はdisplayNameには入るがdisplayNameAlphabetはnullになる", async () => {
    signInAs("discord-jp", "ランナー太郎");

    await callAction(makeStartFormData());

    const created = await findUserByDiscordId("discord-jp");
    expect(created?.displayName).toBe("ランナー太郎");
    expect(created?.displayNameAlphabet).toBeNull();
  });

  it("同一discordIdで2回目のstartは行を増やさず成功を返す（途中離脱からの再開）", async () => {
    signInAs("discord-runner");

    const first = await callAction(makeStartFormData());
    expect(first).toEqual({ success: true, action: "start" });
    expect(await userCount()).toBe(1);

    const second = await callAction(makeStartFormData());
    expect(second).toEqual({ success: true, action: "start" });
    expect(await userCount()).toBe(1);
  });
});

describe("action - save_profile", () => {
  it("表示名が空欄ならDiscord表示名にフォールバックし、ASCII名ならアルファベット表記にも採用される", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner", "Runner123");

    const fd = new FormData();
    fd.set("_action", "save_profile");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "profile" });
    const updated = await findUserByDiscordId("discord-runner");
    expect(updated?.displayName).toBe("Runner123");
    expect(updated?.displayNameAlphabet).toBe("Runner123");
  });

  it("Discord表示名が非ASCIIの場合、空欄のアルファベット表記はnullのまま", async () => {
    await seedUser(db, { discordId: "discord-jp", slug: "@discord-jp" });
    signInAs("discord-jp", "ランナー太郎");

    const fd = new FormData();
    fd.set("_action", "save_profile");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "profile" });
    const updated = await findUserByDiscordId("discord-jp");
    expect(updated?.displayName).toBe("ランナー太郎");
    expect(updated?.displayNameAlphabet).toBeNull();
  });

  it("表示名51文字はdisplayNameMaxエラーになる", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_profile");
    fd.set("displayName", "a".repeat(51));

    const res = await callAction(fd);

    expect(res).toEqual({ error: "表示名は50文字以下にしてください" });
  });

  it("非ASCIIのアルファベット表記はdisplayNameAlphabetInvalidエラーになる", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_profile");
    fd.set("displayNameAlphabet", "ランナー");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "アルファベット表記は半角の英数字・記号のみ使用できます" });
  });
});

describe("action - save_minecraft（なりすまし防止）", () => {
  it("フォームの偽uuidは無視され、Mojangが返すuuidで保存されslugがmcidになる", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("11111111-1111-1111-1111-111111111111");

    const fd = new FormData();
    fd.set("_action", "save_minecraft");
    fd.set("mcid", "Steve");
    fd.set("uuid", "ffffffff-ffff-ffff-ffff-ffffffffffff"); // クライアント側の偽装値

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "minecraft" });
    expect(mojangMocks.fetchUuidFromMcid).toHaveBeenCalledWith("Steve");

    const updated = await findUserByDiscordId("discord-runner");
    expect(updated?.mcid).toBe("Steve");
    expect(updated?.uuid).toBe("11111111-1111-1111-1111-111111111111");
    expect(updated?.slug).toBe("Steve");
  });

  it("他ユーザーが登録済みのmcidはmcidTakenエラーで行が変わらない", async () => {
    await seedUser(db, { slug: "steve", discordId: "discord-owner", mcid: "Steve" });
    const before = await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_minecraft");
    fd.set("mcid", "Steve");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "このMCIDは既に登録されています" });
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
    expect(await findUserByDiscordId("discord-runner")).toEqual(before);
  });

  it("MCID_NOT_FOUNDはmcidNotFoundエラーを返す", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(
      new MojangError("MCID_NOT_FOUND", "Minecraft ID not found"),
    );

    const fd = new FormData();
    fd.set("_action", "save_minecraft");
    fd.set("mcid", "NoSuchPlayer");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "MCIDが見つかりません。正しいMCIDを入力してください。" });
  });

  it("その他のMojangErrorはmcidVerifyFailedエラーを返す", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(new MojangError("API_ERROR", "Mojang API error: 500"));

    const fd = new FormData();
    fd.set("_action", "save_minecraft");
    fd.set("mcid", "Steve");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "MCIDの検証に失敗しました" });
  });

  it("空欄にするとmcid/uuidがnullに戻りslugが@形式に戻る", async () => {
    await seedUser(db, {
      discordId: "discord-runner",
      slug: "Steve",
      mcid: "Steve",
      uuid: "11111111-1111-1111-1111-111111111111",
    });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_minecraft");
    fd.set("mcid", "");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "minecraft" });
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();

    const updated = await findUserByDiscordId("discord-runner");
    expect(updated?.mcid).toBeNull();
    expect(updated?.uuid).toBeNull();
    expect(updated?.slug).toBe("@discord-runner");
  });

  it("Bedrock版MCIDはMojangを呼ばずに保存される", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_minecraft");
    fd.set("bedrockMcid", "Gamertag123");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "minecraft" });
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();

    const updated = await findUserByDiscordId("discord-runner");
    expect(updated?.bedrockMcid).toBe("Gamertag123");
    expect(updated?.mcid).toBeNull();
    expect(updated?.slug).toBe("@discord-runner");
  });

  it("Bedrock版MCIDが25文字以上はbedrockMcidLengthエラーになる", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_minecraft");
    fd.set("bedrockMcid", "a".repeat(25));

    const res = await callAction(fd);

    expect(res).toEqual({ error: "Bedrock版MCIDは3〜24文字である必要があります" });
    const updated = await findUserByDiscordId("discord-runner");
    expect(updated?.bedrockMcid).toBeNull();
  });
});

describe("action - save_links", () => {
  it("4プラットフォームをupsertする", async () => {
    const user = await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_links");
    fd.set("youtube", "yt-runner");
    fd.set("twitch", "twitch-runner");
    fd.set("twitter", "x-runner");
    fd.set("speedruncom", "src-runner");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "links" });
    const links = await db.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) });
    const byPlatform = Object.fromEntries(links.map((l) => [l.platform, l.identifier]));
    expect(byPlatform).toEqual({
      youtube: "yt-runner",
      twitch: "twitch-runner",
      twitter: "x-runner",
      speedruncom: "src-runner",
    });
  });

  it("空欄にすると該当プラットフォームのリンクが削除される", async () => {
    const user = await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    await db.insert(socialLinks).values([
      { userId: user.id, platform: "youtube", identifier: "yt-runner" },
      { userId: user.id, platform: "twitch", identifier: "twitch-runner" },
    ]);
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_links");
    // youtube/twitch は空欄のまま送信 = 削除

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "links" });
    const links = await db.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) });
    expect(links).toHaveLength(0);
  });

  it("speedruncomはusers.speedruncomUsernameに同期され、変更時はspeedruncomIdがnullにリセットされる", async () => {
    await seedUser(db, {
      discordId: "discord-runner",
      slug: "@discord-runner",
      speedruncomUsername: null,
      speedruncomId: "old-src-id",
    });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_links");
    fd.set("speedruncom", "new-src-user");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "links" });
    const updated = await findUserByDiscordId("discord-runner");
    expect(updated?.speedruncomUsername).toBe("new-src-user");
    expect(updated?.speedruncomId).toBeNull();
  });

  it("YouTubeの禁止文字（空白）はidInvalidCharsエラーになる", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_links");
    fd.set("youtube", "invalid id");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "YouTube: IDに使用できない文字が含まれています" });
  });

  it("その他プラットフォームの/^[\\w-]+$/違反はidAllowedCharsエラーになる", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "@discord-runner" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "save_links");
    fd.set("twitch", "bad id!");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "Twitch: IDには英数字、ハイフン、アンダースコアのみ使用できます" });
  });
});

describe("action - save_visibility", () => {
  function makeVisibilityFormData(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set("_action", "save_visibility");
    const defaults: Record<string, string> = {
      profileVisibility: "public",
      showRankedStats: "true",
      showPacemanStats: "true",
      showPacemanOnHome: "true",
      showTwitchOnHome: "true",
      showYoutubeOnHome: "true",
    };
    for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
      fd.set(k, v);
    }
    return fd;
  }

  it("不正なenumはinvalidOptionエラーになりDBは無変更", async () => {
    await seedUser(db, {
      discordId: "discord-runner",
      slug: "@discord-runner",
      profileVisibility: "private",
      onboardingCompleted: false,
    });
    signInAs("discord-runner");

    const res = await callAction(makeVisibilityFormData({ profileVisibility: "foo" }));

    expect(res).toEqual({ error: "不正な選択肢です" });
    const updated = await findUserByDiscordId("discord-runner");
    expect(updated?.onboardingCompleted).toBe(false);
    expect(updated?.profileVisibility).toBe("private");
  });

  it("正常時はonboardingCompletedとshow*フラグが保存され、returnToがあればそこへredirectToが返る", async () => {
    await seedUser(db, {
      discordId: "discord-runner",
      slug: "steve",
      profileVisibility: "private",
      onboardingCompleted: false,
    });
    signInAs("discord-runner");

    const fd = makeVisibilityFormData({ profileVisibility: "unlisted" });
    fd.set("returnTo", "/me/edit");

    const res = await callAction(fd);

    expect(res).toMatchObject({
      success: true,
      action: "complete",
      slug: "steve",
      redirectTo: "/me/edit",
    });

    const updated = await findUserByDiscordId("discord-runner");
    expect(updated?.onboardingCompleted).toBe(true);
    expect(updated?.profileVisibility).toBe("unlisted");
    expect(updated?.showRankedStats).toBe(true);
    expect(updated?.showPacemanStats).toBe(true);
    expect(updated?.showPacemanOnHome).toBe(true);
    expect(updated?.showTwitchOnHome).toBe(true);
    expect(updated?.showYoutubeOnHome).toBe(true);
  });

  it("returnToが無ければredirectToは/player/:slugになる", async () => {
    await seedUser(db, {
      discordId: "discord-runner",
      slug: "steve",
      profileVisibility: "private",
      onboardingCompleted: false,
    });
    signInAs("discord-runner");

    const res = await callAction(makeVisibilityFormData());

    expect(res).toMatchObject({ success: true, action: "complete", redirectTo: "/player/steve" });
  });

  it("外部URLのreturnToは/player/:slugにフォールバックする", async () => {
    await seedUser(db, {
      discordId: "discord-runner",
      slug: "steve",
      profileVisibility: "private",
      onboardingCompleted: false,
    });
    signInAs("discord-runner");

    const fd = makeVisibilityFormData();
    fd.set("returnTo", "https://evil.com/phish");

    const res = await callAction(fd);

    expect(res).toMatchObject({ success: true, action: "complete", redirectTo: "/player/steve" });
  });
});

describe("loader", () => {
  it("登録済み（onboardingCompleted=true）ユーザーはreturnTo優先で、無ければ/player/:slugへリダイレクトされる", async () => {
    await seedUser(db, { discordId: "discord-runner", slug: "steve", onboardingCompleted: true });
    signInAs("discord-runner");

    const withReturnTo = (await callLoader("https://minefolio.app/onboarding?returnTo=/me/edit")) as Response;
    expect(withReturnTo).toBeInstanceOf(Response);
    expect(withReturnTo.status).toBe(302);
    expect(withReturnTo.headers.get("Location")).toBe("/me/edit");

    const withoutReturnTo = (await callLoader("https://minefolio.app/onboarding")) as Response;
    expect(withoutReturnTo).toBeInstanceOf(Response);
    expect(withoutReturnTo.status).toBe(302);
    expect(withoutReturnTo.headers.get("Location")).toBe("/player/steve");
  });

  it("未完了ユーザーはリダイレクトされず、再開用データ（保存済みuser・discordUser）を返す", async () => {
    await seedUser(db, {
      discordId: "discord-runner",
      slug: "@discord-runner",
      onboardingCompleted: false,
      displayName: "Runner",
      mcid: null,
    });
    signInAs("discord-runner", "Runner", "https://example.com/avatar.png");

    const result = (await callLoader()) as {
      discordUser: { id: string; name: string | null; image: string | null };
      user: { id: string; slug: string; displayName: string | null } | null;
      links: Record<string, string>;
      returnTo: string | null;
    };

    expect(result).not.toBeInstanceOf(Response);
    expect(result.discordUser).toEqual({
      id: "discord-runner",
      name: "Runner",
      image: "https://example.com/avatar.png",
    });
    expect(result.user).not.toBeNull();
    expect(result.user?.slug).toBe("@discord-runner");
    expect(result.user?.displayName).toBe("Runner");
    expect(result.links).toEqual({ youtube: "", twitch: "", twitter: "", speedruncom: "" });
    expect(result.returnTo).toBeNull();
  });
});
