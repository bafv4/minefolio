// /me/presets の action（プリセットの作成・適用・削除）の回帰テスト。
//
// apply-preset / create-preset はライブ8テーブル（keybindings / key_remaps / player_configs /
// item_layouts / search_craft_loops / search_crafts / custom_keys / custom_actions）を
// 単一トランザクションで全削除してからスナップショットで復元する破壊的処理で、
// 復元漏れはユーザーの全設定の恒久消失に直結する。そのためモック DB ではなく実 DB
// （共有メモリ libSQL）でトランザクションごと通し、ライブテーブルの中身が完全に往復するか
// （行 id が毎回振り直される Loop の craftId 引き換えを含む）を検証する。
//
// セッションのみモックし、ルート本体は実 DB で動かす
// （app/routes/me/edit.test.ts / devices.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedKeybinding,
  seedPlayerConfig,
  schema,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { parseLoopSteps } from "@/lib/search-craft-loops";
import { DEFAULT_KEYBINDINGS } from "@/lib/defaults";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../presets";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

type ActionResult = { success?: boolean; message?: string; error?: string };

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/presets", {
    method: "POST",
    body: formData,
  });
}

async function callAction(entries: Record<string, string>): Promise<ActionResult> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return action({ request: makeRequest(fd), params: {}, context: {} } as never) as never;
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

/** ログイン済みユーザーを用意する */
async function setupUser(discordId = "discord-runner", slug = "runner") {
  const user = await seedUser(db, { slug, discordId });
  signInAs(discordId);
  return user;
}

// ---------------------------------------------------------------------------
// ライブテーブルの読み出し（比較用の正規化）
// ---------------------------------------------------------------------------

/**
 * ライブ8テーブルの内容を、行 id・タイムスタンプを落とした比較可能な形へ正規化して返す。
 * Loop のステップは craftId（復元のたびに新規採番される）を参照先クラフトの sequence へ
 * 置き換えるため、参照が切れていれば craftSeq: null として検出できる。
 */
async function readLiveConfig(userId: string) {
  const kbs = await db.query.keybindings.findMany({
    where: eq(schema.keybindings.userId, userId),
  });
  const remaps = await db.query.keyRemaps.findMany({
    where: eq(schema.keyRemaps.userId, userId),
  });
  const config = await db.query.playerConfigs.findFirst({
    where: eq(schema.playerConfigs.userId, userId),
  });
  const layouts = await db.query.itemLayouts.findMany({
    where: eq(schema.itemLayouts.userId, userId),
  });
  const crafts = await db.query.searchCrafts.findMany({
    where: eq(schema.searchCrafts.userId, userId),
  });
  const loops = await db.query.searchCraftLoops.findMany({
    where: eq(schema.searchCraftLoops.userId, userId),
  });
  const cks = await db.query.customKeys.findMany({
    where: eq(schema.customKeys.userId, userId),
  });
  const cas = await db.query.customActions.findMany({
    where: eq(schema.customActions.userId, userId),
  });

  const craftIdToSeq = new Map(crafts.map((c) => [c.id, c.sequence]));

  return {
    keybindings: kbs
      .map((kb) => ({ action: kb.action, keyCode: kb.keyCode, category: kb.category }))
      .sort((a, b) => a.action.localeCompare(b.action)),
    keyRemaps: remaps
      .map((r) => ({
        sourceKey: r.sourceKey,
        targetKey: r.targetKey,
        software: r.software,
        notes: r.notes,
        outputMode: r.outputMode,
        outputCharacter: r.outputCharacter,
        remapType: r.remapType,
      }))
      .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
    playerConfig: config
      ? {
          keyboardLayout: config.keyboardLayout,
          keyboardModel: config.keyboardModel,
          mouseDpi: config.mouseDpi,
          gameSensitivity: config.gameSensitivity,
          rawInput: config.rawInput,
          mouseAcceleration: config.mouseAcceleration,
          toggleSprint: config.toggleSprint,
          toggleSneak: config.toggleSneak,
          autoJump: config.autoJump,
          fov: config.fov,
          guiScale: config.guiScale,
          gameLanguage: config.gameLanguage,
          mouseModel: config.mouseModel,
          windowsSpeed: config.windowsSpeed,
          windowsSpeedMultiplier: config.windowsSpeedMultiplier,
          cm360: config.cm360,
          notes: config.notes,
          controllerSettings: config.controllerSettings,
          fingerAssignments: config.fingerAssignments,
        }
      : null,
    itemLayouts: layouts
      .map((l) => ({
        segment: l.segment,
        slots: l.slots,
        offhand: l.offhand,
        notes: l.notes,
        displayOrder: l.displayOrder,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder),
    searchCrafts: crafts
      .map((c) => ({
        sequence: c.sequence,
        items: c.items,
        keys: c.keys,
        searchStr: c.searchStr,
        comment: c.comment,
        timing: c.timing,
        withShift: c.withShift,
        searchVariations: c.searchVariations,
      }))
      .sort((a, b) => a.sequence - b.sequence),
    searchCraftLoops: [...loops]
      .sort((a, b) => a.sequence - b.sequence)
      .map((loop) => ({
        sequence: loop.sequence,
        comment: loop.comment,
        timing: loop.timing,
        steps: parseLoopSteps(loop.steps).map((s) => ({
          craftSeq: craftIdToSeq.get(s.craftId) ?? null,
          transition: s.transition,
          variationIndex: s.variationIndex ?? 0,
        })),
      })),
    customKeys: cks
      .map((ck) => ({
        keyCode: ck.keyCode,
        keyName: ck.keyName,
        category: ck.category,
        position: ck.position,
        size: ck.size,
        notes: ck.notes,
      }))
      .sort((a, b) => a.keyCode.localeCompare(b.keyCode)),
    customActions: cas
      .map((ca) => ({
        actionName: ca.actionName,
        description: ca.description,
        category: ca.category,
        triggerKey: ca.triggerKey,
        displayOrder: ca.displayOrder,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder),
  };
}

const EMPTY_LIVE = {
  keybindings: [],
  keyRemaps: [],
  playerConfig: null,
  itemLayouts: [],
  searchCrafts: [],
  searchCraftLoops: [],
  customKeys: [],
  customActions: [],
};

// ---------------------------------------------------------------------------
// ライブテーブルのシード（全8テーブルを埋める）
// ---------------------------------------------------------------------------

const CRAFT1_VARIATIONS = [
  { str: "en", withShift: false },
  { str: "er", withShift: true },
];
const CRAFT2_VARIATIONS = [
  { str: "eni", withShift: false },
  { str: "ens", withShift: false },
];

/** ライブ8テーブルすべてにデータを入れる（Loop は craftId 参照を2本張る） */
async function seedFullLiveConfig(userId: string) {
  await seedKeybinding(db, userId, {
    action: "forward",
    keyCode: "KeyW",
    category: "movement",
  });
  await seedKeybinding(db, userId, {
    action: "attack",
    keyCode: "Mouse0",
    category: "combat",
  });

  await db.insert(schema.keyRemaps).values([
    {
      userId,
      sourceKey: "CapsLock",
      targetKey: "ControlLeft",
      software: "AutoHotkey",
      notes: "スプリント用",
      outputMode: "key",
      outputCharacter: null,
      remapType: "all",
    },
    {
      userId,
      sourceKey: "KeyZ",
      targetKey: null,
      software: null,
      notes: null,
      outputMode: "character",
      outputCharacter: "@",
      remapType: "chat",
    },
  ]);

  await seedPlayerConfig(db, userId, {
    keyboardLayout: "US",
    keyboardModel: "HHKB",
    mouseDpi: 800,
    gameSensitivity: 0.5,
    rawInput: true,
    mouseAcceleration: false,
    toggleSprint: false,
    toggleSneak: null,
    autoJump: false,
    fov: 90,
    guiScale: 2,
    gameLanguage: "ja_jp",
    mouseModel: "GPX",
    windowsSpeed: 11,
    windowsSpeedMultiplier: null,
    cm360: 30.5,
    notes: "ライブのメモ",
    controllerSettings: null,
    fingerAssignments: JSON.stringify({ KeyW: "leftIndex" }),
  });

  await db.insert(schema.itemLayouts).values([
    {
      userId,
      segment: "overworld",
      slots: JSON.stringify(["stone_pickaxe", null]),
      offhand: null,
      notes: "OW",
      displayOrder: 0,
    },
    {
      userId,
      segment: "nether",
      slots: JSON.stringify(["obsidian"]),
      offhand: JSON.stringify(["shield"]),
      notes: null,
      displayOrder: 1,
    },
  ]);

  const [craft1] = await db
    .insert(schema.searchCrafts)
    .values({
      userId,
      sequence: 1,
      items: JSON.stringify(["ender_eye"]),
      keys: JSON.stringify(["KeyE"]),
      searchStr: "en",
      comment: "アイ",
      timing: "bastion",
      withShift: false,
      searchVariations: JSON.stringify(CRAFT1_VARIATIONS),
    })
    .returning();
  const [craft2] = await db
    .insert(schema.searchCrafts)
    .values({
      userId,
      sequence: 2,
      items: JSON.stringify(["ender_chest"]),
      keys: JSON.stringify(["KeyE", "KeyN"]),
      searchStr: "eni",
      comment: null,
      timing: null,
      withShift: false,
      searchVariations: JSON.stringify(CRAFT2_VARIATIONS),
    })
    .returning();

  await db.insert(schema.searchCraftLoops).values([
    {
      userId,
      sequence: 1,
      steps: JSON.stringify([
        { craftId: craft1.id, transition: null, variationIndex: 0 },
        { craftId: craft2.id, transition: { type: "backspace", bsCount: 0 }, variationIndex: 1 },
      ]),
      comment: "en → ens",
      timing: "bastion",
    },
    {
      userId,
      sequence: 2,
      steps: JSON.stringify([
        { craftId: craft2.id, transition: null, variationIndex: 0 },
        { craftId: craft1.id, transition: { type: "selectAll" }, variationIndex: 1 },
      ]),
      comment: null,
      timing: null,
    },
  ]);

  await db.insert(schema.customKeys).values({
    userId,
    keyCode: "Mouse4",
    keyName: "サイドボタン",
    category: "mouse",
    position: JSON.stringify({ x: 10, y: 20 }),
    size: JSON.stringify({ width: 1, height: 1 }),
    notes: "親指",
  });

  await db.insert(schema.customActions).values({
    userId,
    actionName: "DPI切替",
    description: "感度を切り替える",
    category: "macro",
    triggerKey: "Ctrl+KeyX",
    displayOrder: 0,
  });

  return { craft1, craft2 };
}

/** 別プリセット（apply の切替先）を直接 insert する。data 未指定の列は null＝「空」を意味する */
async function insertPreset(
  userId: string,
  overrides: Partial<typeof schema.configPresets.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.configPresets)
    .values({ userId, name: "Other", ...overrides })
    .returning();
  return row;
}

async function findPreset(id: string) {
  return db.query.configPresets.findFirst({ where: eq(schema.configPresets.id, id) });
}

// ---------------------------------------------------------------------------
// 1. ラウンドトリップ（最重要）
// ---------------------------------------------------------------------------

describe("action - apply-preset のラウンドトリップ", () => {
  it("ライブ全8テーブル → create-preset → 別プリセット適用 → 再適用でライブが完全復元される", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);

    // 現行ライブからプリセットAを作成（この時点でライブは同内容に再構築される）
    const created = await callAction({
      intent: "create-preset",
      name: "A",
      description: "ラウンドトリップ用",
      sourceType: "current",
    });
    expect(created).toEqual({
      success: true,
      message: "プリセット「A」を作成して適用しました",
    });

    const presetA = await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.userId, user.id),
    });
    expect(presetA).toBeDefined();

    // 比較の基準は「create-preset 直後のライブ」。往復で失われないことを見る
    const baseline = await readLiveConfig(user.id);
    // 基準そのものがシードした内容を保持していることも確認する（空同士の一致を防ぐ）
    expect(baseline.keybindings).toHaveLength(2);
    expect(baseline.keyRemaps).toHaveLength(2);
    expect(baseline.itemLayouts).toHaveLength(2);
    expect(baseline.searchCrafts).toHaveLength(2);
    expect(baseline.searchCraftLoops).toHaveLength(2);
    expect(baseline.customKeys).toHaveLength(1);
    expect(baseline.customActions).toHaveLength(1);
    expect(baseline.playerConfig?.fingerAssignments).toBe(JSON.stringify({ KeyW: "leftIndex" }));
    // Loop の参照はすべて解決できている（craftSeq が null にならない）
    expect(baseline.searchCraftLoops[0].steps).toEqual([
      { craftSeq: 1, transition: null, variationIndex: 0 },
      { craftSeq: 2, transition: { type: "backspace", bsCount: 0 }, variationIndex: 1 },
    ]);
    expect(baseline.searchCraftLoops[1].steps).toEqual([
      { craftSeq: 2, transition: null, variationIndex: 0 },
      { craftSeq: 1, transition: { type: "selectAll" }, variationIndex: 1 },
    ]);

    // 別プリセット（キーバインド1件だけ）へ切り替える
    const presetB = await insertPreset(user.id, {
      name: "B",
      keybindingsData: JSON.stringify([
        { action: "forward", keyCode: "KeyE", category: "movement" },
      ]),
    });
    const appliedB = await callAction({ intent: "apply-preset", presetId: presetB.id });
    expect(appliedB).toEqual({ success: true, message: "プリセット「B」を適用しました" });

    // B は他種別を持たないので、ライブは B の内容だけに置き換わる（全ワイプの確認）
    expect(await readLiveConfig(user.id)).toEqual({
      ...EMPTY_LIVE,
      keybindings: [{ action: "forward", keyCode: "KeyE", category: "movement" }],
    });

    // A を再適用するとライブが完全復元される（craftId は新規採番だが参照は保たれる）
    const appliedA = await callAction({ intent: "apply-preset", presetId: presetA!.id });
    expect(appliedA).toEqual({ success: true, message: "プリセット「A」を適用しました" });

    expect(await readLiveConfig(user.id)).toEqual(baseline);
  });

  it("再適用したプリセットだけが編集中（isActive）になる", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);
    await callAction({ intent: "create-preset", name: "A", sourceType: "current" });
    const presetA = (await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.userId, user.id),
    }))!;
    const presetB = await insertPreset(user.id, { name: "B" });

    await callAction({ intent: "apply-preset", presetId: presetB.id });
    expect((await findPreset(presetA.id))?.isActive).toBe(false);
    expect((await findPreset(presetB.id))?.isActive).toBe(true);

    await callAction({ intent: "apply-preset", presetId: presetA.id });
    expect((await findPreset(presetA.id))?.isActive).toBe(true);
    expect((await findPreset(presetB.id))?.isActive).toBe(false);
  });

  it("他ユーザーのプリセットは適用できず、自分のライブテーブルも変化しない", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);
    await callAction({ intent: "create-preset", name: "A", sourceType: "current" });
    const before = await readLiveConfig(user.id);

    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    const otherPreset = await insertPreset(other.id, { name: "他人のプリセット" });

    const res = await callAction({ intent: "apply-preset", presetId: otherPreset.id });

    expect(res).toEqual({ error: "プリセットが見つかりません" });
    expect(await readLiveConfig(user.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 1b. 破損・旧世代スナップショットに対する耐性
//
// 復元 insert が UNIQUE 制約等でこけるとトランザクション全体が巻き戻り、
// 「プリセット切替が恒久的にできない」状態になる。実装側にその回避（dedupe・
// sequence 振り直し）が入っているので、回避が効いていることを実 DB で確認する。
// ---------------------------------------------------------------------------

describe("action - apply-preset のスナップショット耐性", () => {
  it("remapType が正規化衝突する旧スナップショットでも切替が失敗せず、先勝ちで1件だけ復元する", async () => {
    const user = await setupUser();
    // 旧スナップショット（remapType 欠落 → unset に正規化）と明示 unset が
    // UNIQUE (userId, sourceKey, remapType) で衝突するケース
    const preset = await insertPreset(user.id, {
      name: "旧世代",
      remapsData: JSON.stringify([
        { sourceKey: "CapsLock", targetKey: "ControlLeft", software: null, notes: null },
        {
          sourceKey: "CapsLock",
          targetKey: "AltLeft",
          software: null,
          notes: null,
          remapType: "unset",
        },
      ]),
    });

    const res = await callAction({ intent: "apply-preset", presetId: preset.id });

    expect(res).toEqual({ success: true, message: "プリセット「旧世代」を適用しました" });
    const live = await readLiveConfig(user.id);
    expect(live.keyRemaps).toEqual([
      {
        sourceKey: "CapsLock",
        targetKey: "ControlLeft",
        software: null,
        notes: null,
        outputMode: "key",
        outputCharacter: null,
        remapType: "unset",
      },
    ]);
  });

  it("targetKey がセンチネル（__...__）や空文字のリマップは null で復元する", async () => {
    const user = await setupUser();
    const preset = await insertPreset(user.id, {
      name: "センチネル",
      remapsData: JSON.stringify([
        { sourceKey: "KeyA", targetKey: "__none__", software: null, notes: null, remapType: "all" },
        { sourceKey: "KeyB", targetKey: "", software: null, notes: null, remapType: "all" },
      ]),
    });

    await callAction({ intent: "apply-preset", presetId: preset.id });

    const live = await readLiveConfig(user.id);
    expect(live.keyRemaps.map((r) => ({ sourceKey: r.sourceKey, targetKey: r.targetKey }))).toEqual([
      { sourceKey: "KeyA", targetKey: null },
      { sourceKey: "KeyB", targetKey: null },
    ]);
  });

  it("Loop の sequence が重複したスナップショットでも unique index に当たらず全件復元する", async () => {
    const user = await setupUser();
    const preset = await insertPreset(user.id, {
      name: "重複sequence",
      searchCraftsData: JSON.stringify([
        { sequence: 1, items: "[]", keys: "[]", searchStr: "en", comment: null },
        { sequence: 2, items: "[]", keys: "[]", searchStr: "eni", comment: null },
      ]),
      // 本来ありえないが、過去データ・破損で起こると復元 insert が
      // UNIQUE (userId, sequence) で落ちてトランザクションごと失敗する
      searchCraftLoopsData: JSON.stringify([
        {
          sequence: 1,
          steps: [
            { craftSeq: 1, transition: null },
            { craftSeq: 2, transition: { type: "backspace", bsCount: 0 } },
          ],
          comment: "A",
          timing: null,
        },
        {
          sequence: 1,
          steps: [
            { craftSeq: 2, transition: null },
            { craftSeq: 1, transition: { type: "selectAll" } },
          ],
          comment: "B",
          timing: null,
        },
      ]),
    });

    const res = await callAction({ intent: "apply-preset", presetId: preset.id });

    expect(res).toEqual({ success: true, message: "プリセット「重複sequence」を適用しました" });
    const live = await readLiveConfig(user.id);
    // sequence は挿入順の1始まりへ振り直される
    expect(live.searchCraftLoops.map((l) => ({ sequence: l.sequence, comment: l.comment }))).toEqual(
      [
        { sequence: 1, comment: "A" },
        { sequence: 2, comment: "B" },
      ],
    );
    expect(live.searchCraftLoops[0].steps).toEqual([
      { craftSeq: 1, transition: null, variationIndex: 0 },
      { craftSeq: 2, transition: { type: "backspace", bsCount: 0 }, variationIndex: 0 },
    ]);
  });

  it("Loop のスナップショットに参照切れステップがあれば除去し、2件未満になった Loop は捨てる", async () => {
    const user = await setupUser();
    const preset = await insertPreset(user.id, {
      name: "参照切れ",
      searchCraftsData: JSON.stringify([
        { sequence: 1, items: "[]", keys: "[]", searchStr: "en", comment: null },
      ]),
      searchCraftLoopsData: JSON.stringify([
        {
          sequence: 1,
          steps: [
            { craftSeq: 1, transition: null },
            { craftSeq: 99, transition: { type: "selectAll" } },
          ],
          comment: null,
          timing: null,
        },
      ]),
    });

    await callAction({ intent: "apply-preset", presetId: preset.id });

    const live = await readLiveConfig(user.id);
    expect(live.searchCrafts).toHaveLength(1);
    expect(live.searchCraftLoops).toEqual([]);
  });

  it("playerConfigData が null でも fingerAssignmentsData があれば player_configs 行を作る", async () => {
    const user = await setupUser();
    const preset = await insertPreset(user.id, {
      name: "指割り当てのみ",
      fingerAssignmentsData: JSON.stringify({ KeyW: "leftIndex" }),
    });

    await callAction({ intent: "apply-preset", presetId: preset.id });

    const live = await readLiveConfig(user.id);
    expect(live.playerConfig).not.toBeNull();
    expect(live.playerConfig!.fingerAssignments).toBe(JSON.stringify({ KeyW: "leftIndex" }));
    // 設定値そのものはスナップショットどおり未設定（?? でデフォルトを注入しない）
    expect(live.playerConfig!.keyboardLayout).toBeNull();
    expect(live.playerConfig!.rawInput).toBeNull();
    expect(live.playerConfig!.mouseAcceleration).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. delete-preset の不変条件
// ---------------------------------------------------------------------------

describe("action - delete-preset の不変条件", () => {
  /** メイン / 編集中 / どちらでもない の3件を持つユーザーを用意する */
  async function setupThreePresets() {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);
    const main = await insertPreset(user.id, { name: "メイン", isMain: true });
    const active = await insertPreset(user.id, { name: "編集中", isActive: true });
    const plain = await insertPreset(user.id, { name: "その他" });
    return { user, main, active, plain };
  }

  it("他のプリセットが残る場合、メインのプリセットは削除できない", async () => {
    const { main } = await setupThreePresets();

    const res = await callAction({ intent: "delete-preset", presetId: main.id });

    expect(res).toEqual({
      error: "メインのプリセットは削除できません。先に別のプリセットをメインに設定してください。",
    });
    expect(await findPreset(main.id)).toBeDefined();
  });

  it("他のプリセットが残る場合、編集中のプリセットは削除できない", async () => {
    const { active } = await setupThreePresets();

    const res = await callAction({ intent: "delete-preset", presetId: active.id });

    expect(res).toEqual({
      error:
        "編集中のプリセットは削除できません。別のプリセットを編集対象にしてから削除してください。",
    });
    expect(await findPreset(active.id)).toBeDefined();
  });

  it("メインでも編集中でもないプリセットは削除でき、ライブテーブルは無傷のまま残る", async () => {
    const { user, plain } = await setupThreePresets();
    const before = await readLiveConfig(user.id);

    const res = await callAction({ intent: "delete-preset", presetId: plain.id });

    expect(res).toEqual({ success: true, message: "プリセットを削除しました" });
    expect(await findPreset(plain.id)).toBeUndefined();
    expect(await readLiveConfig(user.id)).toEqual(before);
    const history = await db.query.configHistory.findMany({
      where: eq(schema.configHistory.userId, user.id),
    });
    expect(history.some((h) => h.changeDescription === "プリセット「その他」を削除")).toBe(true);
  });

  it("唯一のプリセットは（メインかつ編集中でも）削除でき、ライブテーブルも全ワイプされる", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);
    const only = await insertPreset(user.id, {
      name: "唯一",
      isMain: true,
      isActive: true,
    });

    const res = await callAction({ intent: "delete-preset", presetId: only.id });

    expect(res).toEqual({ success: true, message: "プリセットを削除しました" });
    expect(await findPreset(only.id)).toBeUndefined();
    expect(await readLiveConfig(user.id)).toEqual(EMPTY_LIVE);
  });

  it("他ユーザーのプリセットは削除できない", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);
    await insertPreset(user.id, { name: "自分の", isActive: true, isMain: true });
    const before = await readLiveConfig(user.id);

    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    const otherPreset = await insertPreset(other.id, { name: "他人の" });

    const res = await callAction({ intent: "delete-preset", presetId: otherPreset.id });

    expect(res).toEqual({ error: "プリセットが見つかりません" });
    expect(await findPreset(otherPreset.id)).toBeDefined();
    expect(await readLiveConfig(user.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 3. create-preset の所有権チェック
// ---------------------------------------------------------------------------

describe("action - create-preset の所有権チェック", () => {
  it("他ユーザーの sourcePresetId を指定するとエラーになり、ライブテーブルは削除されない", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);
    const before = await readLiveConfig(user.id);

    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    const otherPreset = await insertPreset(other.id, {
      name: "他人のプリセット",
      keybindingsData: JSON.stringify([
        { action: "forward", keyCode: "KeyE", category: "movement" },
      ]),
    });

    const res = await callAction({
      intent: "create-preset",
      name: "盗用",
      sourceType: "copy",
      sourcePresetId: otherPreset.id,
    });

    expect(res).toEqual({ error: "コピー元のプリセットが見つかりません" });
    // ライブ全削除はトランザクション内で起きるため、拒否時に設定が消えていないことを必ず確認する
    expect(await readLiveConfig(user.id)).toEqual(before);
    const presets = await db.query.configPresets.findMany({
      where: eq(schema.configPresets.userId, user.id),
    });
    expect(presets).toHaveLength(0);
  });

  it("存在しない sourcePresetId もエラーになる", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);

    const res = await callAction({
      intent: "create-preset",
      name: "壊れたコピー",
      sourceType: "copy",
      sourcePresetId: "missing-preset-id",
    });

    expect(res).toEqual({ error: "コピー元のプリセットが見つかりません" });
  });

  it("名前が空白のみの場合は作成しない", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);

    const res = await callAction({ intent: "create-preset", name: "   ", sourceType: "current" });

    expect(res).toEqual({ error: "プリセット名を入力してください" });
    const presets = await db.query.configPresets.findMany({
      where: eq(schema.configPresets.userId, user.id),
    });
    expect(presets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. create-preset の3ソース分岐
// ---------------------------------------------------------------------------

describe("action - create-preset のソース別スナップショット", () => {
  it("current: 現行ライブの全種別がスナップショットへ入り、ライブもそのまま残る", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);

    await callAction({ intent: "create-preset", name: "現行から", sourceType: "current" });

    const preset = (await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.userId, user.id),
    }))!;
    expect(preset.name).toBe("現行から");
    expect(preset.isActive).toBe(true);
    // メイン未設定ユーザーの最初の1件は自動でメインになる
    expect(preset.isMain).toBe(true);

    expect(JSON.parse(preset.keybindingsData!)).toEqual([
      { action: "forward", keyCode: "KeyW", category: "movement" },
      { action: "attack", keyCode: "Mouse0", category: "combat" },
    ]);
    expect(JSON.parse(preset.playerConfigData!)).toMatchObject({
      keyboardLayout: "US",
      mouseDpi: 800,
      gameSensitivity: 0.5,
      cm360: 30.5,
    });
    expect(preset.fingerAssignmentsData).toBe(JSON.stringify({ KeyW: "leftIndex" }));
    expect(JSON.parse(preset.remapsData!)).toHaveLength(2);
    expect(JSON.parse(preset.itemLayoutsData!)).toHaveLength(2);
    expect(JSON.parse(preset.searchCraftsData!)).toHaveLength(2);
    expect(JSON.parse(preset.customKeysData!)).toHaveLength(1);
    expect(JSON.parse(preset.customActionsData!)).toHaveLength(1);
    // Loop は craftId ではなく同一スナップショット内の sequence（craftSeq）で参照する
    expect(JSON.parse(preset.searchCraftLoopsData!)).toEqual([
      {
        sequence: 1,
        steps: [
          { craftSeq: 1, transition: null },
          { craftSeq: 2, transition: { type: "backspace", bsCount: 0 }, variationIndex: 1 },
        ],
        comment: "en → ens",
        timing: "bastion",
      },
      {
        sequence: 2,
        steps: [
          { craftSeq: 2, transition: null },
          { craftSeq: 1, transition: { type: "selectAll" }, variationIndex: 1 },
        ],
        comment: null,
        timing: null,
      },
    ]);
  });

  it("copy: コピー元のスナップショット列をそのまま引き継ぎ、ライブへ展開する", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);
    await callAction({ intent: "create-preset", name: "元", sourceType: "current" });
    const source = (await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.userId, user.id),
    }))!;
    const liveOfSource = await readLiveConfig(user.id);

    const res = await callAction({
      intent: "create-preset",
      name: "コピー先",
      sourceType: "copy",
      sourcePresetId: source.id,
    });
    expect(res).toEqual({
      success: true,
      message: "プリセット「コピー先」を作成して適用しました",
    });

    const copy = (await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.name, "コピー先"),
    }))!;
    // スナップショット列はコピー元とバイト同一
    expect(copy.keybindingsData).toBe(source.keybindingsData);
    expect(copy.playerConfigData).toBe(source.playerConfigData);
    expect(copy.remapsData).toBe(source.remapsData);
    expect(copy.fingerAssignmentsData).toBe(source.fingerAssignmentsData);
    expect(copy.itemLayoutsData).toBe(source.itemLayoutsData);
    expect(copy.searchCraftsData).toBe(source.searchCraftsData);
    expect(copy.searchCraftLoopsData).toBe(source.searchCraftLoopsData);
    expect(copy.customKeysData).toBe(source.customKeysData);
    expect(copy.customActionsData).toBe(source.customActionsData);
    // 既にメインがあるので、コピーは編集対象になるだけでメインにはならない
    expect(copy.isActive).toBe(true);
    expect(copy.isMain).toBe(false);
    expect((await findPreset(source.id))?.isActive).toBe(false);

    // ライブもコピー元と同じ内容へ展開される
    expect(await readLiveConfig(user.id)).toEqual(liveOfSource);
  });

  it("default: ライブが空のユーザーはデフォルトキーバインドで作成される", async () => {
    const user = await setupUser();

    const res = await callAction({ intent: "create-preset", name: "初期", sourceType: "current" });
    expect(res).toEqual({ success: true, message: "プリセット「初期」を作成して適用しました" });

    const preset = (await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.userId, user.id),
    }))!;
    expect(JSON.parse(preset.keybindingsData!)).toEqual(
      DEFAULT_KEYBINDINGS.map((kb) => ({
        action: kb.action,
        keyCode: kb.keyCode,
        category: kb.category,
      })),
    );
    expect(JSON.parse(preset.playerConfigData!)).toMatchObject({
      keyboardLayout: "US",
      rawInput: true,
      mouseAcceleration: false,
    });
    expect(preset.remapsData).toBeNull();
    expect(preset.itemLayoutsData).toBeNull();
    expect(preset.searchCraftsData).toBeNull();
    expect(preset.searchCraftLoopsData).toBeNull();
    expect(preset.customKeysData).toBeNull();
    expect(preset.customActionsData).toBeNull();

    const live = await readLiveConfig(user.id);
    expect(live.keybindings).toHaveLength(DEFAULT_KEYBINDINGS.length);
    expect(live.playerConfig).toMatchObject({
      keyboardLayout: "US",
      rawInput: true,
      mouseAcceleration: false,
    });
  });

  it("キーバインドを持たずアイテム配置だけがあるユーザーもデフォルトへ落ちない", async () => {
    const user = await setupUser();
    await db.insert(schema.itemLayouts).values({
      userId: user.id,
      segment: "overworld",
      slots: JSON.stringify(["stone"]),
      offhand: null,
      notes: null,
      displayOrder: 0,
    });

    await callAction({ intent: "create-preset", name: "配置のみ", sourceType: "current" });

    const preset = (await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.userId, user.id),
    }))!;
    expect(preset.keybindingsData).toBeNull();
    expect(JSON.parse(preset.itemLayoutsData!)).toHaveLength(1);
    const live = await readLiveConfig(user.id);
    expect(live.keybindings).toHaveLength(0);
    expect(live.itemLayouts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. その他の intent
// ---------------------------------------------------------------------------

describe("action - set-main / 未知の intent", () => {
  it("set-main は is_main を排他的に付け替え、編集中フラグとライブテーブルには触れない", async () => {
    const user = await setupUser();
    await seedFullLiveConfig(user.id);
    const main = await insertPreset(user.id, { name: "旧メイン", isMain: true, isActive: true });
    const other = await insertPreset(user.id, { name: "新メイン" });
    const before = await readLiveConfig(user.id);

    const res = await callAction({ intent: "set-main", presetId: other.id });

    expect(res).toEqual({
      success: true,
      message: "メインのプリセットを設定しました。プロフィールにはこのプリセットが表示されます",
    });
    expect((await findPreset(main.id))?.isMain).toBe(false);
    expect((await findPreset(main.id))?.isActive).toBe(true);
    expect((await findPreset(other.id))?.isMain).toBe(true);
    expect((await findPreset(other.id))?.isActive).toBe(false);
    expect(await readLiveConfig(user.id)).toEqual(before);
  });

  it("未知の intent はエラーを返す", async () => {
    await setupUser();

    expect(await callAction({ intent: "bogus" })).toEqual({ error: "不明な操作です" });
  });
});
