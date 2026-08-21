// /me/keybindings の action の回帰テスト。
// 主対象はルート内インラインの persistRemaps（衝突検証・「一括削除→挿入」方式・UNIQUE catch）と
// save-all の原子性（リマップ衝突で全体中断＝部分適用なし）。
// key_remaps は (user_id, source_key, remap_type) が UNIQUE のため、逐次 update だと
// 「同一 sourceKey の2行で種別を入れ替える」正当な最終状態が一時的な衝突で保存できない。
// この方式上の強みが壊れていないことを実DBで確認する。
//
// セッションはモックし、ルート本体（プリセット前提条件・検証・DB書き込み）を実DBで検証する
// （app/routes/me/__tests__/devices.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedConfigPreset,
  seedKeybinding,
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

import { action } from "../keybindings";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

type ActionResult = { success?: boolean; message?: string; error?: string };

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/keybindings", {
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

/**
 * action の全 intent はアクティブプリセットを要求するため、都度用意する。
 * createPreset() ではなく直接 insert する（config_history にプリセット作成の履歴を
 * 混ぜず、save-all が記録する keybinding 履歴だけを数えられるようにするため）。
 */
async function setupUserWithActivePreset() {
  const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
  const preset = await seedConfigPreset(db, user.id, { name: "Main", isActive: true });
  signInAs("discord-runner");
  return { user, preset };
}

type SeedRemapValues = {
  sourceKey: string;
  remapType: "unset" | "all" | "trigger" | "chat";
  targetKey?: string | null;
};

/** key_remaps を 1 件挿入して返す（このテスト専用。id は schema の既定で採番される） */
async function seedRemap(userId: string, values: SeedRemapValues) {
  const [row] = await db
    .insert(schema.keyRemaps)
    .values({
      userId,
      sourceKey: values.sourceKey,
      targetKey: values.targetKey ?? null,
      remapType: values.remapType,
    })
    .returning();
  return row;
}

async function findRemaps(userId: string) {
  return db.query.keyRemaps.findMany({ where: eq(schema.keyRemaps.userId, userId) });
}

async function findRemapById(id: string) {
  return db.query.keyRemaps.findFirst({ where: eq(schema.keyRemaps.id, id) });
}

async function findKeybinding(id: string) {
  return db.query.keybindings.findFirst({ where: eq(schema.keybindings.id, id) });
}

async function findKeybindingHistory(userId: string) {
  return db.query.configHistory.findMany({
    where: and(
      eq(schema.configHistory.userId, userId),
      eq(schema.configHistory.changeType, "keybinding"),
    ),
  });
}

describe("action - save-remaps（一括削除→挿入）", () => {
  it("同一 sourceKey の2行で種別を入れ替えても保存できる（逐次 update だと UNIQUE 衝突する並び）", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const trigger = await seedRemap(user.id, {
      sourceKey: "KeyA",
      remapType: "trigger",
      targetKey: "KeyX",
    });
    const chat = await seedRemap(user.id, {
      sourceKey: "KeyA",
      remapType: "chat",
      targetKey: "KeyY",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-remaps",
        presetId: preset.id,
        remaps: JSON.stringify([
          { id: trigger.id, sourceKey: "KeyA", targetKey: "KeyX", remapType: "chat" },
          { id: chat.id, sourceKey: "KeyA", targetKey: "KeyY", remapType: "trigger" },
        ]),
      }),
    );

    expect(res).toEqual({ success: true, message: "リマップを保存しました" });
    expect((await findRemapById(trigger.id))?.remapType).toBe("chat");
    expect((await findRemapById(trigger.id))?.targetKey).toBe("KeyX");
    expect((await findRemapById(chat.id))?.remapType).toBe("trigger");
    expect((await findRemapById(chat.id))?.targetKey).toBe("KeyY");

    // アクティブプリセットのスナップショットにも入れ替え後の内容が同期される
    const updatedPreset = await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.id, preset.id),
    });
    const snapshot = JSON.parse(updatedPreset?.remapsData ?? "[]") as Array<{
      targetKey: string | null;
      remapType: string;
    }>;
    expect(
      snapshot.map((r) => `${r.targetKey}:${r.remapType}`).sort(),
    ).toEqual(["KeyX:chat", "KeyY:trigger"]);
  });

  it("同一 sourceKey・同一種別の重複はエラーを返し、既存行を変更しない", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const existing = await seedRemap(user.id, {
      sourceKey: "KeyA",
      remapType: "trigger",
      targetKey: "KeyX",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-remaps",
        presetId: preset.id,
        remaps: JSON.stringify([
          { id: existing.id, sourceKey: "KeyA", targetKey: "KeyX", remapType: "trigger" },
          { sourceKey: "KeyA", targetKey: "KeyZ", remapType: "trigger" },
        ]),
      }),
    );

    expect(res).toEqual({
      error: "同じ変更元キー・種別のリマップが重複しています: A(Trigger)",
    });
    const rows = await findRemaps(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
    expect(rows[0].targetKey).toBe("KeyX");
  });

  it("All と他種別の共存はエラーを返し、既存行を変更しない", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const existing = await seedRemap(user.id, {
      sourceKey: "KeyB",
      remapType: "all",
      targetKey: "KeyX",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-remaps",
        presetId: preset.id,
        remaps: JSON.stringify([
          { id: existing.id, sourceKey: "KeyB", targetKey: "KeyX", remapType: "all" },
          { sourceKey: "KeyB", targetKey: "KeyZ", remapType: "trigger" },
        ]),
      }),
    );

    expect(res).toEqual({ error: "B は All のリマップと他の種別を併用できません" });
    const rows = await findRemaps(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].remapType).toBe("all");
  });

  it("削除と同一 (sourceKey, 種別) の新規追加を同時に送っても保存できる", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const existing = await seedRemap(user.id, {
      sourceKey: "KeyA",
      remapType: "trigger",
      targetKey: "KeyX",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-remaps",
        presetId: preset.id,
        remaps: JSON.stringify([
          { id: existing.id, sourceKey: "KeyA", targetKey: "KeyX", remapType: "trigger", _delete: true },
          { sourceKey: "KeyA", targetKey: "KeyZ", remapType: "trigger" },
        ]),
      }),
    );

    expect(res).toEqual({ success: true, message: "リマップを保存しました" });
    const rows = await findRemaps(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(existing.id);
    expect(rows[0].targetKey).toBe("KeyZ");
  });

  it("配列でない payload は invalidPayload を返す", async () => {
    const { preset } = await setupUserWithActivePreset();

    const res = await callAction(
      formDataOf({
        intent: "save-remaps",
        presetId: preset.id,
        remaps: JSON.stringify({ sourceKey: "KeyA" }),
      }),
    );

    expect(res).toEqual({ error: "送信データの形式が不正です。" });
  });

  it("要素に null を含む配列は invalidPayload を返し、既存行を変更しない", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const existing = await seedRemap(user.id, {
      sourceKey: "KeyA",
      remapType: "trigger",
      targetKey: "KeyX",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-remaps",
        presetId: preset.id,
        remaps: JSON.stringify([
          { id: existing.id, sourceKey: "KeyA", targetKey: "KeyX", remapType: "trigger" },
          null,
        ]),
      }),
    );

    expect(res).toEqual({ error: "送信データの形式が不正です。" });
    const rows = await findRemaps(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].targetKey).toBe("KeyX");
  });
});

describe("action - save-all の原子性", () => {
  it("リマップに衝突があると全体が中断し、キーバインド・指割り当て・変更履歴のいずれも適用されない", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const keybinding = await seedKeybinding(db, user.id, {
      action: "forward",
      keyCode: "KeyW",
      category: "movement",
    });
    await seedRemap(user.id, { sourceKey: "KeyA", remapType: "trigger", targetKey: "KeyX" });
    await seedRemap(user.id, { sourceKey: "KeyA", remapType: "chat", targetKey: "KeyY" });

    const res = await callAction(
      formDataOf({
        intent: "save-all",
        presetId: preset.id,
        keybindings: JSON.stringify([{ id: keybinding.id, keyCode: "KeyZ" }]),
        remaps: JSON.stringify([
          { sourceKey: "KeyA", targetKey: "KeyX", remapType: "trigger" },
          { sourceKey: "KeyA", targetKey: "KeyZ", remapType: "trigger" },
        ]),
        fingerAssignments: JSON.stringify({ KeyW: ["left-index"] }),
      }),
    );

    expect(res).toEqual({
      error: "同じ変更元キー・種別のリマップが重複しています: A(Trigger)",
    });
    // キーバインドは未適用
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("KeyW");
    // 指割り当ての player_configs 行は作られない
    expect(
      await db.query.playerConfigs.findFirst({
        where: eq(schema.playerConfigs.userId, user.id),
      }),
    ).toBeUndefined();
    // リマップも元のまま
    const rows = await findRemaps(user.id);
    expect(rows.map((r) => r.remapType).sort()).toEqual(["chat", "trigger"]);
    // 変更履歴も未記録
    expect(await findKeybindingHistory(user.id)).toHaveLength(0);
  });

  it("衝突が無ければ同じ組み合わせがすべて適用され、変更履歴が1件記録される", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const keybinding = await seedKeybinding(db, user.id, {
      action: "forward",
      keyCode: "KeyW",
      category: "movement",
    });
    const existing = await seedRemap(user.id, {
      sourceKey: "KeyA",
      remapType: "trigger",
      targetKey: "KeyX",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-all",
        presetId: preset.id,
        keybindings: JSON.stringify([{ id: keybinding.id, keyCode: "KeyZ" }]),
        remaps: JSON.stringify([
          { id: existing.id, sourceKey: "KeyA", targetKey: "KeyQ", remapType: "trigger" },
        ]),
        fingerAssignments: JSON.stringify({ KeyW: ["left-index"] }),
      }),
    );

    expect(res).toEqual({ success: true, message: "設定を保存しました" });
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("KeyZ");
    expect((await findRemapById(existing.id))?.targetKey).toBe("KeyQ");
    const config = await db.query.playerConfigs.findFirst({
      where: eq(schema.playerConfigs.userId, user.id),
    });
    expect(config?.fingerAssignments).toBe(JSON.stringify({ KeyW: ["left-index"] }));

    const history = await findKeybindingHistory(user.id);
    expect(history).toHaveLength(1);
    expect(history[0].changeDescription).toBe("操作割り当て・リマップ・指割り当てを更新");
  });
});

describe("action - プリセットゲート", () => {
  it("アクティブなプリセットが無い場合は presetRequired エラーを返す", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    await seedConfigPreset(db, user.id, { name: "Inactive", isActive: false });
    signInAs("discord-runner");
    const keybinding = await seedKeybinding(db, user.id, {
      action: "forward",
      keyCode: "KeyW",
      category: "movement",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-keybindings",
        keybindings: JSON.stringify([{ id: keybinding.id, keyCode: "KeyZ" }]),
      }),
    );

    expect(res).toEqual({ error: "設定を編集するには、先にプリセットを作成してください" });
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("KeyW");
  });

  it("送信 presetId がアクティブプリセットと異なる場合は staleSession エラーを返す", async () => {
    const { user } = await setupUserWithActivePreset();
    const other = await seedConfigPreset(db, user.id, { name: "Other", isActive: false });
    const keybinding = await seedKeybinding(db, user.id, {
      action: "forward",
      keyCode: "KeyW",
      category: "movement",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-keybindings",
        presetId: other.id,
        keybindings: JSON.stringify([{ id: keybinding.id, keyCode: "KeyZ" }]),
      }),
    );

    expect(res).toEqual({
      error: "プリセットが切り替わっています。ページを再読み込みしてください",
    });
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("KeyW");
  });
});

describe("action - 空文字 keyCode の扱い（normalizeEmptyToUnbound）", () => {
  it("save-keybindings では空文字が _UNBOUND に正規化される", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const keybinding = await seedKeybinding(db, user.id, {
      action: "forward",
      keyCode: "KeyW",
      category: "movement",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-keybindings",
        presetId: preset.id,
        keybindings: JSON.stringify([{ id: keybinding.id, keyCode: "" }]),
      }),
    );

    expect(res).toEqual({ success: true, message: "キー配置を保存しました" });
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("_UNBOUND");
  });

  it("save-all では空文字の keyCode は無視され既存値が保持される", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const keybinding = await seedKeybinding(db, user.id, {
      action: "forward",
      keyCode: "KeyW",
      category: "movement",
    });

    const res = await callAction(
      formDataOf({
        intent: "save-all",
        presetId: preset.id,
        keybindings: JSON.stringify([{ id: keybinding.id, keyCode: "" }]),
      }),
    );

    expect(res).toEqual({ success: true, message: "設定を保存しました" });
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("KeyW");
  });
});
