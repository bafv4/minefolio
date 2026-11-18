// 共通レイアウト（routes/_layout.tsx）の loader のうち、初期設定の再開案内に使う
// onboardingPending / onboardingResumeStep の回帰テスト。
//
// セッションはモックし、ルート本体は実DBで検証する（onboarding.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { socialLinks } from "@/lib/schema";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, ...sessionMocks };
});

import { loader } from "../_layout";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

type LoaderData = {
  user: { slug: string } | null;
  onboardingPending: boolean;
  onboardingResumeStep: number | null;
};

async function callLoader(): Promise<LoaderData> {
  return loader({ request: new Request("https://minefolio.app/"), params: {}, context: {} } as never) as never;
}

function signInAs(discordId: string, name: string | null = "Runner") {
  sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: discordId, name, image: null } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  sessionMocks.getOptionalSession.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("loader - onboardingPending", () => {
  it("未ログインは false（再開位置も null）", async () => {
    const result = await callLoader();
    expect(result.user).toBeNull();
    expect(result.onboardingPending).toBe(false);
    expect(result.onboardingResumeStep).toBeNull();
  });

  it("ログイン済みで users 行が無ければ true（「はじめる」前なので再開位置は null）", async () => {
    signInAs("discord-new");

    const result = await callLoader();

    expect(result.user).toBeNull();
    expect(result.onboardingPending).toBe(true);
    expect(result.onboardingResumeStep).toBeNull();
  });

  it("初期設定が未完了なら true で、保存済みの内容から再開位置を推定する", async () => {
    await seedUser(db, {
      discordId: "discord-runner",
      slug: "@discord-runner",
      displayName: "Runner",
      onboardingCompleted: false,
    });
    signInAs("discord-runner", "Runner");

    const result = await callLoader();

    expect(result.onboardingPending).toBe(true);
    // 表示名が Discord の表示名と同じだけ＝痕跡なし
    expect(result.onboardingResumeStep).toBe(1);
    expect(result.user?.slug).toBe("@discord-runner");
  });

  it("未完了で連携リンクまで保存済みなら、最後のステップから再開する", async () => {
    const user = await seedUser(db, {
      discordId: "discord-runner",
      slug: "@discord-runner",
      displayName: "Runner",
      mcid: "Steve",
      onboardingCompleted: false,
    });
    await db.insert(socialLinks).values({ userId: user.id, platform: "twitch", identifier: "runner" });
    signInAs("discord-runner", "Runner");

    const result = await callLoader();

    expect(result.onboardingPending).toBe(true);
    expect(result.onboardingResumeStep).toBe(5);
  });

  it("初期設定が完了していれば false（再開位置は推定しない）", async () => {
    await seedUser(db, {
      discordId: "discord-runner",
      slug: "steve",
      mcid: "Steve",
      onboardingCompleted: true,
    });
    signInAs("discord-runner");

    const result = await callLoader();

    expect(result.onboardingPending).toBe(false);
    expect(result.onboardingResumeStep).toBeNull();
    expect(result.user?.slug).toBe("steve");
  });
});
