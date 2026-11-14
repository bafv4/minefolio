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
import { syncActivePresetSnapshot } from "@/lib/preset-utils";

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

describe("action - save-all の customActions（トランザクション内の逐次実行）", () => {
  it("customActions を含む save-all で削除・更新・追加が適用される", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const now = new Date();
    await db.insert(schema.customActions).values([
      { id: "ca-keep", userId: user.id, actionName: "old", category: "other", triggerKey: "KeyQ", displayOrder: 0, createdAt: now, updatedAt: now },
      { id: "ca-del", userId: user.id, actionName: "gone", category: "other", triggerKey: "KeyE", displayOrder: 1, createdAt: now, updatedAt: now },
    ]);
    const keybinding = await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW", category: "movement" });

    const res = await callAction(
      formDataOf({
        intent: "save-all",
        presetId: preset.id,
        keybindings: JSON.stringify([{ id: keybinding.id, keyCode: "KeyZ" }]),
        customActions: JSON.stringify([
          { id: "ca-del", _delete: true },
          { id: "ca-keep", actionName: "renamed", triggerKey: "KeyQ", category: "other" },
          { actionName: "fresh", triggerKey: "KeyR", category: "other" },
        ]),
      }),
    );

    expect(res).toEqual({ success: true, message: "設定を保存しました" });
    const rows = await db.query.customActions.findMany({ where: eq(schema.customActions.userId, user.id) });
    expect(rows.map((r) => r.actionName).sort()).toEqual(["fresh", "renamed"]);
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("KeyZ");
    const snapshot = await db.query.configPresets.findFirst({ where: eq(schema.configPresets.id, preset.id) });
    expect(JSON.parse(snapshot!.customActionsData!)).toHaveLength(2);
  });
});

describe("action - save-custom-keys（db.batch 経路）", () => {
  it("削除・更新・追加を1バッチで適用し、スナップショットを同期する", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const now = new Date();
    await db.insert(schema.customKeys).values([
      { id: "ck-keep", userId: user.id, keyCode: "Custom1", keyName: "Old", category: "keyboard", createdAt: now, updatedAt: now },
      { id: "ck-del", userId: user.id, keyCode: "Custom2", keyName: "Gone", category: "keyboard", createdAt: now, updatedAt: now },
    ]);

    const res = await callAction(
      formDataOf({
        intent: "save-custom-keys",
        presetId: preset.id,
        customKeys: JSON.stringify([
          { id: "ck-del", _delete: true },
          { id: "ck-keep", keyCode: "Custom1", keyName: "Renamed", category: "mouse" },
          { keyCode: "Custom3", keyName: "Fresh", category: "keyboard" },
        ]),
      }),
    );

    expect(res.success).toBe(true);
    const rows = await db.query.customKeys.findMany({ where: eq(schema.customKeys.userId, user.id) });
    expect(rows.map((r) => `${r.keyName}:${r.category}`).sort()).toEqual(["Fresh:keyboard", "Renamed:mouse"]);
    const snapshot = await db.query.configPresets.findFirst({ where: eq(schema.configPresets.id, preset.id) });
    expect(JSON.parse(snapshot!.customKeysData!)).toHaveLength(2);
  });
});

describe("syncActivePresetSnapshot - 切替後の no-op", () => {
  it("activePresetId が切替後に非アクティブになっていれば、そのプリセットのスナップショットを書き換えない", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW", category: "movement" });
    // 解決後に別タブで別プリセットへ切替が起きた状態を再現する
    const next = await seedConfigPreset(db, user.id, { name: "Next", isActive: false });
    await db.update(schema.configPresets).set({ isActive: false }).where(eq(schema.configPresets.id, preset.id));
    await db.update(schema.configPresets).set({ isActive: true }).where(eq(schema.configPresets.id, next.id));

    await syncActivePresetSnapshot(db as never, user.id, ["keybindings"], { activePresetId: preset.id });

    const old = await db.query.configPresets.findFirst({ where: eq(schema.configPresets.id, preset.id) });
    expect(old?.keybindingsData).toBeNull();
    const current = await db.query.configPresets.findFirst({ where: eq(schema.configPresets.id, next.id) });
    expect(current?.keybindingsData).toBeNull();
  });
});

describe("action - save-keybindings の入力検証", () => {
  it("件数が上限（1000）を超えると invalidPayload を返し、何も更新しない", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const keybinding = await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW", category: "movement" });
    const updates = Array.from({ length: 1001 }, (_, i) => ({
      id: i === 0 ? keybinding.id : `dummy-${i}`,
      keyCode: "KeyZ",
    }));

    const res = await callAction(
      formDataOf({ intent: "save-keybindings", presetId: preset.id, keybindings: JSON.stringify(updates) }),
    );

    expect(res).toEqual({ error: "送信データの形式が不正です。" });
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("KeyW");
  });

  it("上限ちょうどの件数は受け付ける", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const keybinding = await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW", category: "movement" });
    const updates = Array.from({ length: 1000 }, (_, i) => ({
      id: i === 0 ? keybinding.id : `dummy-${i}`,
      keyCode: "KeyZ",
    }));

    const res = await callAction(
      formDataOf({ intent: "save-keybindings", presetId: preset.id, keybindings: JSON.stringify(updates) }),
    );

    expect(res.success).toBe(true);
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("KeyZ");
  });

  it.each([
    ["keyCode が文字列でない", { keyCode: 123 }],
    ["keyCode が無い", {}],
    ["id が文字列でない", { id: 1, keyCode: "KeyZ" }],
  ])("%s 要素を含むと invalidPayload を返す（save-keybindings / save-all）", async (_label, bad) => {
    const { user, preset } = await setupUserWithActivePreset();
    const keybinding = await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW", category: "movement" });
    const payload = JSON.stringify([{ id: keybinding.id, keyCode: "KeyZ" }, { id: "x", ...bad }]);

    for (const intent of ["save-keybindings", "save-all"]) {
      const res = await callAction(formDataOf({ intent, presetId: preset.id, keybindings: payload }));
      expect(res).toEqual({ error: "送信データの形式が不正です。" });
    }
    expect((await findKeybinding(keybinding.id))?.keyCode).toBe("KeyW");
  });
});

describe("action - まとめ書き込み（CASE UPDATE / db.batch / upsert）", () => {
  it("save-keybindings は複数行を1回で更新し、他ユーザー行・未送信行は変えず、スナップショットを同期する", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    const fwd = await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW", category: "movement" });
    const back = await seedKeybinding(db, user.id, { action: "back", keyCode: "KeyS", category: "movement" });
    const left = await seedKeybinding(db, user.id, { action: "left", keyCode: "KeyA", category: "movement" });
    const foreign = await seedKeybinding(db, other.id, { action: "forward", keyCode: "KeyW", category: "movement" });

    const res = await callAction(
      formDataOf({
        intent: "save-keybindings",
        presetId: preset.id,
        keybindings: JSON.stringify([
          { id: fwd.id, keyCode: "KeyI" },
          { id: back.id, keyCode: "" },
          // 同一 id は後勝ち
          { id: fwd.id, keyCode: "KeyU" },
          // 他ユーザーの行は更新されない
          { id: foreign.id, keyCode: "KeyZ" },
        ]),
      }),
    );

    expect(res).toEqual({ success: true, message: "キー配置を保存しました" });
    expect((await findKeybinding(fwd.id))?.keyCode).toBe("KeyU");
    expect((await findKeybinding(back.id))?.keyCode).toBe("_UNBOUND");
    expect((await findKeybinding(left.id))?.keyCode).toBe("KeyA");
    expect((await findKeybinding(foreign.id))?.keyCode).toBe("KeyW");

    const snapshot = await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.id, preset.id),
    });
    const rows = JSON.parse(snapshot!.keybindingsData!) as { action: string; keyCode: string }[];
    expect(Object.fromEntries(rows.map((r) => [r.action, r.keyCode]))).toEqual({
      forward: "KeyU",
      back: "_UNBOUND",
      left: "KeyA",
    });
  });

  it("save-fingers は player_configs が無ければ作成し、あれば更新する（スナップショットも同期）", async () => {
    const { user, preset } = await setupUserWithActivePreset();

    await callAction(
      formDataOf({ intent: "save-fingers", presetId: preset.id, fingerAssignments: JSON.stringify({ KeyW: ["left-index"] }) }),
    );
    await callAction(
      formDataOf({ intent: "save-fingers", presetId: preset.id, fingerAssignments: JSON.stringify({ KeyW: ["left-middle"] }) }),
    );

    const configs = await db.query.playerConfigs.findMany({ where: eq(schema.playerConfigs.userId, user.id) });
    expect(configs).toHaveLength(1);
    expect(JSON.parse(configs[0].fingerAssignments!)).toEqual({ KeyW: ["left-middle"] });
    const snapshot = await db.query.configPresets.findFirst({ where: eq(schema.configPresets.id, preset.id) });
    expect(JSON.parse(snapshot!.fingerAssignmentsData!)).toEqual({ KeyW: ["left-middle"] });
    expect(snapshot!.playerConfigData).not.toBeNull();
  });

  it("save-custom-actions は削除・更新・追加を1バッチで適用し、スナップショットを同期する", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    const now = new Date();
    await db.insert(schema.customActions).values([
      { id: "ca-keep", userId: user.id, actionName: "old", category: "other", triggerKey: "KeyQ", displayOrder: 0, createdAt: now, updatedAt: now },
      { id: "ca-del", userId: user.id, actionName: "gone", category: "other", triggerKey: "KeyE", displayOrder: 1, createdAt: now, updatedAt: now },
    ]);

    const res = await callAction(
      formDataOf({
        intent: "save-custom-actions",
        presetId: preset.id,
        customActions: JSON.stringify([
          { id: "ca-del", _delete: true },
          { id: "ca-keep", actionName: "renamed", triggerKey: "KeyQ", category: "other" },
          { actionName: "fresh", triggerKey: "KeyR", category: "other" },
        ]),
      }),
    );

    expect(res.success).toBe(true);
    const rows = await db.query.customActions.findMany({ where: eq(schema.customActions.userId, user.id) });
    expect(rows.map((r) => r.actionName).sort()).toEqual(["fresh", "renamed"]);
    const snapshot = await db.query.configPresets.findFirst({ where: eq(schema.configPresets.id, preset.id) });
    expect(JSON.parse(snapshot!.customActionsData!)).toHaveLength(2);
  });
});

describe("action - 変更履歴の公開影響（preset_id）", () => {
  async function saveRemapsAndGetHistory(userId: string, presetId: string) {
    await callAction(
      formDataOf({
        intent: "save-all",
        presetId,
        remaps: JSON.stringify([{ sourceKey: "KeyA", targetKey: "KeyX", remapType: "trigger" }]),
      }),
    );
    return findKeybindingHistory(userId);
  }

  it("メイン＝編集中の保存は preset_id にメインの id を入れる", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    await db.update(schema.configPresets).set({ isMain: true }).where(eq(schema.configPresets.id, preset.id));

    const history = await saveRemapsAndGetHistory(user.id, preset.id);

    expect(history).toHaveLength(1);
    expect(history[0].presetId).toBe(preset.id);
  });

  it("メインでない編集中プリセットの保存は preset_id を入れない", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    await seedConfigPreset(db, user.id, { name: "公開用", isMain: true });

    const history = await saveRemapsAndGetHistory(user.id, preset.id);

    expect(history).toHaveLength(1);
    expect(history[0].presetId).toBeNull();
  });
});
