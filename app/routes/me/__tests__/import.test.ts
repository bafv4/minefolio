// /me/import の action の回帰テスト。
// インポートは「リマップ / キーバインドをまとめて書き込み、直後にプリセットへ反映する」経路で、
// ここで守りたいのは次の 3 点:
//  1. 「プリセットはあるがアクティブが1件も無い」状態を*書き込み前*に弾くこと
//     （後段の syncActivePresetSnapshot が無言で no-op になり、インポート内容がどの
//      スナップショットにも属さない孤児データになるのを防ぐ事前チェック）
//  2. 初回インポート（プリセット0件）はプリセットを自動作成し、2回目以降はアクティブ
//     スナップショットの同期へ分岐すること
//  3. 不正 payload（JSON 破損・非配列・件数上限超過）を書き込みゼロで拒否すること
// あわせてリマップの upsert（onConflictDoUpdate）が既存行を上書きし、重複行を増やさないことを見る。
//
// セッションはモックし、ルート本体（事前チェック・検証・DB書き込み）を実DBで検証する
// （app/routes/me/__tests__/devices.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedConfigPreset,
  seedKeybinding,
  seedPlayerConfig,
  schema,
  SHARED_MEMORY_URL,
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

import { action } from "../import";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

const STALE_SESSION_ERROR = "プリセットが切り替わっています。ページを再読み込みしてください";
const INVALID_DATA_ERROR = "ファイルの形式が不正です。もう一度お試しください。";
const TOO_MANY_ITEMS_ERROR = "項目が多すぎます。件数を減らしてお試しください。";

let db: TestDb;

interface ActionResult {
  success?: boolean;
  error?: string;
  type?: string;
  count?: number;
  keybindingsCount?: number;
  gameSettingsCount?: number;
  presetCreated?: boolean;
}

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/import", {
    method: "POST",
    body: formData,
  });
}

async function callAction(formData: FormData): Promise<ActionResult> {
  return action({ request: makeRequest(formData), params: {}, context: {} } as never) as never;
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

/** 送信フィールドをそのまま並べた FormData を作る（未指定フィールドは「未送信」として扱われる） */
function formDataOf(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
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

/** ログイン済みユーザーを用意する（プリセットは作らない＝初回インポートの状態） */
async function setupUser() {
  const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
  signInAs("discord-runner");
  return user;
}

type RemapPayload = {
  sourceKey: string;
  targetKey: string;
  software: string;
  notes?: string;
  remapType?: string | null;
};

/** リマップインポートの FormData */
function remapForm(remaps: unknown): FormData {
  return formDataOf({
    intent: "import-remaps",
    remaps: typeof remaps === "string" ? remaps : JSON.stringify(remaps),
  });
}

/** Minecraft 設定インポートの FormData */
function minecraftForm(keybindings: unknown, gameSettings: unknown): FormData {
  return formDataOf({
    intent: "import-minecraft",
    keybindings: typeof keybindings === "string" ? keybindings : JSON.stringify(keybindings),
    gameSettings: typeof gameSettings === "string" ? gameSettings : JSON.stringify(gameSettings),
  });
}

const CAPSLOCK_REMAP: RemapPayload = {
  sourceKey: "CapsLock",
  targetKey: "ControlLeft",
  software: "AutoHotkey",
  notes: "AHK",
};

async function findRemaps(userId: string) {
  return db.query.keyRemaps.findMany({ where: eq(schema.keyRemaps.userId, userId) });
}

async function findPresets(userId: string) {
  return db.query.configPresets.findMany({ where: eq(schema.configPresets.userId, userId) });
}

describe("action - プリセット状態の事前チェック", () => {
  it("プリセットはあるがアクティブが1件も無い場合、リマップを1件も書かずに staleSession を返す", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Inactive", isActive: false });

    const res = await callAction(remapForm([CAPSLOCK_REMAP]));

    expect(res).toEqual({ success: false, error: STALE_SESSION_ERROR });
    expect(await findRemaps(user.id)).toHaveLength(0);
  });

  it("Minecraft 設定インポートも同じ状態で書き込み前に弾く", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Inactive", isActive: false });

    const res = await callAction(
      minecraftForm(
        [{ action: "key.attack", keyCode: "mouse_left", category: "combat" }],
        { fov: 90 },
      ),
    );

    expect(res).toEqual({ success: false, error: STALE_SESSION_ERROR });
    expect(
      await db.query.keybindings.findMany({ where: eq(schema.keybindings.userId, user.id) }),
    ).toHaveLength(0);
    expect(
      await db.query.playerConfigs.findFirst({ where: eq(schema.playerConfigs.userId, user.id) }),
    ).toBeUndefined();
  });

  it("アクティブなプリセットがあれば通常どおり書き込む", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(remapForm([CAPSLOCK_REMAP]));

    expect(res.success).toBe(true);
    expect(await findRemaps(user.id)).toHaveLength(1);
  });
});

describe("action - import-remaps のプリセット分岐", () => {
  it("初回インポート（プリセット0件）はアクティブなプリセットを自動作成する", async () => {
    const user = await setupUser();

    const res = await callAction(remapForm([CAPSLOCK_REMAP]));

    expect(res).toEqual({ success: true, type: "remaps", count: 1, presetCreated: true });

    const presets = await findPresets(user.id);
    expect(presets).toHaveLength(1);
    expect(presets[0].isActive).toBe(true);
    // 作られたプリセットにはインポートしたリマップがスナップショットされている
    expect(JSON.parse(presets[0].remapsData ?? "[]")).toEqual([
      expect.objectContaining({ sourceKey: "CapsLock", targetKey: "ControlLeft" }),
    ]);
  });

  it("2回目以降はプリセットを増やさず、アクティブスナップショットを同期する", async () => {
    const user = await setupUser();
    const preset = await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(remapForm([CAPSLOCK_REMAP]));

    expect(res).toEqual({ success: true, type: "remaps", count: 1, presetCreated: false });
    expect(await findPresets(user.id)).toHaveLength(1);

    const updated = await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.id, preset.id),
    });
    expect(JSON.parse(updated?.remapsData ?? "[]")).toEqual([
      expect.objectContaining({ sourceKey: "CapsLock", targetKey: "ControlLeft" }),
    ]);
  });
});

describe("action - import-remaps の upsert", () => {
  it("同一 (sourceKey, remapType) の既存行は上書きされ、重複行を増やさない", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });
    await db.insert(schema.keyRemaps).values({
      userId: user.id,
      sourceKey: "CapsLock",
      targetKey: "Escape",
      software: "PowerToys",
      notes: "旧設定",
      remapType: "unset",
    });

    const res = await callAction(remapForm([CAPSLOCK_REMAP]));

    expect(res.success).toBe(true);
    const remaps = await findRemaps(user.id);
    expect(remaps).toHaveLength(1);
    expect(remaps[0]).toMatchObject({
      sourceKey: "CapsLock",
      targetKey: "ControlLeft",
      software: "AutoHotkey",
      notes: "AHK",
      remapType: "unset",
    });
  });

  it("同じ sourceKey でも remapType が違えば別行として共存する", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(
      remapForm([
        { ...CAPSLOCK_REMAP, remapType: "trigger" },
        { ...CAPSLOCK_REMAP, targetKey: "Escape", remapType: "chat" },
      ]),
    );

    expect(res.success).toBe(true);
    const remaps = await findRemaps(user.id);
    expect(remaps).toHaveLength(2);
    expect(
      Object.fromEntries(remaps.map((r) => [r.remapType, r.targetKey])),
    ).toEqual({ trigger: "ControlLeft", chat: "Escape" });
  });

  it("remapType が欠落した旧形式のバックアップは unset に正規化される", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    // 不明な値も unset へ倒す（normalizeKeyRemapType）
    const res = await callAction(
      remapForm([CAPSLOCK_REMAP, { ...CAPSLOCK_REMAP, sourceKey: "F13", remapType: "bogus" }]),
    );

    expect(res.success).toBe(true);
    const remaps = await findRemaps(user.id);
    expect(remaps.map((r) => r.remapType)).toEqual(["unset", "unset"]);
  });
});

describe("action - import-remaps の入力検証", () => {
  it("不正な JSON は invalidData で拒否し、DB を変更しない", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(remapForm("{not json"));

    expect(res).toEqual({ success: false, error: INVALID_DATA_ERROR });
    expect(await findRemaps(user.id)).toHaveLength(0);
    expect(await findPresets(user.id)).toHaveLength(1);
  });

  it("配列でない JSON は invalidData で拒否する", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(remapForm({ sourceKey: "CapsLock" }));

    expect(res).toEqual({ success: false, error: INVALID_DATA_ERROR });
    expect(await findRemaps(user.id)).toHaveLength(0);
  });

  it("要素が null（[null]）は invalidData で拒否し、1件も書き込まない", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(remapForm([null]));

    expect(res).toEqual({ success: false, error: INVALID_DATA_ERROR });
    expect(await findRemaps(user.id)).toHaveLength(0);
  });

  it("sourceKey が欠落した要素があれば invalidData で拒否し、他の正常な要素も書き込まない", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(remapForm([CAPSLOCK_REMAP, { targetKey: "Escape", software: "PowerToys" }]));

    expect(res).toEqual({ success: false, error: INVALID_DATA_ERROR });
    expect(await findRemaps(user.id)).toHaveLength(0);
  });

  it("1000件を超える payload は tooManyItems で拒否し、1件も書き込まない", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const remaps = Array.from({ length: 1001 }, (_, i) => ({
      ...CAPSLOCK_REMAP,
      sourceKey: `Key${i}`,
    }));

    const res = await callAction(remapForm(remaps));

    expect(res).toEqual({ success: false, error: TOO_MANY_ITEMS_ERROR });
    expect(await findRemaps(user.id)).toHaveLength(0);
  });

  it("ちょうど1000件は受け付ける（上限の境界）", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const remaps = Array.from({ length: 1000 }, (_, i) => ({
      ...CAPSLOCK_REMAP,
      sourceKey: `Key${i}`,
    }));

    const res = await callAction(remapForm(remaps));

    expect(res).toEqual({ success: true, type: "remaps", count: 1000, presetCreated: false });
    expect(await findRemaps(user.id)).toHaveLength(1000);
  });
});

describe("action - import-minecraft", () => {
  it("キーバインドとゲーム設定を保存し、初回はプリセットを作成する", async () => {
    const user = await setupUser();

    const res = await callAction(
      minecraftForm(
        [
          { action: "key.attack", keyCode: "mouse_left", category: "combat" },
          { action: "key.forward", keyCode: "KeyW", category: "movement" },
        ],
        { fov: 90, toggleSprint: true },
      ),
    );

    expect(res).toEqual({
      success: true,
      type: "minecraft",
      keybindingsCount: 2,
      gameSettingsCount: 2,
      presetCreated: true,
    });

    const keybindings = await db.query.keybindings.findMany({
      where: eq(schema.keybindings.userId, user.id),
    });
    expect(keybindings.map((kb) => kb.action).sort()).toEqual(["key.attack", "key.forward"]);

    const config = await db.query.playerConfigs.findFirst({
      where: eq(schema.playerConfigs.userId, user.id),
    });
    expect(config).toMatchObject({ fov: 90, toggleSprint: true });
    expect(await findPresets(user.id)).toHaveLength(1);
  });

  it("既存のキーバインドは action 単位で上書きされ、重複行を増やさない", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });
    await seedKeybinding(db, user.id, {
      action: "key.attack",
      keyCode: "KeyF",
      category: "combat",
    });

    const res = await callAction(
      minecraftForm([{ action: "key.attack", keyCode: "mouse_left", category: "combat" }], {}),
    );

    expect(res.success).toBe(true);
    const keybindings = await db.query.keybindings.findMany({
      where: eq(schema.keybindings.userId, user.id),
    });
    expect(keybindings).toHaveLength(1);
    expect(keybindings[0].keyCode).toBe("mouse_left");
  });

  it("既存の player_configs は指定フィールドだけ更新し、他の値は保持する", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });
    await seedPlayerConfig(db, user.id, { mouseDpi: 800, fov: 70 });

    const res = await callAction(minecraftForm([], { fov: 103 }));

    expect(res).toEqual({
      success: true,
      type: "minecraft",
      keybindingsCount: 0,
      gameSettingsCount: 1,
      presetCreated: false,
    });

    const configs = await db.query.playerConfigs.findMany({
      where: eq(schema.playerConfigs.userId, user.id),
    });
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ fov: 103, mouseDpi: 800 });
  });

  it("keybindings が配列でない payload は invalidData で拒否する", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(minecraftForm({ action: "key.attack" }, {}));

    expect(res).toEqual({ success: false, error: INVALID_DATA_ERROR });
    expect(
      await db.query.keybindings.findMany({ where: eq(schema.keybindings.userId, user.id) }),
    ).toHaveLength(0);
  });

  it("category が allowlist 外（keybindings.category enum 以外）の要素は invalidData で拒否する", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(
      minecraftForm([{ action: "key.attack", keyCode: "mouse_left", category: "bogus" }], {}),
    );

    expect(res).toEqual({ success: false, error: INVALID_DATA_ERROR });
    expect(
      await db.query.keybindings.findMany({ where: eq(schema.keybindings.userId, user.id) }),
    ).toHaveLength(0);
  });

  it("要素が null を含む payload（[null]）は invalidData で拒否する", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(minecraftForm([null], {}));

    expect(res).toEqual({ success: false, error: INVALID_DATA_ERROR });
    expect(
      await db.query.keybindings.findMany({ where: eq(schema.keybindings.userId, user.id) }),
    ).toHaveLength(0);
  });

  it("gameSettings が JSON オブジェクトでない payload は invalidData で拒否する", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(
      minecraftForm([{ action: "key.attack", keyCode: "mouse_left", category: "combat" }], "null"),
    );

    expect(res).toEqual({ success: false, error: INVALID_DATA_ERROR });
    expect(
      await db.query.keybindings.findMany({ where: eq(schema.keybindings.userId, user.id) }),
    ).toHaveLength(0);
  });

  it("1000件を超えるキーバインドは tooManyItems で拒否し、1件も書き込まない", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const keybindings = Array.from({ length: 1001 }, (_, i) => ({
      action: `key.custom${i}`,
      keyCode: "KeyA",
      category: "ui" as const,
    }));

    const res = await callAction(minecraftForm(keybindings, {}));

    expect(res).toEqual({ success: false, error: TOO_MANY_ITEMS_ERROR });
    expect(
      await db.query.keybindings.findMany({ where: eq(schema.keybindings.userId, user.id) }),
    ).toHaveLength(0);
  });
});

describe("action - 未知の intent", () => {
  it("既知でない intent は何も書き込まず success:false を返す", async () => {
    const user = await setupUser();
    await seedConfigPreset(db, user.id, { name: "Main", isActive: true });

    const res = await callAction(formDataOf({ intent: "import-unknown" }));

    expect(res).toEqual({ success: false });
    expect(await findRemaps(user.id)).toHaveLength(0);
  });
});
