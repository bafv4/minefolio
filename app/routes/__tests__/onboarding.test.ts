// /onboarding の action（verify / complete / skip）の回帰テスト。
// 特に「complete はクライアント送信の hidden uuid を信用せず、必ず Mojang から mcid→uuid を
// 再導出する」性質（onboarding.tsx のコメント参照）は、現状コードコメントでしか担保されて
// いない一発勝負の契約（ユーザー作成）なので最優先で検証する。
//
// セッションのモック方針は app/routes/me/__tests__/edit.test.ts / devices.test.ts と同じ。
// @/lib/mojang は fetchUuidFromMcid のみ差し替え、MojangError は実クラスをそのまま使う
// （action 側の `error instanceof MojangError` 判定と同一クラス参照にするため importOriginal
// で実モジュールを土台にする）。
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

import { MojangError } from "@/lib/mojang";
import { action } from "../onboarding";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/onboarding", {
    method: "POST",
    body: formData,
  });
}

function callAction(formData: FormData): Promise<Response | { error?: string; verified?: boolean; mcid?: string; uuid?: string }> {
  return action({ request: makeRequest(formData), params: {}, context: {} } as never) as never;
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId, name: "Runner", image: null } });
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

describe("action - complete（なりすまし防止）", () => {
  it("フォームの偽 uuid は無視され、Mojang が返す uuid で users 行が作られる", async () => {
    signInAs("discord-runner");
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("11111111-1111-1111-1111-111111111111");

    const fd = new FormData();
    fd.set("_action", "complete");
    fd.set("mcid", "Steve");
    fd.set("uuid", "ffffffff-ffff-ffff-ffff-ffffffffffff"); // クライアント側の偽装値

    const res = (await callAction(fd)) as Response;

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/player/Steve");

    // サーバーは formData の uuid を一切参照せず、mcid のみで Mojang に問い合わせる
    expect(mojangMocks.fetchUuidFromMcid).toHaveBeenCalledWith("Steve");

    const created = await findUserByDiscordId("discord-runner");
    expect(created?.uuid).toBe("11111111-1111-1111-1111-111111111111");
    expect(created?.mcid).toBe("Steve");
  });
});

describe("action - mcid 重複", () => {
  it("verify で既に登録済みの mcid は errorMcidTaken を返す", async () => {
    await seedUser(db, { slug: "steve", discordId: "discord-owner", mcid: "Steve" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "verify");
    fd.set("mcid", "Steve");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "このMinecraft IDは既に登録されています" });
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });

  it("complete で既に登録済みの mcid は errorMcidTaken を返し users 行を増やさない", async () => {
    await seedUser(db, { slug: "steve", discordId: "discord-owner", mcid: "Steve" });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "complete");
    fd.set("mcid", "Steve");
    fd.set("uuid", "11111111-1111-1111-1111-111111111111");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "このMinecraft IDは既に登録されています" });
    expect(await userCount()).toBe(1);
  });
});

describe("action - 同一 discordId の二重 onboarding", () => {
  it("skip を2回実行すると2回目は errorAlreadyRegistered を返し users 行が増えない", async () => {
    signInAs("discord-runner");

    const first = (await callAction(makeSkipFormData())) as Response;
    expect(first.status).toBe(302);
    expect(await userCount()).toBe(1);

    const second = await callAction(makeSkipFormData());

    expect(second).toEqual({ error: "すでに登録が完了しています。ページを再読み込みしてください。" });
    expect(await userCount()).toBe(1);
  });
});

describe("action - skip", () => {
  it("mcid/uuid が null で登録され、returnTo の安全な相対パスへリダイレクトされる", async () => {
    signInAs("discord-runner");

    const fd = makeSkipFormData();
    fd.set("returnTo", "/me/edit");

    const res = (await callAction(fd)) as Response;

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/me/edit");

    const created = await findUserByDiscordId("discord-runner");
    expect(created?.mcid).toBeNull();
    expect(created?.uuid).toBeNull();
  });
});

describe("action - Mojang エラー分岐", () => {
  it("verify: MCID_NOT_FOUND は errorMcidNotFound を返す", async () => {
    signInAs("discord-runner");
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(
      new MojangError("MCID_NOT_FOUND", "Minecraft ID not found"),
    );

    const fd = new FormData();
    fd.set("_action", "verify");
    fd.set("mcid", "NoSuchPlayer");

    const res = await callAction(fd);

    expect(res).toEqual({
      error: "Minecraft IDが見つかりません。確認してもう一度お試しください。",
    });
  });

  it("complete: Mojang API のその他のエラーは errorVerifyFailed を返し users 行を作らない", async () => {
    signInAs("discord-runner");
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(new MojangError("API_ERROR", "Mojang API error: 500"));

    const fd = new FormData();
    fd.set("_action", "complete");
    fd.set("mcid", "Steve");
    fd.set("uuid", "11111111-1111-1111-1111-111111111111");

    const res = await callAction(fd);

    expect(res).toEqual({ error: "Minecraft IDの検証に失敗しました。もう一度お試しください。" });
    expect(await userCount()).toBe(0);
  });
});

function makeSkipFormData(): FormData {
  const fd = new FormData();
  fd.set("_action", "skip");
  return fd;
}
