// /me/devices の action に追加されたサーバー側バリデーション（gameSensitivity / mouseDpi /
// windowsSpeed / windowsSpeedMultiplier）の回帰テスト。
// フォーム外からの POST（クライアントの number input の min/max をバイパスした場合）でも
// 異常値が player_configs に書き込まれないことを実DBで検証する。
// エラーは { error, field } を返す（field はクライアントが該当欄を強調・スクロールするのに使う）。
//
// セッションはモックし、ルート本体（プリセット前提条件・入力検証・DB書き込み）を実DBで検証する
// （app/routes/api/__tests__/likes.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  schema,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { createPreset } from "@/lib/preset-utils";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../devices";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/devices", {
    method: "POST",
    body: formData,
  });
}

async function callAction(
  formData: FormData,
): Promise<{ success?: boolean; error?: string; field?: string }> {
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

/** action は playerConfig 系の保存にアクティブなプリセットを要求するため、都度用意する */
async function setupUserWithActivePreset() {
  const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
  const preset = await createPreset(db, { userId: user.id, name: "Main", isActive: true });
  signInAs("discord-runner");
  return { user, preset };
}

/** 有効な既定値一式に overrides だけ差し替えたフォームデータを作る */
function baseFormData(presetId: string, overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("presetId", presetId);
  const defaults: Record<string, string> = {
    inputMethod: "keyboard_mouse",
    keyboardLayout: "US",
    mouseDpi: "800",
    gameSensitivity: "0.5",
    windowsSpeed: "11",
    windowsSpeedMultiplier: "",
    toggleSprint: "false",
    toggleSneak: "false",
    autoJump: "false",
    rawInput: "true",
    mouseAcceleration: "false",
    controllerSettings: "",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

async function findConfig(userId: string) {
  return db.query.playerConfigs.findFirst({ where: eq(schema.playerConfigs.userId, userId) });
}

describe("action - gameSensitivity の検証", () => {
  it("有効範囲（0..1）外（表示201%相当）は保存を拒否し player_configs に書き込まない", async () => {
    const { user, preset } = await setupUserWithActivePreset();

    const res = await callAction(baseFormData(preset.id, { gameSensitivity: "1.005" }));

    expect(res).toEqual({
      error: "ゲーム内感度は 0〜200%（0.0〜1.0）の範囲で入力してください",
      field: "gameSensitivity",
    });
    expect(await findConfig(user.id)).toBeUndefined();
  });

  it("負値も拒否する", async () => {
    const { preset } = await setupUserWithActivePreset();

    const res = await callAction(baseFormData(preset.id, { gameSensitivity: "-0.1" }));

    expect(res).toEqual({
      error: "ゲーム内感度は 0〜200%（0.0〜1.0）の範囲で入力してください",
      field: "gameSensitivity",
    });
  });

  it("境界値 0 と 1 は許可される", async () => {
    const { user, preset } = await setupUserWithActivePreset();

    const zero = await callAction(baseFormData(preset.id, { gameSensitivity: "0" }));
    expect(zero).toEqual({ success: true });
    expect((await findConfig(user.id))?.gameSensitivity).toBe(0);

    const one = await callAction(baseFormData(preset.id, { gameSensitivity: "1" }));
    expect(one).toEqual({ success: true });
    expect((await findConfig(user.id))?.gameSensitivity).toBe(1);
  });
});

describe("action - mouseDpi の検証", () => {
  it("0以下は拒否する", async () => {
    const { preset } = await setupUserWithActivePreset();

    const res = await callAction(baseFormData(preset.id, { mouseDpi: "-100" }));

    expect(res).toEqual({ error: "DPI は正の整数で入力してください", field: "mouseDpi" });
  });

  it("数値でない文字列（parseInt が NaN を返す）は拒否する", async () => {
    const { preset } = await setupUserWithActivePreset();

    const res = await callAction(baseFormData(preset.id, { mouseDpi: "abc" }));

    expect(res).toEqual({ error: "DPI は正の整数で入力してください", field: "mouseDpi" });
  });
});

describe("action - windowsSpeed の検証", () => {
  it("1〜20の範囲外は拒否する", async () => {
    const { preset } = await setupUserWithActivePreset();

    const res = await callAction(baseFormData(preset.id, { windowsSpeed: "21" }));

    expect(res).toEqual({
      error: "Windows ポインター速度は 1〜20 で選択してください",
      field: "windowsSpeed",
    });
  });

  it("0は拒否する", async () => {
    const { preset } = await setupUserWithActivePreset();

    const res = await callAction(baseFormData(preset.id, { windowsSpeed: "0" }));

    expect(res).toEqual({
      error: "Windows ポインター速度は 1〜20 で選択してください",
      field: "windowsSpeed",
    });
  });
});

describe("action - windowsSpeedMultiplier の検証", () => {
  it("0以下は拒否する", async () => {
    const { preset } = await setupUserWithActivePreset();

    const res = await callAction(baseFormData(preset.id, { windowsSpeedMultiplier: "0" }));

    expect(res).toEqual({
      error: "カスタム係数は 0 より大きい数値で入力してください",
      field: "windowsSpeedMultiplier",
    });
  });

  it("正の値は許可される", async () => {
    const { user, preset } = await setupUserWithActivePreset();

    const res = await callAction(baseFormData(preset.id, { windowsSpeedMultiplier: "1.5" }));

    expect(res).toEqual({ success: true });
    expect((await findConfig(user.id))?.windowsSpeedMultiplier).toBe(1.5);
  });
});

describe("action - 正常系", () => {
  it("すべて有効な値は保存され成功レスポンスを返す", async () => {
    const { user, preset } = await setupUserWithActivePreset();

    const res = await callAction(baseFormData(preset.id));

    expect(res).toEqual({ success: true });
    const config = await findConfig(user.id);
    expect(config?.mouseDpi).toBe(800);
    expect(config?.gameSensitivity).toBe(0.5);
    expect(config?.windowsSpeed).toBe(11);
  });
});
