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
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { users } from "@/lib/schema";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action, loader } from "../edit";

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
  return action({ request: makeRequest(formData), params: {}, context: {} } as never) as never;
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

    expect(res).toEqual({ error: "RTA歴の開始年月が不正です（2009年1月〜現在まで）" });
    expect(await findRtaStartedYearMonth(user.id)).toBe("2015-01");
  });

  it("書式不正（2020-13）は保存を拒否し users 行が更新されない", async () => {
    const user = await setupUser("2015-01");

    const res = await callAction(baseFormData({ rtaStartedYearMonth: "2020-13" }));

    expect(res).toEqual({ error: "RTA歴の開始年月が不正です（2009年1月〜現在まで）" });
    expect(await findRtaStartedYearMonth(user.id)).toBe("2015-01");
  });

  it("未来の年月（9999-12）は保存を拒否し users 行が更新されない", async () => {
    const user = await setupUser("2015-01");

    const res = await callAction(baseFormData({ rtaStartedYearMonth: "9999-12" }));

    expect(res).toEqual({ error: "RTA歴の開始年月が不正です（2009年1月〜現在まで）" });
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

describe("action - profileVisibility の検証", () => {
  it("allowlist 外の値（foo）は invalidOption エラーになり、DB は無変更", async () => {
    const user = await setupUser();
    const before = await db.query.users.findFirst({ where: eq(users.id, user.id) });

    const res = await callAction(baseFormData({ profileVisibility: "foo" }));

    expect(res).toEqual({ error: "不正な選択肢です" });
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

    expect(res).toEqual({ error: "不正な選択肢です" });
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

    expect(res).toEqual({ error: "不正な選択肢です" });
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

describe("action - socialLinks の platform 検証", () => {
  it("allowlist 外の platform（evil）は invalidOption エラーになる", async () => {
    await setupUser();

    const fd = new FormData();
    fd.set("_action", "create_link");
    fd.set("platform", "evil");
    fd.set("identifier", "runner");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "不正な選択肢です" });
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
    return loader({ request, params: {}, context: {} } as never) as never;
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
