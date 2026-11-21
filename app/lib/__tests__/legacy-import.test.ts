// MCSRer Hotkeys からのレガシーインポート（数値項目のサーバー側バリデーション）のテスト。
// 旧データは無検証で入ってくるため、mouseDpi / gameSensitivity / cm360 は妥当性を確認し、
// 無効値はクランプせず取り込まない（null 化）。未設定（undefined）は列を更新しない（既存値を保持）。
//
// importFromLegacy はインポート完了後に createPresetFromOnboarding 経由で db.transaction() を
// 使うため、素の `:memory:` だとトランザクション後に別接続＝空 DB を見てしまう
// （helpers/test-db.ts のコメント参照）。createTransactionalTestDb()（shared cache）を使う。
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { importFromLegacy } from "../legacy-import";
import { createTranslator } from "../messages";
import { describeHistory, parseHistoryDescription, encodeHistoryDescription } from "../history-description";
import {
  createTransactionalTestDb,
  seedUser,
  seedKeybinding,
  seedPlayerConfig,
  seedConfigPreset,
  schema,
} from "./helpers/test-db";

const t = createTranslator("ja");
const LEGACY_API_URL = "https://legacy.example";

/** fetchLegacyData（グローバル fetch）が返すレスポンスをスタブする */
function stubLegacyFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("importFromLegacy - 数値項目のバリデーション", () => {
  it("無効な mouseDpi / gameSensitivity / cm360 はクランプせず null として保存される", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    stubLegacyFetch({
      settings: {
        mouseDpi: -100, // 0以下（非正）
        gameSensitivity: 1.5, // 表示300%相当。閉区間 0..1 を超える
        cm360: -5, // 0以下（非正）
      },
    });

    const result = await importFromLegacy(t, db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(true);
    expect(result.settingsImported).toBe(true);
    const config = await db.query.playerConfigs.findFirst({
      where: eq(schema.playerConfigs.userId, user.id),
    });
    expect(config?.mouseDpi).toBeNull();
    expect(config?.gameSensitivity).toBeNull();
    expect(config?.cm360).toBeNull();
  });

  it("有効な mouseDpi / gameSensitivity / cm360 はそのまま保存される", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    stubLegacyFetch({
      settings: {
        mouseDpi: 800,
        gameSensitivity: 0.5,
        cm360: 30,
      },
    });

    const result = await importFromLegacy(t, db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(true);
    const config = await db.query.playerConfigs.findFirst({
      where: eq(schema.playerConfigs.userId, user.id),
    });
    expect(config?.mouseDpi).toBe(800);
    expect(config?.gameSensitivity).toBe(0.5);
    expect(config?.cm360).toBe(30);
  });

  it("未指定（undefined）の項目は列を更新せず既存値を保持する", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    // 既存の playerConfig を用意（インポート前から有効な値が入っている）
    await db.insert(schema.playerConfigs).values({
      userId: user.id,
      mouseDpi: 1600,
      gameSensitivity: 0.4,
      cm360: 25,
    });

    stubLegacyFetch({
      settings: {
        // mouseDpi / gameSensitivity / cm360 はレガシー側に存在しない（undefined）
        keyboardModel: "Custom Keyboard",
      },
    });

    const result = await importFromLegacy(t, db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(true);
    const config = await db.query.playerConfigs.findFirst({
      where: eq(schema.playerConfigs.userId, user.id),
    });
    expect(config?.mouseDpi).toBe(1600);
    expect(config?.gameSensitivity).toBe(0.4);
    expect(config?.cm360).toBe(25);
    expect(config?.keyboardModel).toBe("Custom Keyboard");
  });
});

describe("importFromLegacy - 書き込みの原子性とエラー文", () => {
  // 検索クラフトの (userId, sequence) は一意。同じ sequence を 2 件送ると、キーバインドの削除・挿入のあとで
  // 検索クラフトの挿入が一意制約違反になり、トランザクション全体が失敗する
  const FAILING_PAYLOAD = {
    settings: { forward: "key.keyboard.w", mouseDpi: 800 },
    searchCrafts: [
      { id: "a", uuid: "u", sequence: 1, item1: "minecraft:stone", comment: "SECRET-COMMENT" },
      { id: "b", uuid: "u", sequence: 1, item1: "minecraft:dirt", comment: "SECRET-COMMENT" },
    ],
  };

  it("途中で失敗すると、既存のデータは元のまま残る（ロールバック）", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedKeybinding(db, user.id, { action: "attack", keyCode: "mouse_left" });
    await seedPlayerConfig(db, user.id, { mouseDpi: 1600 });
    await db.insert(schema.searchCrafts).values({
      userId: user.id,
      sequence: 9,
      items: JSON.stringify(["minecraft:diamond"]),
      keys: JSON.stringify([]),
    });
    stubLegacyFetch(FAILING_PAYLOAD);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await importFromLegacy(t, db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(false);
    const kbs = await db.query.keybindings.findMany({ where: eq(schema.keybindings.userId, user.id) });
    expect(kbs.map((k) => k.action)).toEqual(["attack"]);
    expect(kbs[0].keyCode).toBe("mouse_left");
    const config = await db.query.playerConfigs.findFirst({ where: eq(schema.playerConfigs.userId, user.id) });
    expect(config?.mouseDpi).toBe(1600);
    const crafts = await db.query.searchCrafts.findMany({ where: eq(schema.searchCrafts.userId, user.id) });
    expect(crafts.map((c) => c.sequence)).toEqual([9]);
    // 失敗したときは初期プリセットも作らない
    expect(await db.query.configPresets.findMany({ where: eq(schema.configPresets.userId, user.id) })).toHaveLength(0);
  });

  it("失敗時のエラー文とログに、SQL・入力値を含めない", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    stubLegacyFetch(FAILING_PAYLOAD);
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await importFromLegacy(t, db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(false);
    expect(result.error).toBe(t("meImport.legacyImportFailed"));
    expect(result.error).not.toMatch(/insert|Failed query|params/i);
    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain("SECRET-COMMENT");
    expect(logged).not.toMatch(/params:/);
  });

  it("旧 API に走者が見つからないときは、その旨の文言を返し、何も書かない", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedKeybinding(db, user.id);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    const result = await importFromLegacy(t, db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(false);
    expect(result.error).toBe(t("meImport.legacyNotFound"));
    expect(await db.query.keybindings.findMany({ where: eq(schema.keybindings.userId, user.id) })).toHaveLength(1);
  });
});

describe("importFromLegacy - プリセット", () => {
  const PAYLOAD = { settings: { forward: "key.keyboard.w", mouseDpi: 800 } };
  const OLD = new Date("2024-01-01T00:00:00Z");

  it("アクティブなプリセットがあっても、その内容は変えず、新しいプリセットを作って編集先にする", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    const active = await seedConfigPreset(db, user.id, {
      name: "Mine",
      isActive: true,
      isMain: true,
      keybindingsData: '[{"action":"attack","keyCode":"mouse_left"}]',
      updatedAt: OLD,
    });
    stubLegacyFetch(PAYLOAD);

    const result = await importFromLegacy(t, db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(true);
    const presets = await db.query.configPresets.findMany({ where: eq(schema.configPresets.userId, user.id) });
    expect(presets).toHaveLength(2);
    const old = presets.find((p) => p.id === active.id)!;
    expect(old.isActive).toBe(false);
    expect(old.isMain).toBe(true);
    expect(old.keybindingsData).toBe('[{"action":"attack","keyCode":"mouse_left"}]');
    expect(old.updatedAt.getTime()).toBe(OLD.getTime());
    const created = presets.find((p) => p.id !== active.id)!;
    expect(created.isActive).toBe(true);
    expect(created.isMain).toBe(false);
    expect(created.keybindingsData).toContain("w");
    expect(created.playerConfigData).toContain("800");
  });

  it("アクティブが無いプリセットだけがある状態でも取り込め、新しいプリセットが編集先になる", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedConfigPreset(db, user.id, { name: "Inactive", isActive: false, isMain: true });
    stubLegacyFetch(PAYLOAD);

    const result = await importFromLegacy(t, db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(true);
    const presets = await db.query.configPresets.findMany({ where: eq(schema.configPresets.userId, user.id) });
    expect(presets.filter((p) => p.isActive)).toHaveLength(1);
  });

  it("プリセットの作成だけが失敗したら、ライブのデータの書き込みも巻き戻る", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedKeybinding(db, user.id, { action: "attack", keyCode: "mouse_left" });
    const active = await seedConfigPreset(db, user.id, { name: "Mine", isActive: true, isMain: true });
    stubLegacyFetch(PAYLOAD);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // 変更履歴の挿入（プリセット作成の最後）を失敗させる: 履歴は userId が必須の FK なので、存在しない userId は使えない。
    // 代わりに configHistory のトリガーで失敗させる
    await db.run(
      sql`CREATE TRIGGER fail_history BEFORE INSERT ON config_history BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );

    const result = await importFromLegacy(t, db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(false);
    const kbs = await db.query.keybindings.findMany({ where: eq(schema.keybindings.userId, user.id) });
    expect(kbs.map((k) => k.action)).toEqual(["attack"]);
    const presets = await db.query.configPresets.findMany({ where: eq(schema.configPresets.userId, user.id) });
    expect(presets.map((p) => p.id)).toEqual([active.id]);
    expect(presets[0].isActive).toBe(true);
  });

  it("プリセットの名前・履歴は呼び出し側のロケールで作られ、除外される旧「適用」の文言と一致しない", async () => {
    const db = await createTransactionalTestDb();
    const user = await seedUser(db, { slug: "runner" });
    stubLegacyFetch(PAYLOAD);

    const result = await importFromLegacy(createTranslator("en"), db, user.id, LEGACY_API_URL, "Runner");

    expect(result.success).toBe(true);
    const presets = await db.query.configPresets.findMany({ where: eq(schema.configPresets.userId, user.id) });
    expect(presets).toHaveLength(1);
    expect(presets[0].isActive).toBe(true);
    expect(presets[0].name).toMatch(/^Initial setup \(\d{4}\/\d{2}\/\d{2}\)$/);
    const history = await db.query.configHistory.findMany({ where: eq(schema.configHistory.userId, user.id) });
    // 履歴は種類のトークンで保存し、表示時に翻訳する
    expect(history[0].changeDescription).toBe(encodeHistoryDescription("preset.createOnboarding", { name: presets[0].name }));
    expect(describeHistory(createTranslator("en"), history[0].changeDescription, parseHistoryDescription(history[0].changeDescription))).toBe(
      `Created preset "${presets[0].name}" as the initial setup`,
    );
    expect(history[0].changeDescription).not.toMatch(/^Applied preset ".*"$/);
  });
});
