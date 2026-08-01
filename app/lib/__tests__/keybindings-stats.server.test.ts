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
import { invalidateCache } from "../cache";
import { createTestDb, seedUser, seedPlayerConfig } from "./helpers/test-db";

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
