// MCSRer Hotkeys からのレガシーインポート（数値項目のサーバー側バリデーション）のテスト。
// 旧データは無検証で入ってくるため、mouseDpi / gameSensitivity / cm360 は妥当性を確認し、
// 無効値はクランプせず取り込まない（null 化）。未設定（undefined）は列を更新しない（既存値を保持）。
//
// importFromLegacy はインポート完了後に createPresetFromOnboarding 経由で db.transaction() を
// 使うため、素の `:memory:` だとトランザクション後に別接続＝空 DB を見てしまう
// （helpers/test-db.ts のコメント参照）。createTransactionalTestDb()（shared cache）を使う。
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { importFromLegacy } from "../legacy-import";
import { createTranslator } from "../messages";
import { createTransactionalTestDb, seedUser, schema } from "./helpers/test-db";

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
