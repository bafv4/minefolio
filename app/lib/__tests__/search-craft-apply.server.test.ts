import { describe, it, expect } from "vitest";
import {
  mergeChatRemapsIntoSnapshot,
  applyCraftsToExistingPreset,
} from "../search-craft-apply.server";
import type { PresetRemapData } from "../preset-utils";
import type { TemplateCraft, TemplateLoop } from "../search-craft-templates";
import { createTestDb, seedUser, seedConfigPreset } from "./helpers/test-db";

// remapType 以外は固定の PresetRemapData を組み立てるショートカット
function remap(
  sourceKey: string,
  targetKey: string | null,
  remapType?: PresetRemapData["remapType"],
): PresetRemapData {
  return { sourceKey, targetKey, software: null, notes: null, remapType };
}

describe("mergeChatRemapsIntoSnapshot", () => {
  it("既存の trigger / all 種別は衝突がなければそのまま保持される", () => {
    const existing = JSON.stringify([remap("KeyA", "KeyB", "trigger"), remap("KeyC", "KeyD", "all")]);
    const result = mergeChatRemapsIntoSnapshot(existing, []);
    expect(JSON.parse(result!)).toEqual([
      remap("KeyA", "KeyB", "trigger"),
      remap("KeyC", "KeyD", "all"),
    ]);
  });

  it("既存の chat / unset 種別は保持されず、テンプレの内容で置換される", () => {
    const existing = JSON.stringify([remap("KeyE", "KeyF", "chat"), remap("KeyG", "KeyH", "unset")]);
    const incoming = [remap("KeyE", "KeyX")];
    const result = mergeChatRemapsIntoSnapshot(existing, incoming);
    // 既存の chat/unset 行は消え、incoming が chat 種別として書き込まれるだけになる
    expect(JSON.parse(result!)).toEqual([{ ...remap("KeyE", "KeyX"), remapType: "chat" }]);
  });

  it("衝突時: 挿入分と同一 sourceKey の all 行は trigger に変換される（ゲーム側の挙動を保持）", () => {
    const existing = JSON.stringify([remap("KeyA", "OldTarget", "all")]);
    const incoming = [remap("KeyA", "NewTarget")];
    const result = mergeChatRemapsIntoSnapshot(existing, incoming);
    expect(JSON.parse(result!)).toEqual([
      remap("KeyA", "OldTarget", "trigger"),
      { ...remap("KeyA", "NewTarget"), remapType: "chat" },
    ]);
  });

  it("同一 sourceKey に trigger 行が既に存在する場合、衝突した all 行は変換せず破棄する", () => {
    const existing = JSON.stringify([remap("KeyA", "T", "trigger"), remap("KeyA", "OldAll", "all")]);
    const incoming = [remap("KeyA", "NewTarget")];
    const result = mergeChatRemapsIntoSnapshot(existing, incoming);
    // all 行は trigger に変換すると重複するため破棄され、既存の trigger 行だけが残る
    expect(JSON.parse(result!)).toEqual([
      remap("KeyA", "T", "trigger"),
      { ...remap("KeyA", "NewTarget"), remapType: "chat" },
    ]);
  });

  it("sourceKey の大文字小文字違い（レガシー表記）も同一キーとして衝突判定する", () => {
    const existing = JSON.stringify([remap("keya", "Old", "all")]);
    const incoming = [remap("KeyA", "New")];
    const result = mergeChatRemapsIntoSnapshot(existing, incoming);
    expect(JSON.parse(result!)).toEqual([
      remap("keya", "Old", "trigger"),
      { ...remap("KeyA", "New"), remapType: "chat" },
    ]);
  });

  it("結果が空になる場合は null を返す", () => {
    expect(mergeChatRemapsIntoSnapshot(null, [])).toBeNull();
    const chatOnly = JSON.stringify([remap("KeyE", "KeyF", "chat")]);
    expect(mergeChatRemapsIntoSnapshot(chatOnly, [])).toBeNull();
  });

  it("incoming 内の同一 sourceKey は先勝ちで dedupe される", () => {
    const incoming = [remap("KeyA", "First"), remap("KeyA", "Second")];
    const result = mergeChatRemapsIntoSnapshot(null, incoming);
    expect(JSON.parse(result!)).toEqual([{ ...remap("KeyA", "First"), remapType: "chat" }]);
  });
});

describe("applyCraftsToExistingPreset（非アクティブプリセット経路）", () => {
  const craft = (label: string): TemplateCraft => ({
    items: [`minecraft:${label}`],
    comment: null,
    timing: null,
    variations: [{ str: label, withShift: false }],
  });

  it("searchCraftsData / searchCraftLoopsData をテンプレの内容で置換する", async () => {
    const db = await createTestDb();
    const user = await seedUser(db);
    const preset = await seedConfigPreset(db, user.id, {
      isActive: false,
      searchCraftsData: JSON.stringify([{ sequence: 1, items: '["old"]', keys: "[]" }]),
      searchCraftLoopsData: null,
    });

    const crafts = [craft("a"), craft("b")];
    const loops: TemplateLoop[] = [
      {
        steps: [
          { craftIndex: 0, transition: null },
          { craftIndex: 1, transition: { type: "backspace", bsCount: 1 } },
        ],
        comment: null,
        timing: null,
      },
    ];

    const result = await applyCraftsToExistingPreset(db, user.id, preset.id, {
      crafts,
      remaps: null,
      loops,
    });

    expect(result).toEqual({
      ok: true,
      presetId: preset.id,
      presetName: preset.name,
      wasActive: false,
    });

    const updated = await db.query.configPresets.findFirst({
      where: (p, { eq }) => eq(p.id, preset.id),
    });
    const savedCrafts = JSON.parse(updated!.searchCraftsData!) as Array<{ items: string }>;
    expect(savedCrafts.map((c) => JSON.parse(c.items))).toEqual([["minecraft:a"], ["minecraft:b"]]);
    const savedLoops = JSON.parse(updated!.searchCraftLoopsData!) as Array<{
      steps: Array<{ craftSeq: number }>;
    }>;
    expect(savedLoops).toHaveLength(1);
    expect(savedLoops[0].steps.map((s) => s.craftSeq)).toEqual([1, 2]);
  });

  it("remaps: null の場合は remapsData を変更しない", async () => {
    const db = await createTestDb();
    const user = await seedUser(db);
    const existingRemaps = JSON.stringify([remap("KeyA", "KeyB", "trigger")]);
    const preset = await seedConfigPreset(db, user.id, {
      isActive: false,
      remapsData: existingRemaps,
    });

    await applyCraftsToExistingPreset(db, user.id, preset.id, {
      crafts: [craft("a")],
      remaps: null,
      loops: [],
    });

    const updated = await db.query.configPresets.findFirst({
      where: (p, { eq }) => eq(p.id, preset.id),
    });
    expect(updated!.remapsData).toBe(existingRemaps);
    // loops を渡さない（空配列）場合は searchCraftLoopsData が null になる
    expect(updated!.searchCraftLoopsData).toBeNull();
  });

  it("プリセットが見つからない場合は preset_not_found を返す", async () => {
    const db = await createTestDb();
    const user = await seedUser(db);

    const result = await applyCraftsToExistingPreset(db, user.id, "nonexistent-id", {
      crafts: [],
      remaps: null,
      loops: [],
    });

    expect(result).toEqual({ ok: false, error: "preset_not_found" });
  });
});
