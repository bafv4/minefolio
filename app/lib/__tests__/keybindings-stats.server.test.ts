// キー配置統計（感度分布・平均）の感度パーセントスケール統一（*200）のテスト。
// - 感度は内部値 0..1 を表示 0..200% に換算（toSensitivityPercent）してから 10 区分に振り分ける
// - isValidSensitivity が false（範囲外）の値は分布・平均の母数から除外する
//   （cm/360 が異常値を null にして除外するのと同じ方針）
//
// loadKeybindingsStats は "keybindings:stats" をキーに 60 秒のグローバルメモリキャッシュを使う。
// テスト DB はテストごとに独立でもキャッシュは共有されるため、前後で消してテスト間汚染を防ぐ
// （keybindings-list.server.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadKeybindingsStats } from "../keybindings-stats.server";
import { KEY_ACTION_STATS_KEYS } from "../keybindings-stats-shared";
import { UNBOUND_KEY } from "../keybindings";
import { invalidateCache } from "../cache";
import {
  createTestDb,
  seedUser,
  seedPlayerConfig,
  seedKeybinding,
} from "./helpers/test-db";

const CACHE_KEY = "keybindings:stats";

beforeEach(async () => {
  await invalidateCache(CACHE_KEY);
});
afterEach(async () => {
  await invalidateCache(CACHE_KEY);
});

describe("loadKeybindingsStats - 感度統計（*200スケール）", () => {
  it("表示160%（内部0.8）のユーザーは 160-179% 区分に入り、平均も *200 スケールになる", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedPlayerConfig(db, user.id, { gameSensitivity: 0.8 });

    const stats = await loadKeybindingsStats(db);

    const range = stats.sensitivityStats.ranges.find((r) => r.label === "160-179%");
    expect(range?.count).toBe(1);
    expect(range?.players.map((p) => p.slug)).toEqual(["runner"]);
    expect(stats.sensitivityStats.average).toBe(160);
    expect(stats.sensitivityStats.totalCount).toBe(1);
  });

  it("内部1.5（表示300%相当、範囲外）は分布・平均の母数から除外され、excludedCount に数えられる", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedPlayerConfig(db, user.id, { gameSensitivity: 1.5 });

    const stats = await loadKeybindingsStats(db);

    expect(stats.sensitivityStats.totalCount).toBe(0);
    expect(stats.sensitivityStats.average).toBeNull();
    expect(stats.sensitivityStats.excludedCount).toBe(1);
    for (const range of stats.sensitivityStats.ranges) {
      expect(range.count).toBe(0);
    }
  });

  it("感度ちょうど0（内部0）は < 20% 区分に入る", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedPlayerConfig(db, user.id, { gameSensitivity: 0 });

    const stats = await loadKeybindingsStats(db);

    const range = stats.sensitivityStats.ranges.find((r) => r.label === "< 20%");
    expect(range?.count).toBe(1);
    expect(stats.sensitivityStats.totalCount).toBe(1);
    expect(stats.sensitivityStats.average).toBe(0);
  });

  it("区分カウントの合計は有効感度ユーザー数と一致する（範囲外ユーザーは含まない）", async () => {
    const db = await createTestDb();
    // 各区分にまたがる値（0%, 20%, 60%, 100%, 160%, 200%）
    const validSensitivities = [0, 0.1, 0.3, 0.5, 0.8, 1.0];
    for (const [i, s] of validSensitivities.entries()) {
      const user = await seedUser(db, { slug: `runner-${i}` });
      await seedPlayerConfig(db, user.id, { gameSensitivity: s });
    }
    // 範囲外（表示201%相当）は母数から除外される
    const invalidUser = await seedUser(db, { slug: "runner-invalid" });
    await seedPlayerConfig(db, invalidUser.id, { gameSensitivity: 1.1 });

    const stats = await loadKeybindingsStats(db);

    const rangeSum = stats.sensitivityStats.ranges.reduce((sum, r) => sum + r.count, 0);
    expect(rangeSum).toBe(validSensitivities.length);
    expect(stats.sensitivityStats.totalCount).toBe(validSensitivities.length);
    expect(stats.sensitivityStats.excludedCount).toBe(1);
  });

  it("感度が未設定の走者は除外数に数えない（母数にも除外数にも入らない）", async () => {
    const db = await createTestDb();
    const withValue = await seedUser(db, { slug: "with-value" });
    await seedPlayerConfig(db, withValue.id, { gameSensitivity: 0.5 });
    const withoutValue = await seedUser(db, { slug: "without-value" });
    await seedPlayerConfig(db, withoutValue.id, { gameSensitivity: null });

    const stats = await loadKeybindingsStats(db);

    expect(stats.sensitivityStats.totalCount).toBe(1);
    expect(stats.sensitivityStats.excludedCount).toBe(0);
  });
});

describe("loadKeybindingsStats - キー → 操作の統計（keyActionStats）", () => {
  it("KEY_ACTION_STATS_KEYS と同じ長さ・同じ順で返し、データの無いキーは totalCount 0", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedKeybinding(db, user.id, { action: "inventory", keyCode: "KeyE" });

    const stats = await loadKeybindingsStats(db);

    expect(stats.keyActionStats.map((k) => k.keyCode)).toEqual([...KEY_ACTION_STATS_KEYS]);
    const empty = stats.keyActionStats.find((k) => k.keyCode === "KeyQ");
    expect(empty).toEqual({ keyCode: "KeyQ", topActions: [], totalCount: 0 });
    expect(stats.keyActionStats.find((k) => k.keyCode === "KeyE")?.totalCount).toBe(1);
  });

  it("追跡対象外の操作は keyActionStats には出るが、keybindingStats には出ない", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedKeybinding(db, user.id, { action: "playerList", keyCode: "Tab" });

    const stats = await loadKeybindingsStats(db);

    const tab = stats.keyActionStats.find((k) => k.keyCode === "Tab");
    expect(tab?.totalCount).toBe(1);
    expect(tab?.topActions.map((a) => a.action)).toEqual(["playerList"]);
    expect(stats.keybindingStats.map((s) => s.action)).not.toContain("playerList");
    expect(stats.keybindingStats.every((s) => s.totalCount === 0)).toBe(true);
  });

  it("1人が同じキーに2操作を置くと、totalCount は1人・各操作の percentage は 100", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedKeybinding(db, user.id, { action: "sneak", keyCode: "ShiftLeft" });
    await seedKeybinding(db, user.id, { action: "playerList", keyCode: "ShiftLeft" });

    const stats = await loadKeybindingsStats(db);

    const shift = stats.keyActionStats.find((k) => k.keyCode === "ShiftLeft");
    expect(shift?.totalCount).toBe(1);
    expect(shift?.topActions).toHaveLength(2);
    for (const a of shift!.topActions) {
      expect(a.count).toBe(1);
      expect(a.percentage).toBe(100);
      expect(a.players.map((p) => p.slug)).toEqual(["runner"]);
    }
  });

  it("未割り当て（_UNBOUND）の行は数えない", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner" });
    await seedKeybinding(db, user.id, { action: "inventory", keyCode: UNBOUND_KEY });

    const stats = await loadKeybindingsStats(db);

    expect(stats.keyActionStats.every((k) => k.totalCount === 0)).toBe(true);
  });

  it("上位5件に切り、count の降順に並べる", async () => {
    const db = await createTestDb();
    // 操作 a1..a7 を、a_i が (8 - i) 人に割り当てられるよう 7 人で Space に置く
    const users = [];
    for (let i = 0; i < 7; i++) users.push(await seedUser(db, { slug: `runner-${i}` }));
    for (let a = 1; a <= 7; a++) {
      for (let u = 0; u < 8 - a; u++) {
        await seedKeybinding(db, users[u].id, { action: `a${a}`, keyCode: "Space" });
      }
    }

    const stats = await loadKeybindingsStats(db);

    const space = stats.keyActionStats.find((k) => k.keyCode === "Space");
    expect(space?.totalCount).toBe(7);
    expect(space?.topActions).toHaveLength(5);
    expect(space?.topActions.map((a) => a.action)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(space?.topActions.map((a) => a.count)).toEqual([7, 6, 5, 4, 3]);
  });

  it("非公開の走者と視聴者ロールの走者は keyActionStats に入らない", async () => {
    const db = await createTestDb();
    const pub = await seedUser(db, { slug: "public-runner" });
    const priv = await seedUser(db, { slug: "private-runner", profileVisibility: "private" });
    const viewer = await seedUser(db, { slug: "viewer", role: "viewer" });
    for (const u of [pub, priv, viewer]) {
      await seedKeybinding(db, u.id, { action: "inventory", keyCode: "KeyE" });
    }

    const stats = await loadKeybindingsStats(db);

    const e = stats.keyActionStats.find((k) => k.keyCode === "KeyE");
    expect(e?.totalCount).toBe(1);
    expect(e?.topActions[0].players.map((p) => p.slug)).toEqual(["public-runner"]);
  });
});

describe("loadKeybindingsStats - ON/OFF 設定（マウス加速・ダッシュ切替）", () => {
  it("true / false / null が混ざっても null は母数に入らず、players が正しい側に入る", async () => {
    const db = await createTestDb();
    const on = await seedUser(db, { slug: "on" });
    const off = await seedUser(db, { slug: "off" });
    const unset = await seedUser(db, { slug: "unset" });
    // マウス加速の分布は、マウス設定（DPI 等）がある走者が母集団。DPI を入れて母集団に含める
    await seedPlayerConfig(db, on.id, { mouseDpi: 800, mouseAcceleration: true, toggleSprint: false });
    await seedPlayerConfig(db, off.id, { mouseDpi: 800, mouseAcceleration: false, toggleSprint: true });
    await seedPlayerConfig(db, unset.id, { mouseDpi: 800, mouseAcceleration: null, toggleSprint: null });

    const stats = await loadKeybindingsStats(db);

    expect(stats.mouseAccelerationStats.onCount).toBe(1);
    expect(stats.mouseAccelerationStats.offCount).toBe(1);
    expect(stats.mouseAccelerationStats.totalCount).toBe(2);
    expect(stats.mouseAccelerationStats.onPlayers.map((p) => p.slug)).toEqual(["on"]);
    expect(stats.mouseAccelerationStats.offPlayers.map((p) => p.slug)).toEqual(["off"]);
    expect(stats.toggleSprintStats.totalCount).toBe(2);
    expect(stats.toggleSprintStats.onPlayers.map((p) => p.slug)).toEqual(["off"]);
    expect(stats.toggleSprintStats.offPlayers.map((p) => p.slug)).toEqual(["on"]);
  });

  it("非公開の走者と視聴者ロールの走者は mouseAcceleration / toggleSprint に入らない", async () => {
    const db = await createTestDb();
    const pub = await seedUser(db, { slug: "public-runner" });
    const priv = await seedUser(db, { slug: "private-runner", profileVisibility: "private" });
    const viewer = await seedUser(db, { slug: "viewer", role: "viewer" });
    for (const u of [pub, priv, viewer]) {
      await seedPlayerConfig(db, u.id, { mouseDpi: 800, mouseAcceleration: true, toggleSprint: true });
    }

    const stats = await loadKeybindingsStats(db);

    expect(stats.mouseAccelerationStats.onPlayers.map((p) => p.slug)).toEqual(["public-runner"]);
    expect(stats.mouseAccelerationStats.totalCount).toBe(1);
    expect(stats.toggleSprintStats.onPlayers.map((p) => p.slug)).toEqual(["public-runner"]);
    expect(stats.toggleSprintStats.totalCount).toBe(1);
  });
});

describe("loadKeybindingsStats - マウスの母集団（表のマウスタブと一致）", () => {
  it("DPI・感度・Windows 速度が無く Raw Input / マウス加速（既定値）だけの走者は、登録者数にも ON/OFF 分布にも入らない", async () => {
    const db = await createTestDb();
    const withDpi = await seedUser(db, { slug: "with-dpi" });
    const onlyDefaults = await seedUser(db, { slug: "only-defaults" });
    await seedPlayerConfig(db, withDpi.id, { mouseDpi: 800, rawInput: true, mouseAcceleration: false });
    await seedPlayerConfig(db, onlyDefaults.id, { rawInput: true, mouseAcceleration: false });

    const stats = await loadKeybindingsStats(db);

    expect(stats.playersWithMouseSettings).toBe(1);
    expect(stats.rawInputStats.onPlayers.map((p) => p.slug)).toEqual(["with-dpi"]);
    expect(stats.rawInputStats.totalCount).toBe(1);
    expect(stats.mouseAccelerationStats.offPlayers.map((p) => p.slug)).toEqual(["with-dpi"]);
  });

  it("感度だけ・Windows 速度だけの走者も（表のマウスタブと同じく）母集団に入る", async () => {
    const db = await createTestDb();
    const sens = await seedUser(db, { slug: "sens" });
    const win = await seedUser(db, { slug: "win" });
    await seedPlayerConfig(db, sens.id, { gameSensitivity: 0.5, rawInput: false });
    await seedPlayerConfig(db, win.id, { windowsSpeed: 6, rawInput: true });

    const stats = await loadKeybindingsStats(db);

    expect(stats.playersWithMouseSettings).toBe(2);
    expect(stats.rawInputStats.totalCount).toBe(2);
  });
});
