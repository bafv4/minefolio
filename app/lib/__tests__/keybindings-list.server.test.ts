import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadKeybindingsListPlayers } from "../keybindings-list.server";
import { invalidateCache } from "../cache";
import {
  createTestDb,
  seedUser,
  seedKeybinding,
  seedConfigPreset,
} from "./helpers/test-db";

// loadKeybindingsListPlayers は "keybindings:list:all" をキーに 60 秒のグローバル
// メモリキャッシュを使う。テスト DB はテストごとに独立でもキャッシュは共有されるため、
// キャッシュ経路を使うテストの前後でキーを消してテスト間汚染を防ぐ。
const CACHE_KEY = "keybindings:list:all";

beforeEach(async () => {
  await invalidateCache(CACHE_KEY);
});
afterEach(async () => {
  await invalidateCache(CACHE_KEY);
});

describe("loadKeybindingsListPlayers - 対象条件", () => {
  it("public + 設定ありのユーザーを返す（ライブテーブル）", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner", mcid: "Runner", role: "runner" });
    await seedKeybinding(db, user.id, { action: "attack", keyCode: "mouse_left" });

    const players = await loadKeybindingsListPlayers(db);
    expect(players).toHaveLength(1);
    expect(players[0].slug).toBe("runner");
    expect(players[0].keybindings.map((k) => k.action)).toContain("attack");
  });

  it("unlisted / private / viewer は除外する", async () => {
    const db = await createTestDb();
    const pub = await seedUser(db, { slug: "pub", role: "runner", profileVisibility: "public" });
    const unl = await seedUser(db, { slug: "unl", role: "runner", profileVisibility: "unlisted" });
    const prv = await seedUser(db, { slug: "prv", role: "runner", profileVisibility: "private" });
    const viewer = await seedUser(db, { slug: "viewer", role: "viewer", profileVisibility: "public" });
    for (const u of [pub, unl, prv, viewer]) {
      await seedKeybinding(db, u.id, { action: "attack" });
    }

    const players = await loadKeybindingsListPlayers(db);
    expect(players.map((p) => p.slug)).toEqual(["pub"]);
  });

  it("キーバインド・リマップ・カスタムアクションが全く無いユーザーは除外する", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "empty", role: "runner" }); // 設定行なし

    const players = await loadKeybindingsListPlayers(db);
    expect(players).toEqual([]);
  });
});

describe("loadKeybindingsListPlayers - メインプリセット優先", () => {
  it("メインプリセットがある場合はスナップショットを使い、ライブ行は混ぜない", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner", role: "runner" });
    // ライブテーブルには "live_action" があるが…
    await seedKeybinding(db, user.id, { action: "live_action", keyCode: "KeyL", category: "movement" });
    // メイン（公開用）プリセットは "preset_action" を持つ
    await seedConfigPreset(db, user.id, {
      isMain: true,
      keybindingsData: JSON.stringify([
        { action: "preset_action", keyCode: "KeyP", category: "movement" },
      ]),
    });

    const players = await loadKeybindingsListPlayers(db);
    expect(players).toHaveLength(1);
    const actions = players[0].keybindings.map((k) => k.action);
    expect(actions).toContain("preset_action");
    expect(actions).not.toContain("live_action");
  });
});

describe("loadKeybindingsListPlayers - slugs オプション", () => {
  it("slugs 指定で対象を絞り込む（キャッシュをバイパスする経路）", async () => {
    const db = await createTestDb();
    const a = await seedUser(db, { slug: "a", role: "runner" });
    const b = await seedUser(db, { slug: "b", role: "runner" });
    await seedKeybinding(db, a.id, { action: "attack" });
    await seedKeybinding(db, b.id, { action: "attack" });

    const players = await loadKeybindingsListPlayers(db, { slugs: ["a"] });
    expect(players.map((p) => p.slug)).toEqual(["a"]);
  });
});
