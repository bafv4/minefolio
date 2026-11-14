// config_history の「公開面に影響する変更」判定（app/lib/config-history.ts）の回帰テスト。
// 規約: preset_id は公開影響のある変更のときだけメインプリセットの id を入れる（影響なしは null）。
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedConfigPreset,
  schema,
  SHARED_MEMORY_URL,
  type TestDb,
} from "./helpers/test-db";
import {
  publicConfigChangeCondition,
  resolveActivePublicPresetId,
  resolvePublicPresetId,
  PUBLIC_CONFIG_HISTORY_SINCE,
} from "../config-history";
import { createPreset } from "../preset-utils";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

describe("publicConfigChangeCondition", () => {
  it("preset_id が null の行・規約開始前の行は除外し、preset_id 付きの新しい行だけ選ぶ", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    const preset = await seedConfigPreset(db, user.id, { isMain: true });
    const after = new Date(PUBLIC_CONFIG_HISTORY_SINCE.getTime() + 60_000);
    const before = new Date(PUBLIC_CONFIG_HISTORY_SINCE.getTime() - 60_000);
    await db.insert(schema.configHistory).values([
      { userId: user.id, changeType: "keybinding", changeDescription: "public", presetId: preset.id, createdAt: after },
      { userId: user.id, changeType: "keybinding", changeDescription: "non-public", presetId: null, createdAt: after },
      { userId: user.id, changeType: "preset_switch", changeDescription: "legacy", presetId: preset.id, createdAt: before },
    ]);

    const rows = await db
      .select({ description: schema.configHistory.changeDescription })
      .from(schema.configHistory)
      .where(publicConfigChangeCondition());

    expect(rows.map((r) => r.description)).toEqual(["public"]);
  });
});

describe("resolvePublicPresetId / resolveActivePublicPresetId", () => {
  it("メインなら id、メインでなければ null、他人のプリセットは null", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    const main = await seedConfigPreset(db, user.id, { isMain: true });
    const plain = await seedConfigPreset(db, user.id, { name: "plain" });

    expect(await resolvePublicPresetId(db, user.id, main.id)).toBe(main.id);
    expect(await resolvePublicPresetId(db, user.id, plain.id)).toBeNull();
    expect(await resolvePublicPresetId(db, other.id, main.id)).toBeNull();
  });

  it("編集中かつメインのときだけ id を返す", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    const main = await seedConfigPreset(db, user.id, { isMain: true, isActive: false });
    const active = await seedConfigPreset(db, user.id, { name: "active", isActive: true });

    expect(await resolveActivePublicPresetId(db, user.id)).toBeNull();

    await db.update(schema.configPresets).set({ isActive: false }).where(eq(schema.configPresets.id, active.id));
    await db.update(schema.configPresets).set({ isActive: true }).where(eq(schema.configPresets.id, main.id));
    expect(await resolveActivePublicPresetId(db, user.id)).toBe(main.id);
  });

  it("プリセットが無いユーザーは null", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    expect(await resolveActivePublicPresetId(db, user.id)).toBeNull();
  });
});

describe("createPreset の履歴", () => {
  it("初回（自動でメイン）は preset_id 付き、2件目（非メイン）は null", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    const first = await createPreset(db, { userId: user.id, name: "first", isActive: true });
    const second = await createPreset(db, { userId: user.id, name: "second" });

    const history = await db.query.configHistory.findMany({ where: eq(schema.configHistory.userId, user.id) });
    const byDesc = (name: string) => history.find((h) => h.changeDescription.includes(name));
    expect(first.isMain).toBe(true);
    expect(second.isMain).toBe(false);
    expect(byDesc("first")?.presetId).toBe(first.id);
    expect(byDesc("second")?.presetId).toBeNull();
  });
});
