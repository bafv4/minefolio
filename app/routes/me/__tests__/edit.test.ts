// /me/edit の action に追加された rtaStartedYearMonth（RTA歴・開始年月）のサーバー側検証の回帰テスト。
// isValidRtaStartedYearMonth による書式・範囲チェックのみを対象とし、プロフィール更新の他フィールドは
// 既定の有効値で固定する。
//
// セッションはモックし、ルート本体（バリデーション・DB書き込み）を実DBで検証する
// （app/routes/me/__tests__/devices.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedKeybinding,
  seedPlayerConfig,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { contentTranslations, socialLinks, users } from "@/lib/schema";
import { MAX_SOCIAL_LINKS, PROFILE_FIELD_LIMITS, type ProfileChanges } from "@/lib/profile-edit-validation";
import { PROFILE_TAB_VALUES } from "@/lib/profile-tabs";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
  registeredUserContext: {},
}));

vi.mock("@/lib/session", () => sessionMocks);

const translationMocks = vi.hoisted(() => ({
  scheduleUserBioTranslation: vi.fn(),
}));

// 翻訳のスケジュールだけ差し替える（本物は waitUntil 経由で Anthropic API へ到達しうる）。
// 訳文行の削除（removeUserBioTranslations）は本物を使って DB を検証する
vi.mock("@/lib/content-translation.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content-translation.server")>();
  return { ...actual, scheduleUserBioTranslation: translationMocks.scheduleUserBioTranslation };
});

import { action, loader } from "../edit";
import { saveProfileBatch } from "@/lib/profile-edit.server";
import { createTranslator } from "@/lib/messages";
const t = createTranslator("ja");

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/edit", {
    method: "POST",
    body: formData,
  });
}

async function callAction(formData: FormData): Promise<{ success?: boolean; error?: string }> {
  return action({ request: makeRequest(formData), params: {}, context: { get: () => null } } as never) as never;
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

/** 既存の rtaStartedYearMonth を持つユーザーを用意する（未変更検証の基準値） */
async function setupUser(initialRtaStartedYearMonth: string | null = "2015-01") {
  const user = await seedUser(db, {
    slug: "runner",
    discordId: "discord-runner",
    rtaStartedYearMonth: initialRtaStartedYearMonth,
  });
  signInAs("discord-runner");
  return user;
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

async function findRtaStartedYearMonth(userId: string): Promise<string | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return row?.rtaStartedYearMonth ?? null;
}

describe("action - rtaStartedYearMonth の検証", () => {
  it("下限未満（2008-12）は保存を拒否し users 行が更新されない", async () => {
    const user = await setupUser("2015-01");

    const res = await callAction(baseFormData({ rtaStartedYearMonth: "2008-12" }));

    expect(res).toEqual({ error: "RTA歴の開始年月は、2009年1月から現在までの範囲で選んでください" });
    expect(await findRtaStartedYearMonth(user.id)).toBe("2015-01");
  });

  it("書式不正（2020-13）は保存を拒否し users 行が更新されない", async () => {
    const user = await setupUser("2015-01");

    const res = await callAction(baseFormData({ rtaStartedYearMonth: "2020-13" }));

    expect(res).toEqual({ error: "RTA歴の開始年月は、2009年1月から現在までの範囲で選んでください" });
    expect(await findRtaStartedYearMonth(user.id)).toBe("2015-01");
  });

  it("未来の年月（9999-12）は保存を拒否し users 行が更新されない", async () => {
    const user = await setupUser("2015-01");

    const res = await callAction(baseFormData({ rtaStartedYearMonth: "9999-12" }));

    expect(res).toEqual({ error: "RTA歴の開始年月は、2009年1月から現在までの範囲で選んでください" });
    expect(await findRtaStartedYearMonth(user.id)).toBe("2015-01");
  });

  it("空文字は null として保存される（未回答扱い）", async () => {
    const user = await setupUser("2015-01");

    const res = await callAction(baseFormData({ rtaStartedYearMonth: "" }));

    expect(res).toEqual({ success: true, action: "profile" });
    expect(await findRtaStartedYearMonth(user.id)).toBeNull();
  });

  it("有効な値（2020-06）はそのまま保存される", async () => {
    const user = await setupUser(null);

    const res = await callAction(baseFormData({ rtaStartedYearMonth: "2020-06" }));

    expect(res).toEqual({ success: true, action: "profile" });
    expect(await findRtaStartedYearMonth(user.id)).toBe("2020-06");
  });
});

describe("action - pronouns の検証", () => {
  it("21文字は pronounsMax エラーになる", async () => {
    await setupUser();

    const res = await callAction(baseFormData({ pronouns: "a".repeat(21) }));

    expect(res).toEqual({ error: "代名詞は20文字以内で入力してください" });
  });
});

describe("action - ageGroup（年代）の検証", () => {
  async function findAge(userId: string) {
    const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
    return { ageGroup: row?.ageGroup, ageGroupPublic: row?.ageGroupPublic };
  }

  it("正常値は保存され、公開フラグも保存される", async () => {
    const user = await setupUser();

    const res = await callAction(baseFormData({ ageGroup: "20s", ageGroupPublic: "true" }));

    expect(res).toEqual({ success: true, action: "profile" });
    expect(await findAge(user.id)).toEqual({ ageGroup: "20s", ageGroupPublic: true });
  });

  it("空文字は未設定（null）になり、公開フラグも false に戻る", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      ageGroup: "30s",
      ageGroupPublic: true,
    });
    signInAs("discord-runner");

    const res = await callAction(baseFormData({ ageGroup: "", ageGroupPublic: "true" }));

    expect(res).toEqual({ success: true, action: "profile" });
    expect(await findAge(user.id)).toEqual({ ageGroup: null, ageGroupPublic: false });
  });

  it("未知の値は保存せずエラーを返し、既存の値を null で上書きしない", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      ageGroup: "30s",
      ageGroupPublic: true,
    });
    signInAs("discord-runner");

    const res = await callAction(baseFormData({ ageGroup: "teens" }));

    expect(res).toEqual({ error: t("meEdit.invalidOption") });
    expect(await findAge(user.id)).toEqual({ ageGroup: "30s", ageGroupPublic: true });
  });
});

describe("action - profileVisibility の検証", () => {
  it("allowlist 外の値（foo）は invalidOption エラーになり、DB は無変更", async () => {
    const user = await setupUser();
    const before = await db.query.users.findFirst({ where: eq(users.id, user.id) });

    const res = await callAction(baseFormData({ profileVisibility: "foo" }));

    expect(res).toEqual({ error: t("meEdit.invalidOption") });
    expect(await db.query.users.findFirst({ where: eq(users.id, user.id) })).toEqual(before);
  });
});

describe("action - capeDisplay の検証", () => {
  async function findCapeDisplay(userId: string): Promise<string | undefined> {
    const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
    return row?.capeDisplay;
  }

  it.each(["cape", "elytra", "hidden"])("有効値（%s）は保存される", async (value) => {
    // 保存値と異なる初期値から始めて、確実に書き換わったことを見る
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      capeDisplay: value === "cape" ? "hidden" : "cape",
    });
    signInAs("discord-runner");

    const res = await callAction(baseFormData({ capeDisplay: value }));

    expect(res).toEqual({ success: true, action: "profile" });
    expect(await findCapeDisplay(user.id)).toBe(value);
  });

  it("allowlist 外の値（evil）は invalidOption エラーになり、DB は無変更", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      capeDisplay: "elytra",
    });
    signInAs("discord-runner");
    const before = await db.query.users.findFirst({ where: eq(users.id, user.id) });

    const res = await callAction(baseFormData({ capeDisplay: "evil" }));

    expect(res).toEqual({ error: t("meEdit.invalidOption") });
    expect(await db.query.users.findFirst({ where: eq(users.id, user.id) })).toEqual(before);
  });

  it("空文字も不正値として扱い、列を上書きしない", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      capeDisplay: "elytra",
    });
    signInAs("discord-runner");

    const res = await callAction(baseFormData({ capeDisplay: "" }));

    expect(res).toEqual({ error: t("meEdit.invalidOption") });
    expect(await findCapeDisplay(user.id)).toBe("elytra");
  });

  it("未送信のときは capeDisplay 列を上書きせず、他の項目は保存される", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      capeDisplay: "elytra",
    });
    signInAs("discord-runner");

    const res = await callAction(baseFormData({ displayName: "Renamed" }));

    expect(res).toEqual({ success: true, action: "profile" });
    const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(row?.capeDisplay).toBe("elytra");
    expect(row?.displayName).toBe("Renamed");
  });
});

describe("allowAutoTranslation（自己紹介の自動翻訳の許可）", () => {
  it("未送信（機能無効でスイッチが出ない）のときは列を上書きせず、保存済みの値が残る", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      allowAutoTranslation: false,
    });
    signInAs("discord-runner");

    const res = await callAction(baseFormData({ displayName: "Renamed" }));

    expect(res).toEqual({ success: true, action: "profile" });
    const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(row?.allowAutoTranslation).toBe(false);
    expect(row?.displayName).toBe("Renamed");
  });

  it("送信された値は保存される", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    await callAction(baseFormData({ allowAutoTranslation: "false" }));

    const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(row?.allowAutoTranslation).toBe(false);
  });
});

describe("loader - translationEnabled", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  async function callLoader(): Promise<{ translationEnabled: boolean }> {
    const request = new Request("https://minefolio.app/me/edit");
    return loader({ request, params: {}, context: { get: () => null } } as never) as never;
  }

  it("ANTHROPIC_API_KEY 未設定なら false を返す", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    expect((await callLoader()).translationEnabled).toBe(false);
  });

  it("ANTHROPIC_API_KEY 設定済みなら true を返す", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    expect((await callLoader()).translationEnabled).toBe(true);
  });
});

describe("自己紹介の自動翻訳と公開範囲（非公開プロフィールは翻訳しない）", () => {
  async function seedTranslationRow(userId: string) {
    await db.insert(contentTranslations).values({
      targetType: "userBio",
      targetId: userId,
      locale: "en",
      sourceHash: "dummy",
      glossaryVersion: 1,
      status: "ready",
    });
  }

  it("非公開→公開に変えると翻訳がスケジュールされる", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner", profileVisibility: "private" });
    signInAs("discord-runner");

    await callAction(baseFormData({ profileVisibility: "public" }));

    expect(translationMocks.scheduleUserBioTranslation).toHaveBeenCalledTimes(1);
    expect(translationMocks.scheduleUserBioTranslation.mock.calls[0][1]).toBe(user.id);
  });

  it("非公開→限定公開でも翻訳がスケジュールされる", async () => {
    await seedUser(db, { slug: "runner", discordId: "discord-runner", profileVisibility: "private" });
    signInAs("discord-runner");

    await callAction(baseFormData({ profileVisibility: "unlisted" }));

    expect(translationMocks.scheduleUserBioTranslation).toHaveBeenCalledTimes(1);
  });

  it("公開→非公開に変えると既存の訳文行を即時削除し、翻訳はスケジュールしない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner", profileVisibility: "public" });
    await seedTranslationRow(user.id);
    signInAs("discord-runner");

    await callAction(baseFormData({ profileVisibility: "private" }));

    expect(await db.select().from(contentTranslations)).toHaveLength(0);
    expect(translationMocks.scheduleUserBioTranslation).not.toHaveBeenCalled();
  });
});

describe("action - defaultProfileTab の検証", () => {
  it.each([...PROFILE_TAB_VALUES])("有効値（%s）は保存される", async (value) => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      defaultProfileTab: value === "profile" ? "stats" : "profile",
    });
    signInAs("discord-runner");

    const res = await callAction(baseFormData({ defaultProfileTab: value }));

    expect(res).toEqual({ success: true, action: "profile" });
    expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.defaultProfileTab).toBe(value);
  });

  it.each(["evil", "", "guides", "Profile"])("不正な値（%j）は invalidOption エラーになり、ほかの列も書かれない", async (value) => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner", defaultProfileTab: "stats", displayName: "Old" });
    signInAs("discord-runner");
    const before = await db.query.users.findFirst({ where: eq(users.id, user.id) });

    const res = await callAction(baseFormData({ defaultProfileTab: value, displayName: "Changed" }));

    expect(res).toEqual({ error: t("meEdit.invalidOption") });
    expect(await db.query.users.findFirst({ where: eq(users.id, user.id) })).toEqual(before);
  });
});

describe("action - 真偽の欄（slimSkin / show*）の検証", () => {
  const FLAGS = ["slimSkin", "showPacemanOnHome", "showTwitchOnHome", "showYoutubeOnHome", "showRankedStats", "showPacemanStats"];

  it.each(FLAGS.flatMap((f) => ["on", "1", "", "TRUE"].map((v) => [f, v] as const)))(
    "%s に %j を送ると invalidOption エラーになり、DB は無変更（false 扱いにしない）",
    async (flag, value) => {
      const user = await seedUser(db, {
        slug: "runner",
        discordId: "discord-runner",
        slimSkin: true,
        showPacemanOnHome: true,
        showTwitchOnHome: true,
        showYoutubeOnHome: true,
        showRankedStats: true,
        showPacemanStats: true,
        displayName: "Old",
      });
      signInAs("discord-runner");
      const before = await db.query.users.findFirst({ where: eq(users.id, user.id) });

      const res = await callAction(baseFormData({ [flag]: value, displayName: "Changed" }));

      expect(res).toEqual({ error: t("meEdit.invalidOption") });
      expect(await db.query.users.findFirst({ where: eq(users.id, user.id) })).toEqual(before);
    },
  );

  it("\"true\" / \"false\" は従来どおり保存される", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner", slimSkin: false, showRankedStats: true });
    signInAs("discord-runner");

    const res = await callAction(baseFormData({ slimSkin: "true", showRankedStats: "false" }));

    expect(res).toEqual({ success: true, action: "profile" });
    const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(row).toMatchObject({ slimSkin: true, showRankedStats: false });
  });
});

describe("action - リンクの長さ・件数の上限", () => {
  function formWithChanges(changes: ProfileChanges, overrides: Record<string, string> = {}): FormData {
    const fd = baseFormData({ _action: "save_all", ...overrides });
    fd.set("changes", JSON.stringify(changes));
    return fd;
  }
  const custom = (label: string, url: string) => ({
    key: "k",
    platform: "custom",
    identifier: "id",
    customLabel: label,
    customUrl: url,
  });

  it("上限ちょうどのカスタムリンクは保存できる", async () => {
    const user = await setupUser();
    const url = "https://example.com/" + "a".repeat(PROFILE_FIELD_LIMITS.customUrl - "https://example.com/".length);

    const res = await callAction(
      formWithChanges({ links: { create: [custom("a".repeat(PROFILE_FIELD_LIMITS.customLabel), url)] } }),
    );

    expect(res).toEqual({ success: true, action: "profile" });
    expect(await db.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) })).toHaveLength(1);
  });

  it("customLabel が上限を超えるとエラーになり、リンクもほかの列も書かれない", async () => {
    const user = await setupUser();

    const res = (await callAction(
      formWithChanges(
        { links: { create: [custom("a".repeat(PROFILE_FIELD_LIMITS.customLabel + 1), "https://example.com")] } },
        { displayName: "Changed" },
      ),
    )) as { error?: string };

    expect(res.error).toBe("カスタムSNSの表示名は100文字以内で入力してください");
    expect(await db.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) })).toHaveLength(0);
    expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.displayName).not.toBe("Changed");
  });

  it("customUrl が上限を超えるとエラーになり、何も書かれない", async () => {
    const user = await setupUser();
    const url = "https://example.com/" + "a".repeat(PROFILE_FIELD_LIMITS.customUrl);

    const res = (await callAction(formWithChanges({ links: { create: [custom("x", url)] } }))) as { error?: string };

    expect(res.error).toBe("URLは2000文字以内で入力してください");
    expect(await db.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) })).toHaveLength(0);
  });

  it("リンクが上限件数ある状態で増やす保存は拒否し、何も書かれない", async () => {
    const user = await setupUser();
    await db.insert(socialLinks).values(
      Array.from({ length: MAX_SOCIAL_LINKS }, (_, i) => ({
        userId: user.id,
        platform: "custom" as const,
        identifier: `id${i}`,
        customLabel: `l${i}`,
        customUrl: "https://example.com",
      })),
    );

    const res = (await callAction(
      formWithChanges({ links: { create: [custom("x", "https://example.com")] } }),
    )) as { error?: string };

    expect(res.error).toBe("リンクは50件まで登録できます");
    expect(await db.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) })).toHaveLength(MAX_SOCIAL_LINKS);
  });

  it("上限超えの既存データがあっても、件数が増えない保存（削除）は通る", async () => {
    const user = await setupUser();
    const rows = Array.from({ length: MAX_SOCIAL_LINKS + 2 }, (_, i) => ({
      id: `link${i}`,
      userId: user.id,
      platform: "custom" as const,
      identifier: `id${i}`,
      customLabel: `l${i}`,
      customUrl: "https://example.com",
    }));
    await db.insert(socialLinks).values(rows);

    const res = await callAction(formWithChanges({ links: { delete: ["link0"] } }));

    expect(res).toEqual({ success: true, action: "profile" });
  });
});

describe("action - 未知の _action", () => {
  it("save_all 以外の _action（古いタブが送る import_legacy / delete_account など）は拒否し、何も書かれない", async () => {
    const user = await setupUser();

    for (const unknown of ["import_legacy", "delete_account", "bogus", ""]) {
      const res = await callAction(baseFormData({ _action: unknown, displayName: "Changed" }));
      expect(res).toEqual({ error: t("meEdit.invalidOption") });
    }
    expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.displayName).not.toBe("Changed");
  });

  it("_action 未指定（従来の保存）は今までどおり保存できる", async () => {
    const user = await setupUser();

    const res = await callAction(baseFormData({ displayName: "Changed" }));

    expect(res).toEqual({ success: true, action: "profile" });
    expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.displayName).toBe("Changed");
  });
});

describe("saveProfileBatch - リンクの重複をトランザクション内で再検査する", () => {
  it("事前確認（トランザクションの外）の後に同じプラットフォームのリンクが入っても、重複して作らず何も書かない", async () => {
    const user = await setupUser();
    // 並行リクエストが事前確認の後・書き込みの前に commit した状態を作る。事前確認の読み取りだけは古い（空の）結果を返させる
    await db.insert(socialLinks).values({ id: "raced", userId: user.id, platform: "youtube", identifier: "first" });
    vi.spyOn(db.query.socialLinks, "findMany").mockResolvedValueOnce([]);
    const fd = baseFormData({ displayName: "Changed" });
    fd.set("changes", JSON.stringify({ links: { create: [{ key: "k", platform: "youtube", identifier: "second" }] } }));

    const res = await saveProfileBatch({ db, t: createTranslator("ja"), user, formData: fd });

    expect(res).toMatchObject({ error: "このプラットフォームのリンクは既に登録されています" });
    const links = await db.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) });
    expect(links.map((l) => l.identifier)).toEqual(["first"]);
    expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.displayName).not.toBe("Changed");
  });

  it("重複が無ければ従来どおり作成できる", async () => {
    const user = await setupUser();
    const fd = baseFormData();
    fd.set("changes", JSON.stringify({ links: { create: [{ key: "k", platform: "youtube", identifier: "only" }] } }));

    const res = await saveProfileBatch({ db, t: createTranslator("ja"), user, formData: fd });

    expect(res).toMatchObject({ success: true });
    expect(await db.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) })).toHaveLength(1);
  });
});
