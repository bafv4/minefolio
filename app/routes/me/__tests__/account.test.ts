// /me/account（公開とアカウント）と /me/edit（プロフィール）の保存の「列の振り分け」の回帰テスト。
// 2 ページは同じ saveProfileBatch を使い、各ページは自分の項目だけを送る（app/lib/profile-edit-scope.ts）。
// 送られていない列は触らないことを固定する: 片方のページの保存が、もう片方の列・リンク・動画・MCID・
// Speedrun.com 連携を空にしたり、updatedAt を進めたり、外部キャッシュのキックを走らせたりしない。
//
// セッション・翻訳スケジュール・targeted-refresh はモックし、DB は実DBで検証する（edit.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedKeybinding,
  seedPlayerConfig,
  seedUser,
  SHARED_MEMORY_URL,
  schema,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { ACCOUNT_PAGE_FIELDS, PROFILE_PAGE_FIELDS } from "@/lib/profile-edit-scope";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));
vi.mock("@/lib/session", () => sessionMocks);

const translationMocks = vi.hoisted(() => ({
  scheduleUserBioTranslation: vi.fn(),
}));
vi.mock("@/lib/content-translation.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content-translation.server")>();
  return { ...actual, scheduleUserBioTranslation: translationMocks.scheduleUserBioTranslation };
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

import { action as accountAction, loader as accountLoader } from "../account";
import { action as editAction } from "../edit";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

function formOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set("_action", "save_all");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function callAccount(fields: Record<string, string>) {
  const request = new Request("https://minefolio.app/me/account", { method: "POST", body: formOf(fields) });
  return accountAction({ request, params: {}, context: {} } as never);
}

async function callEdit(fields: Record<string, string>) {
  const request = new Request("https://minefolio.app/me/edit", { method: "POST", body: formOf(fields) });
  return editAction({ request, params: {}, context: {} } as never);
}

// /me/account が送る項目だけ（各ページの handleSave と同じ名前の集合）
const ACCOUNT_FORM = {
  profileVisibility: "unlisted",
  defaultProfileTab: "profile",
  showPacemanOnHome: "false",
  showTwitchOnHome: "false",
  showYoutubeOnHome: "false",
  showRankedStats: "false",
  showPacemanStats: "false",
};

// /me/edit が送る項目だけ。speedruncomUsername は既存のリンクと同じ値（連携欄はリンクから読むだけ）
const PROFILE_FORM = {
  displayName: "New Name",
  displayNameAlphabet: "New Alpha",
  bio: "new bio",
  location: "Osaka",
  pronouns: "she/her",
  shortBio: "new short",
  allowAutoTranslation: "false",
  rtaStartedYearMonth: "2022-02",
  mainPlatform: "switch",
  role: "viewer",
  profilePose: "walking",
  slimSkin: "true",
  capeDisplay: "elytra",
  speedruncomUsername: "SrOld",
};

const PAST = new Date("2024-01-01T00:00:00Z");

/** 両ページの列に、既定値と違う値を入れた走者を作る（片方の保存が他方を既定値や null に戻したら気づけるように） */
async function seedFullRunner(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const user = await seedUser(db, {
    slug: "runner",
    discordId: "discord-runner",
    mcid: "Runner",
    uuid: "11111111-1111-1111-1111-111111111111",
    bedrockMcid: "BedrockTag",
    displayName: "Old Name",
    displayNameAlphabet: "Old Alpha",
    bio: "old bio",
    location: "Tokyo",
    pronouns: "he/him",
    shortBio: "old short",
    allowAutoTranslation: true,
    rtaStartedYearMonth: "2020-01",
    mainPlatform: "pc_windows",
    role: "runner",
    profilePose: "standing",
    slimSkin: false,
    capeDisplay: "cape",
    speedruncomUsername: "SrOld",
    speedruncomId: "sr-id-1",
    profileVisibility: "public",
    defaultProfileTab: "stats",
    showPacemanOnHome: true,
    showTwitchOnHome: true,
    showYoutubeOnHome: true,
    showRankedStats: true,
    showPacemanStats: true,
    updatedAt: PAST,
    ...overrides,
  });
  await db.insert(schema.socialLinks).values({ id: "l-sr", userId: user.id, platform: "speedruncom", identifier: "SrOld" });
  await db.insert(schema.socialLinks).values({ id: "l-tw", userId: user.id, platform: "twitch", identifier: "oldtw" });
  await db
    .insert(schema.profileVideos)
    .values({ id: "v1", userId: user.id, url: "https://youtu.be/aaaaaaaaaaa", title: "V", isPinned: false, displayOrder: 0 });
  return user;
}

async function userRow(id: string) {
  return db.query.users.findFirst({ where: eq(schema.users.id, id) });
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

describe("列の振り分け（profile-edit-scope）", () => {
  it("2 ページの項目は重ならない", () => {
    const overlap = PROFILE_PAGE_FIELDS.filter((f) => (ACCOUNT_PAGE_FIELDS as readonly string[]).includes(f));
    expect(overlap).toEqual([]);
  });

  it("このテストが送る項目は、定数の振り分けと一致する", () => {
    expect(Object.keys(ACCOUNT_FORM).sort()).toEqual([...ACCOUNT_PAGE_FIELDS].sort());
    expect(Object.keys(PROFILE_FORM).sort()).toEqual([...PROFILE_PAGE_FIELDS].sort());
  });
});

describe("/me/account の保存は /me/edit の列を消さない", () => {
  it("公開範囲・既定タブ・表示設定だけが変わり、基本情報・スキン・MCID・リンク・動画・Speedrun.com 連携は不変", async () => {
    const before = await seedFullRunner();
    signInAs("discord-runner");

    const res = await callAccount(ACCOUNT_FORM);
    expect(res).toMatchObject({ success: true, action: "profile" });

    const after = (await userRow(before.id))!;
    // 変えた列
    expect(after.profileVisibility).toBe("unlisted");
    expect(after.showPacemanOnHome).toBe(false);
    expect(after.showTwitchOnHome).toBe(false);
    expect(after.showYoutubeOnHome).toBe(false);
    expect(after.showRankedStats).toBe(false);
    expect(after.showPacemanStats).toBe(false);
    // /me/edit の列は不変
    expect(after).toMatchObject({
      mcid: "Runner",
      uuid: "11111111-1111-1111-1111-111111111111",
      bedrockMcid: "BedrockTag",
      displayName: "Old Name",
      displayNameAlphabet: "Old Alpha",
      bio: "old bio",
      location: "Tokyo",
      pronouns: "he/him",
      shortBio: "old short",
      allowAutoTranslation: true,
      rtaStartedYearMonth: "2020-01",
      mainPlatform: "pc_windows",
      role: "runner",
      profilePose: "standing",
      slimSkin: false,
      capeDisplay: "cape",
      speedruncomUsername: "SrOld",
      speedruncomId: "sr-id-1",
      slug: "runner",
    });
    const links = await db.query.socialLinks.findMany({ where: eq(schema.socialLinks.userId, before.id) });
    expect(links.map((l) => l.id).sort()).toEqual(["l-sr", "l-tw"]);
    expect(await db.query.profileVideos.findMany({ where: eq(schema.profileVideos.userId, before.id) })).toHaveLength(1);
  });

  it("公開範囲・表示設定だけの変更は updatedAt を進めず、Speedrun.com ランキングの再取得もしない", async () => {
    const before = await seedFullRunner();
    signInAs("discord-runner");

    // 既定タブは内容の変化として updatedAt を進める（既存挙動）ので、ここでは現在値のまま送る
    await callAccount({ ...ACCOUNT_FORM, defaultProfileTab: "stats" });

    expect((await userRow(before.id))!.updatedAt?.getTime()).toBe(PAST.getTime());
    expect(targetedRefreshMocks.refreshSrcRankingsForUser).not.toHaveBeenCalled();
  });

  it("空の送信でも列は何も上書きされない", async () => {
    const before = await seedFullRunner();
    signInAs("discord-runner");

    const res = await callAccount({});
    expect(res).toMatchObject({ success: true });

    const after = (await userRow(before.id))!;
    expect(after).toMatchObject({
      displayName: "Old Name",
      profileVisibility: "public",
      defaultProfileTab: "stats",
      speedruncomUsername: "SrOld",
      slimSkin: false,
      showRankedStats: true,
    });
  });

  it("公開→非公開にすると既存の訳文行を消し、翻訳をスケジュールしない", async () => {
    const before = await seedFullRunner();
    await db.insert(schema.contentTranslations).values({
      targetType: "userBio",
      targetId: before.id,
      locale: "en",
      sourceHash: "dummy",
      glossaryVersion: 1,
      status: "ready",
    });
    signInAs("discord-runner");

    await callAccount({ ...ACCOUNT_FORM, profileVisibility: "private" });

    expect(await db.select().from(schema.contentTranslations)).toHaveLength(0);
    expect(translationMocks.scheduleUserBioTranslation).not.toHaveBeenCalled();
  });

  it("allowlist 外の公開範囲は拒否し、DB は無変更", async () => {
    const before = await seedFullRunner();
    signInAs("discord-runner");

    const res = (await callAccount({ ...ACCOUNT_FORM, profileVisibility: "foo" })) as { error?: string };

    expect(res.error).toBeDefined();
    expect((await userRow(before.id))!.profileVisibility).toBe("public");
  });
});

describe("/me/account の _action", () => {
  async function callWithAction(action: string | null) {
    const fd = new FormData();
    if (action !== null) fd.set("_action", action);
    fd.set("profileVisibility", "unlisted");
    const request = new Request("https://minefolio.app/me/account", { method: "POST", body: fd });
    return accountAction({ request, params: {}, context: {} } as never) as Promise<{ error?: string; success?: boolean }>;
  }

  it("送られているが未知の _action はエラーを返し、保存しない", async () => {
    const before = await seedFullRunner();
    signInAs("discord-runner");

    const res = await callWithAction("set_mcid");

    expect(res.error).toBeDefined();
    expect(res.success).toBeUndefined();
    expect((await userRow(before.id))!.profileVisibility).toBe("public");
  });

  it("_action が送られていない場合は従来どおり保存として扱う", async () => {
    const before = await seedFullRunner();
    signInAs("discord-runner");

    const res = await callWithAction(null);

    expect(res.error).toBeUndefined();
    expect((await userRow(before.id))!.profileVisibility).toBe("unlisted");
  });
});

describe("/me/account の保存の検証（不正な値は拒否し、ほかの列も書かない）", () => {
  it.each(["evil", "", "guides"])("defaultProfileTab に %j を送ると拒否する", async (value) => {
    const before = await seedFullRunner();
    signInAs("discord-runner");

    const res = (await callAccount({ ...ACCOUNT_FORM, defaultProfileTab: value })) as { error?: string };

    expect(res.error).toBe("不正な選択肢です");
    // 同じ保存に含まれる有効な変更（公開範囲・表示設定）も書かれない
    expect(await userRow(before.id)).toEqual(before);
  });

  it("廃止された既定タブ値 settings を保存済みの走者でも、その値を送り返す保存は通る", async () => {
    const before = await seedFullRunner({ defaultProfileTab: "settings" });
    signInAs("discord-runner");

    const res = await callAccount({ ...ACCOUNT_FORM, defaultProfileTab: "settings" });

    expect(res).toMatchObject({ success: true });
    expect((await userRow(before.id))!.defaultProfileTab).toBe("settings");
  });

  it.each(["showPacemanOnHome", "showTwitchOnHome", "showYoutubeOnHome", "showRankedStats", "showPacemanStats"])(
    "%s に true / false 以外を送ると拒否する（false 扱いにしない）",
    async (flag) => {
      const before = await seedFullRunner();
      signInAs("discord-runner");

      for (const value of ["on", "1", ""]) {
        const res = (await callAccount({ ...ACCOUNT_FORM, profileVisibility: "private", [flag]: value })) as {
          error?: string;
        };
        expect(res.error).toBe("不正な選択肢です");
      }
      expect(await userRow(before.id)).toEqual(before);
    },
  );
});

describe("/me/edit の保存は /me/account の列を消さない", () => {
  it("基本情報・スキン等だけが変わり、公開範囲・既定タブ・表示設定は不変", async () => {
    const before = await seedFullRunner({
      profileVisibility: "unlisted",
      defaultProfileTab: "devices",
      showPacemanOnHome: false,
      showTwitchOnHome: false,
      showYoutubeOnHome: false,
      showRankedStats: false,
      showPacemanStats: false,
    });
    signInAs("discord-runner");

    const res = await callEdit(PROFILE_FORM);
    expect(res).toMatchObject({ success: true, action: "profile" });

    const after = (await userRow(before.id))!;
    expect(after).toMatchObject({
      displayName: "New Name",
      displayNameAlphabet: "New Alpha",
      bio: "new bio",
      location: "Osaka",
      pronouns: "she/her",
      shortBio: "new short",
      allowAutoTranslation: false,
      rtaStartedYearMonth: "2022-02",
      mainPlatform: "switch",
      role: "viewer",
      profilePose: "walking",
      slimSkin: true,
      capeDisplay: "elytra",
      // /me/account の列は不変
      profileVisibility: "unlisted",
      defaultProfileTab: "devices",
      showPacemanOnHome: false,
      showTwitchOnHome: false,
      showYoutubeOnHome: false,
      showRankedStats: false,
      showPacemanStats: false,
    });
    // 連携は同じ値のまま（リンクの行・列とも維持）
    expect(after.speedruncomUsername).toBe("SrOld");
    expect(after.speedruncomId).toBe("sr-id-1");
    expect(targetedRefreshMocks.refreshSrcRankingsForUser).not.toHaveBeenCalled();
  });

  it("非公開の走者が /me/edit で保存しても、翻訳はスケジュールされず訳文行も作られない", async () => {
    const before = await seedFullRunner({ profileVisibility: "private" });
    await db.insert(schema.contentTranslations).values({
      targetType: "userBio",
      targetId: before.id,
      locale: "en",
      sourceHash: "dummy",
      glossaryVersion: 1,
      status: "ready",
    });
    signInAs("discord-runner");

    await callEdit(PROFILE_FORM);

    expect((await userRow(before.id))!.profileVisibility).toBe("private");
    expect(translationMocks.scheduleUserBioTranslation).not.toHaveBeenCalled();
    // 非公開なので訳文行は消える（公開範囲を送らなくても現在値で判定する）
    expect(await db.select().from(schema.contentTranslations)).toHaveLength(0);
  });
});

describe("loader - hasExistingData（EXISTS の相関）", () => {
  async function callLoader(): Promise<Record<string, unknown>> {
    const request = new Request("https://minefolio.app/me/account");
    return accountLoader({ request, params: {}, context: {} } as never) as never;
  }

  it("キー配置等が無ければ false、当人の行があれば true、他人の行だけなら false", async () => {
    const me = await seedUser(db, { slug: "me", discordId: "discord-me" });
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    signInAs("discord-me");

    expect((await callLoader()).hasExistingData).toBe(false);

    await seedKeybinding(db, other.id);
    expect((await callLoader()).hasExistingData).toBe(false);

    await seedPlayerConfig(db, me.id);
    const data = await callLoader();
    expect(data.hasExistingData).toBe(true);
    // extras の列は user には混ぜない
    expect(data.user).not.toHaveProperty("hasExistingData");
  });
});
