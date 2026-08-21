// app/lib/preset-utils.ts の「DB を触るオーケストレーション部分」の回帰テスト。
//
// syncActivePresetSnapshot / assertPresetIsActive / createPresetFromImport は
// presets / keybindings / items / search-craft / import の5ルートが共有する要（かなめ）で、
// ここが壊れると「編集した内容がどのプリセットにも残らない」「別タブの切替を検出できず
// 他プリセットへ書き込む」といった静かなデータ損失になる。
//
// シリアライズ／デコードの純粋関数は preset-utils.test.ts / preset-read.test.ts が覆っているため、
// このファイルは重複させず、実 DB でしか確認できない挙動（アクティブ判定・列の書き分け・
// トランザクション）だけを対象にする。
//
// createPreset() 系は db.transaction() を使うため、共有メモリ DB（SHARED_MEMORY_URL）が必須
// （理由は helpers/test-db.ts の createTransactionalTestDb のコメント参照）。
import { describe, it, expect, beforeEach } from "vitest";
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
} from "./helpers/test-db";
import {
  syncActivePresetSnapshot,
  assertPresetIsActive,
  createPresetFromImport,
  PresetMismatchError,
} from "../preset-utils";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

async function findPreset(id: string) {
  return db.query.configPresets.findFirst({ where: eq(schema.configPresets.id, id) });
}

// ---------------------------------------------------------------------------
// syncActivePresetSnapshot
// ---------------------------------------------------------------------------

describe("syncActivePresetSnapshot", () => {
  it("指定種別のライブ内容をアクティブプリセットのスナップショット列へ反映する", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, { isActive: true });
    await seedKeybinding(db, user.id, {
      action: "forward",
      keyCode: "KeyW",
      category: "movement",
    });

    await syncActivePresetSnapshot(db, user.id, ["keybindings"]);

    const updated = await findPreset(preset.id);
    expect(JSON.parse(updated!.keybindingsData!)).toEqual([
      { action: "forward", keyCode: "KeyW", category: "movement" },
    ]);
  });

  it("kinds に含まれない種別の列は書き換えない", async () => {
    const user = await seedUser(db);
    const remapsData = JSON.stringify([
      { sourceKey: "CapsLock", targetKey: "ControlLeft", software: null, notes: null },
    ]);
    const preset = await seedConfigPreset(db, user.id, { isActive: true, remapsData });
    await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW" });
    // ライブのリマップは空だが、kinds に "remaps" を渡していないので列は残るべき
    await syncActivePresetSnapshot(db, user.id, ["keybindings"]);

    const updated = await findPreset(preset.id);
    expect(updated!.remapsData).toBe(remapsData);
    expect(updated!.keybindingsData).not.toBeNull();
  });

  it("ライブが空の種別はスナップショット列を null にする（古い内容を残さない）", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, {
      isActive: true,
      keybindingsData: JSON.stringify([
        { action: "forward", keyCode: "KeyW", category: "movement" },
      ]),
    });

    await syncActivePresetSnapshot(db, user.id, ["keybindings"]);

    expect((await findPreset(preset.id))!.keybindingsData).toBeNull();
  });

  it("アクティブプリセットが無ければ no-op（非アクティブなプリセットには書き込まない）", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, { isActive: false });
    await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW" });

    await syncActivePresetSnapshot(db, user.id, ["keybindings"]);

    const updated = await findPreset(preset.id);
    expect(updated!.keybindingsData).toBeNull();
    expect(updated!.updatedAt.getTime()).toBe(preset.updatedAt.getTime());
  });

  it("kinds が空配列なら何もしない（updatedAt も進めない）", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, { isActive: true });
    await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW" });

    await syncActivePresetSnapshot(db, user.id, []);

    const updated = await findPreset(preset.id);
    expect(updated!.keybindingsData).toBeNull();
    expect(updated!.updatedAt.getTime()).toBe(preset.updatedAt.getTime());
  });

  it("他ユーザーのアクティブプリセットは更新しない", async () => {
    const me = await seedUser(db, { slug: "me", discordId: "discord-me" });
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    const myPreset = await seedConfigPreset(db, me.id, { isActive: true });
    const otherPreset = await seedConfigPreset(db, other.id, { isActive: true });
    await seedKeybinding(db, me.id, { action: "forward", keyCode: "KeyW" });

    await syncActivePresetSnapshot(db, me.id, ["keybindings"]);

    expect((await findPreset(myPreset.id))!.keybindingsData).not.toBeNull();
    expect((await findPreset(otherPreset.id))!.keybindingsData).toBeNull();
  });

  it("playerConfig と fingers は独立した列に書き分ける", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, { isActive: true });
    await seedPlayerConfig(db, user.id, {
      keyboardLayout: "US",
      mouseDpi: 1600,
      fingerAssignments: JSON.stringify({ KeyW: "leftIndex" }),
    });

    await syncActivePresetSnapshot(db, user.id, ["fingers"]);
    let updated = await findPreset(preset.id);
    expect(updated!.fingerAssignmentsData).toBe(JSON.stringify({ KeyW: "leftIndex" }));
    expect(updated!.playerConfigData).toBeNull();

    await syncActivePresetSnapshot(db, user.id, ["playerConfig"]);
    updated = await findPreset(preset.id);
    expect(JSON.parse(updated!.playerConfigData!)).toMatchObject({
      keyboardLayout: "US",
      mouseDpi: 1600,
    });
  });

  it("searchCrafts 種別は crafts と loops の両列を同時に書く（craftId → craftSeq 変換つき）", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, { isActive: true });
    const [craft1] = await db
      .insert(schema.searchCrafts)
      .values({
        userId: user.id,
        sequence: 1,
        items: JSON.stringify(["ender_eye"]),
        keys: JSON.stringify(["KeyE"]),
        searchStr: "en",
      })
      .returning();
    const [craft2] = await db
      .insert(schema.searchCrafts)
      .values({
        userId: user.id,
        sequence: 2,
        items: JSON.stringify(["ender_chest"]),
        keys: JSON.stringify(["KeyE"]),
        searchStr: "eni",
      })
      .returning();
    await db.insert(schema.searchCraftLoops).values({
      userId: user.id,
      sequence: 1,
      steps: JSON.stringify([
        { craftId: craft1.id, transition: null },
        { craftId: craft2.id, transition: { type: "backspace", bsCount: 0 } },
      ]),
      comment: null,
    });

    await syncActivePresetSnapshot(db, user.id, ["searchCrafts"]);

    const updated = await findPreset(preset.id);
    expect(JSON.parse(updated!.searchCraftsData!)).toHaveLength(2);
    expect(JSON.parse(updated!.searchCraftLoopsData!)).toEqual([
      {
        sequence: 1,
        steps: [
          { craftSeq: 1, transition: null },
          { craftSeq: 2, transition: { type: "backspace", bsCount: 0 } },
        ],
        comment: null,
        timing: null,
      },
    ]);
  });

  it("クラフトが全削除されていれば、残った Loop 行があっても両列とも null になる（スキュー防止）", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, {
      isActive: true,
      searchCraftsData: JSON.stringify([{ sequence: 1, items: "[]", keys: "[]" }]),
      searchCraftLoopsData: JSON.stringify([{ sequence: 1, steps: [], comment: null }]),
    });
    // crafts は無いが loops 行だけ残っている状態（参照切れ）
    await db.insert(schema.searchCraftLoops).values({
      userId: user.id,
      sequence: 1,
      steps: JSON.stringify([
        { craftId: "gone-1", transition: null },
        { craftId: "gone-2", transition: { type: "selectAll" } },
      ]),
      comment: null,
    });

    await syncActivePresetSnapshot(db, user.id, ["searchCrafts"]);

    const updated = await findPreset(preset.id);
    expect(updated!.searchCraftsData).toBeNull();
    expect(updated!.searchCraftLoopsData).toBeNull();
  });

  it("複数種別を一度に渡すとまとめて反映する", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, { isActive: true });
    await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW" });
    await db.insert(schema.keyRemaps).values({
      userId: user.id,
      sourceKey: "CapsLock",
      targetKey: "ControlLeft",
      remapType: "all",
    });
    await db.insert(schema.customActions).values({
      userId: user.id,
      actionName: "DPI切替",
      category: "macro",
      triggerKey: "Ctrl+KeyX",
    });

    await syncActivePresetSnapshot(db, user.id, ["keybindings", "remaps", "customActions"]);

    const updated = await findPreset(preset.id);
    expect(JSON.parse(updated!.keybindingsData!)).toHaveLength(1);
    expect(JSON.parse(updated!.remapsData!)).toHaveLength(1);
    expect(JSON.parse(updated!.customActionsData!)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// assertPresetIsActive
// ---------------------------------------------------------------------------

describe("assertPresetIsActive", () => {
  it("アクティブプリセットと一致すれば通過する", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, { isActive: true });

    await expect(assertPresetIsActive(db, user.id, preset.id)).resolves.toBeUndefined();
  });

  it("アクティブプリセットと不一致なら PresetMismatchError を投げる（別タブでの切替検出）", async () => {
    const user = await seedUser(db);
    await seedConfigPreset(db, user.id, { name: "Active", isActive: true });
    const stale = await seedConfigPreset(db, user.id, { name: "Stale", isActive: false });

    await expect(assertPresetIsActive(db, user.id, stale.id)).rejects.toThrow(PresetMismatchError);
  });

  it("アクティブプリセットが1件も無ければ PresetMismatchError を投げる", async () => {
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, { isActive: false });

    await expect(assertPresetIsActive(db, user.id, preset.id)).rejects.toThrow(PresetMismatchError);
  });

  it("他ユーザーのアクティブプリセットの id では通過しない", async () => {
    const me = await seedUser(db, { slug: "me", discordId: "discord-me" });
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    await seedConfigPreset(db, me.id, { isActive: true });
    const otherPreset = await seedConfigPreset(db, other.id, { isActive: true });

    await expect(assertPresetIsActive(db, me.id, otherPreset.id)).rejects.toThrow(
      PresetMismatchError,
    );
  });

  it("presetId が null なら検証をスキップする（プリセット未作成の初期状態）", async () => {
    const user = await seedUser(db);

    await expect(assertPresetIsActive(db, user.id, null)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createPresetFromImport
// ---------------------------------------------------------------------------

describe("createPresetFromImport", () => {
  /** インポート元として渡すライブ行を用意する（引数は行オブジェクトをそのまま受け取る） */
  async function seedImportSource(userId: string) {
    const keybinding = await seedKeybinding(db, userId, {
      action: "forward",
      keyCode: "KeyW",
      category: "movement",
    });
    const playerConfig = await seedPlayerConfig(db, userId, {
      keyboardLayout: "US",
      mouseDpi: 800,
      fingerAssignments: JSON.stringify({ KeyW: "leftIndex" }),
    });
    const [remap] = await db
      .insert(schema.keyRemaps)
      .values({ userId, sourceKey: "CapsLock", targetKey: "ControlLeft", remapType: "all" })
      .returning();
    return { keybinding, playerConfig, remap };
  }

  it("インポート名・説明つきのアクティブなプリセットを作成し、履歴を残す", async () => {
    const user = await seedUser(db);
    const { keybinding, playerConfig, remap } = await seedImportSource(user.id);

    const preset = await createPresetFromImport(db, user.id, [keybinding], playerConfig, [remap]);

    expect(preset.name).toMatch(/^インポート \(\d{4}\/\d{2}\/\d{2}\)$/);
    expect(preset.description).toBe("インポートされた設定から自動作成されたプリセット");
    expect(preset.isActive).toBe(true);

    const stored = await findPreset(preset.id);
    expect(stored!.isActive).toBe(true);
    expect(JSON.parse(stored!.keybindingsData!)).toEqual([
      { action: "forward", keyCode: "KeyW", category: "movement" },
    ]);
    expect(JSON.parse(stored!.playerConfigData!)).toMatchObject({
      keyboardLayout: "US",
      mouseDpi: 800,
    });
    expect(stored!.fingerAssignmentsData).toBe(JSON.stringify({ KeyW: "leftIndex" }));
    expect(JSON.parse(stored!.remapsData!)).toHaveLength(1);

    const history = await db.query.configHistory.findMany({
      where: eq(schema.configHistory.userId, user.id),
    });
    expect(history).toHaveLength(1);
    expect(history[0].changeType).toBe("preset_switch");
    expect(history[0].changeDescription).toBe(`プリセット「${preset.name}」をインポートから作成`);
    expect(history[0].presetId).toBe(preset.id);
  });

  it("メイン未設定のユーザーでは自動でメインになる", async () => {
    const user = await seedUser(db);
    const { keybinding } = await seedImportSource(user.id);

    const preset = await createPresetFromImport(db, user.id, [keybinding], null, []);

    expect(preset.isMain).toBe(true);
    expect((await findPreset(preset.id))!.isMain).toBe(true);
  });

  it("既にメインがある場合はメインを奪わない", async () => {
    const user = await seedUser(db);
    const existingMain = await seedConfigPreset(db, user.id, { name: "Main", isMain: true });
    const { keybinding } = await seedImportSource(user.id);

    const preset = await createPresetFromImport(db, user.id, [keybinding], null, []);

    expect(preset.isMain).toBe(false);
    expect((await findPreset(preset.id))!.isMain).toBe(false);
    expect((await findPreset(existingMain.id))!.isMain).toBe(true);
  });

  it("既存のアクティブプリセットを非アクティブ化する（アクティブは高々1件）", async () => {
    const user = await seedUser(db);
    const previous = await seedConfigPreset(db, user.id, { name: "Previous", isActive: true });
    const { keybinding } = await seedImportSource(user.id);

    const preset = await createPresetFromImport(db, user.id, [keybinding], null, []);

    expect((await findPreset(previous.id))!.isActive).toBe(false);
    expect((await findPreset(preset.id))!.isActive).toBe(true);
    const actives = (
      await db.query.configPresets.findMany({
        where: eq(schema.configPresets.userId, user.id),
      })
    ).filter((p) => p.isActive);
    expect(actives).toHaveLength(1);
  });

  it("渡されなかった種別のスナップショット列は null になる（Loop はインポート経路に無い）", async () => {
    const user = await seedUser(db);
    const { keybinding } = await seedImportSource(user.id);

    const preset = await createPresetFromImport(db, user.id, [keybinding], null, []);

    const stored = await findPreset(preset.id);
    expect(stored!.playerConfigData).toBeNull();
    expect(stored!.remapsData).toBeNull();
    expect(stored!.itemLayoutsData).toBeNull();
    expect(stored!.searchCraftsData).toBeNull();
    expect(stored!.searchCraftLoopsData).toBeNull();
    expect(stored!.customKeysData).toBeNull();
    expect(stored!.customActionsData).toBeNull();
  });
});
