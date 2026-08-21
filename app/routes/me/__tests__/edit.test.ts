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
