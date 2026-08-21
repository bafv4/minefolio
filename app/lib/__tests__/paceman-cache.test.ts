// PaceMan ペースキャッシュ（app/lib/paceman-cache.ts）の回帰テスト。
//
// cachePacemanPaces は cron から無人で実行される「蓄積型」の書き込み経路で、
// ソース自身が「途中失敗で削除だけコミットされると取得ウィンドウ外の蓄積済みペースが
// 復元不能になる」とデータ損失リスクを明記している。ここで守りたい不変条件は 3 つ:
//   1. 削除は MCID 単位ではなく「取得したランID単位」— 取得ウィンドウ外の過去ペースを消さない
//   2. 保持期間（2か月）のプルーニングが境界で正しく効く（境界ちょうどは残す）
//   3. MCID → userId の解決が大小文字を無視し、未登録プレイヤーは userId=null で入る
// 読み出し側は同一ランのグループ化・最進スプリット選択（SPLIT_ORDER）・進行順ソートを見る
// （フィード用の getPaceFeedEntries は paces-feed.server.test.ts が通しているためここでは扱わない）。
//
// cachePacemanPaces は削除→挿入→プルーニングを 1 トランザクションで行い、内部で createDb() を
// 呼ぶ。素の `:memory:` はトランザクション後に別接続＝空 DB を見てしまうため、共有メモリ URL
// （SHARED_MEMORY_URL）へ process.env.TURSO_DATABASE_URL を向けて実 DB で検証する
// （helpers/test-db.ts のコメント参照）。
//
// 保持期間の境界は現在時刻依存のため、Date だけを固定する（toFake: ["Date"]）。
// タイマ全体を差し替えると libSQL 側の非同期処理を巻き込むリスクがあるため Date に限定する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedPace,
  schema,
  SHARED_MEMORY_URL,
  type TestDb,
} from "./helpers/test-db";
import {
  cachePacemanPaces,
  getMainPaces,
  getRecentPacesForPlayer,
  getRunTimeline,
} from "../paceman-cache";
import type { PaceManRecentRun } from "../paceman";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 固定した「現在時刻」。保持期間（2か月前）の境界がぶれないよう月中の日付にしてある */
const NOW = new Date("2026-08-21T12:00:00.000Z");

let db: TestDb;
let originalUrl: string | undefined;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  vi.useRealTimers();
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

/** 保持期間の開始時刻。実装（getPaceRetentionStart）と同じ求め方で境界を再現する */
function retentionStart(): Date {
  const d = new Date(NOW);
  d.setMonth(d.getMonth() - 2);
  return d;
}

/** base から ms だけずらした Date（負値で過去） */
function offset(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

type RunSplits = Partial<Omit<PaceManRecentRun, "id" | "nickname" | "time">>;

/** PaceMan API が返す 1 ラン。指定しなかったスプリットは null（未到達） */
function makeRun(id: number, nickname: string, date: Date, splits: RunSplits = {}): PaceManRecentRun {
  return {
    id,
    nickname,
    time: Math.floor(date.getTime() / 1000), // API は Unix 秒
    nether: null,
    bastion: null,
    fortress: null,
    first_portal: null,
    first_structure: null,
    second_structure: null,
    stronghold: null,
    end: null,
    finish: null,
    ...splits,
  };
}

/** 指定ランの行を「区間 → RTA」で取り出す（行の並び順に依存せず比較する） */
async function splitsOfRun(pacemanRunId: number): Promise<Record<string, number>> {
  const rows = await db.query.pacemanPaces.findMany({
    where: eq(schema.pacemanPaces.pacemanRunId, pacemanRunId),
  });
  return Object.fromEntries(rows.map((row) => [row.timeline, row.rta]));
}

/** キャッシュに残っているランID一覧（昇順） */
async function cachedRunIds(): Promise<number[]> {
  const rows = await db.query.pacemanPaces.findMany();
  return [...new Set(rows.map((row) => row.pacemanRunId))].sort((a, b) => a - b);
}

describe("cachePacemanPaces - 蓄積型の置き換え", () => {
  it("同一ランの既存行だけを置き換え、取得ウィンドウ外の別ランは保持する", async () => {
    const runDate = offset(NOW, -2 * HOUR);

    // 取得ウィンドウ外（今回の取得結果に含まれない）過去のラン
    await seedPace(db, {
      pacemanRunId: 100,
      mcid: "Runner",
      timeline: "Fortress",
      rta: 250_000,
      date: offset(NOW, -30 * DAY),
    });
    // 前回 cron 時点では Enter Nether までだった進行中のラン
    await seedPace(db, {
      pacemanRunId: 200,
      mcid: "Runner",
      timeline: "Enter Nether",
      rta: 90_000,
      date: runDate,
      isNetherEnter: true,
    });

    await cachePacemanPaces([
      makeRun(200, "Runner", runDate, { nether: 95_000, bastion: 150_000 }),
    ]);

    // 取得ウィンドウ外のランは触られない
    expect(await splitsOfRun(100)).toEqual({ Fortress: 250_000 });
    // 取得したランは丸ごと置き換わる（古い Enter Nether 行が重複して残らない）
    expect(await splitsOfRun(200)).toEqual({ "Enter Nether": 95_000, Bastion: 150_000 });
    expect(await db.query.pacemanPaces.findMany()).toHaveLength(3);
  });

  it("スプリットごとに isNetherEnter / is2ndStructureOrLater を立てて保存する", async () => {
    await cachePacemanPaces([
      makeRun(1, "Runner", NOW, {
        nether: 90_000,
        bastion: 150_000,
        second_structure: 300_000,
        finish: 600_000,
      }),
    ]);

    const rows = await db.query.pacemanPaces.findMany();
    const byTimeline = new Map(rows.map((row) => [row.timeline, row]));

    expect(byTimeline.get("Enter Nether")).toMatchObject({
      isNetherEnter: true,
      is2ndStructureOrLater: false,
    });
    expect(byTimeline.get("Bastion")).toMatchObject({
      isNetherEnter: false,
      is2ndStructureOrLater: false,
    });
    // second_structure は "Obtain Blaze Rods" として入る
    expect(byTimeline.get("Obtain Blaze Rods")).toMatchObject({
      isNetherEnter: false,
      is2ndStructureOrLater: true,
    });
    expect(byTimeline.get("Finish")).toMatchObject({
      isNetherEnter: false,
      is2ndStructureOrLater: true,
    });
    // 未到達（null）のスプリットは行にならない
    expect(byTimeline.has("Fortress")).toBe(false);
  });

  it("取得件数が挿入・削除のバッチ上限を超えても全ランが反映される", async () => {
    // 削除は 100 件・挿入は 50 件ずつに分割されるため、両方の境界をまたぐ件数で確認する
    const runs = Array.from({ length: 120 }, (_, i) =>
      makeRun(i + 1, "Runner", NOW, { nether: 90_000 + i }),
    );
    // 置き換え対象の既存キャッシュを先に入れておく
    for (const run of runs) {
      await seedPace(db, {
        pacemanRunId: run.id,
        mcid: "Runner",
        timeline: "Enter Nether",
        rta: 1,
        date: NOW,
        isNetherEnter: true,
      });
    }

    await cachePacemanPaces(runs);

    const rows = await db.query.pacemanPaces.findMany();
    expect(rows).toHaveLength(120);
    // 全行が新しい値で置き換わっている（rta=1 の旧行が 1 件も残らない）
    expect(rows.every((row) => row.rta >= 90_000)).toBe(true);
  });
});

describe("cachePacemanPaces - 保持期間（2か月）", () => {
  it("保持期間より古い行は削除し、境界ちょうどの行は残す", async () => {
    const boundary = retentionStart();
    await seedPace(db, { pacemanRunId: 1, mcid: "Old", date: offset(boundary, -1000) });
    await seedPace(db, { pacemanRunId: 2, mcid: "Edge", date: boundary });
    await seedPace(db, { pacemanRunId: 3, mcid: "Fresh", date: offset(boundary, DAY) });

    await cachePacemanPaces([makeRun(4, "New", NOW, { nether: 90_000 })]);

    expect(await cachedRunIds()).toEqual([2, 3, 4]);
  });

  it("保持期間より古いランは取得結果に含まれていてもキャッシュしない", async () => {
    const tooOld = offset(retentionStart(), -DAY);

    await cachePacemanPaces([
      makeRun(1, "Runner", tooOld, { nether: 90_000, bastion: 150_000 }),
      makeRun(2, "Runner", NOW, { nether: 91_000 }),
    ]);

    expect(await splitsOfRun(1)).toEqual({});
    expect(await splitsOfRun(2)).toEqual({ "Enter Nether": 91_000 });
  });

  it("取得結果が空でも保持期間外のプルーニングは実行される", async () => {
    await seedPace(db, { pacemanRunId: 1, mcid: "Old", date: offset(retentionStart(), -DAY) });
    await seedPace(db, { pacemanRunId: 2, mcid: "Fresh", date: NOW });

    await cachePacemanPaces([]);

    expect(await cachedRunIds()).toEqual([2]);
  });
});

describe("cachePacemanPaces - MCID から userId の解決", () => {
  it("登録ユーザーの MCID（大小文字を無視）のペースにだけ userId を付ける", async () => {
    const user = await seedUser(db, { slug: "runner", mcid: "Runner" });

    await cachePacemanPaces([
      makeRun(1, "runner", NOW, { nether: 90_000 }), // 大小文字違いでも解決する
      makeRun(2, "Ghost", NOW, { nether: 95_000 }), // 未登録プレイヤー
    ]);

    const rows = await db.query.pacemanPaces.findMany();
    const byRunId = new Map(rows.map((row) => [row.pacemanRunId, row]));

    expect(byRunId.get(1)?.userId).toBe(user.id);
    // mcid 列は取得結果の表記をそのまま保持する（後から再リンクできるようにするため）
    expect(byRunId.get(1)?.mcid).toBe("runner");
    expect(byRunId.get(2)?.userId).toBeNull();
    expect(byRunId.get(2)?.mcid).toBe("Ghost");
  });

  it("同一ランの全スプリットに同じ userId が付く", async () => {
    const user = await seedUser(db, { slug: "runner", mcid: "Runner" });

    await cachePacemanPaces([
      makeRun(1, "Runner", NOW, { nether: 90_000, bastion: 150_000, finish: 600_000 }),
    ]);

    const rows = await db.query.pacemanPaces.findMany();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.userId === user.id)).toBe(true);
  });
});

describe("getMainPaces - 同一ランのグループ化", () => {
  it("同一ランの複数スプリットを1件にまとめ、最進スプリットを latestSplit にする", async () => {
    const date = offset(NOW, -DAY);
    // 進んだスプリットを先に挿入する（「最後に読んだ行」ではなく SPLIT_ORDER で選ばれることを見る）
    await seedPace(db, {
      pacemanRunId: 1, mcid: "Runner", timeline: "Enter End", rta: 400_000, date,
      is2ndStructureOrLater: true,
    });
    await seedPace(db, {
      pacemanRunId: 1, mcid: "Runner", timeline: "Obtain Blaze Rods", rta: 300_000, date,
      is2ndStructureOrLater: true,
    });
    await seedPace(db, {
      pacemanRunId: 1, mcid: "Runner", timeline: "Enter Stronghold", rta: 350_000, date,
      is2ndStructureOrLater: true,
    });

    const groups = await getMainPaces("Runner");

    expect(groups).toHaveLength(1);
    expect(groups[0].latestSplit).toEqual({ timeline: "Enter End", rta: 400_000 });
    // splits は進行順（SPLIT_ORDER）に並ぶ
    expect(groups[0].splits.map((s) => s.timeline)).toEqual([
      "Obtain Blaze Rods",
      "Enter Stronghold",
      "Enter End",
    ]);
    expect(groups[0].date).toBe(date.toISOString());
  });

  it("2nd Structure より前のスプリットと1週間より古いランは対象外", async () => {
    await seedPace(db, {
      pacemanRunId: 1, mcid: "Runner", timeline: "Fortress", rta: 200_000,
      date: offset(NOW, -DAY), is2ndStructureOrLater: false,
    });
    await seedPace(db, {
      pacemanRunId: 2, mcid: "Runner", timeline: "Enter End", rta: 400_000,
      date: offset(NOW, -8 * DAY), is2ndStructureOrLater: true,
    });
    await seedPace(db, {
      pacemanRunId: 3, mcid: "Runner", timeline: "Enter End", rta: 410_000,
      date: offset(NOW, -6 * DAY), is2ndStructureOrLater: true,
    });

    const groups = await getMainPaces("Runner");

    expect(groups.map((g) => g.pacemanRunId)).toEqual([3]);
  });

  it("新しい順に limit 件まで返す", async () => {
    for (const [i, runId] of [1, 2, 3].entries()) {
      await seedPace(db, {
        pacemanRunId: runId, mcid: "Runner", timeline: "Enter End", rta: 400_000,
        date: offset(NOW, -(i + 1) * DAY), is2ndStructureOrLater: true,
      });
    }

    const groups = await getMainPaces("Runner", 2);

    expect(groups.map((g) => g.pacemanRunId)).toEqual([1, 2]);
  });

  it("MCID は大小文字を無視して一致する", async () => {
    await seedPace(db, {
      pacemanRunId: 1, mcid: "RuNNeR", timeline: "Enter End", rta: 400_000,
      date: offset(NOW, -DAY), is2ndStructureOrLater: true,
    });

    expect(await getMainPaces("runner")).toHaveLength(1);
  });
});

describe("getRecentPacesForPlayer", () => {
  it("Enter Nether を除外し、同一ランは最も進んだ（rta 最大）スプリットを採る", async () => {
    const date = offset(NOW, -DAY);
    await seedPace(db, {
      pacemanRunId: 1, mcid: "Runner", timeline: "Enter Nether", rta: 90_000, date,
      isNetherEnter: true,
    });
    await seedPace(db, { pacemanRunId: 1, mcid: "Runner", timeline: "Bastion", rta: 150_000, date });
    await seedPace(db, { pacemanRunId: 1, mcid: "Runner", timeline: "Fortress", rta: 220_000, date });

    const entries = await getRecentPacesForPlayer("Runner");

    expect(entries).toHaveLength(1);
    expect(entries[0].latestSplit).toEqual({ timeline: "Fortress", rta: 220_000 });
    expect(entries[0].splits).toEqual([{ timeline: "Fortress", rta: 220_000 }]);
  });

  it("新しい順に limit 件まで返す", async () => {
    for (const [i, runId] of [1, 2, 3].entries()) {
      await seedPace(db, {
        pacemanRunId: runId, mcid: "Runner", timeline: "Bastion", rta: 150_000,
        date: offset(NOW, -(i + 1) * HOUR),
      });
    }

    const entries = await getRecentPacesForPlayer("Runner", 2);

    expect(entries.map((e) => e.pacemanRunId)).toEqual([1, 2]);
  });

  it("1週間より古いペースは含まれない", async () => {
    await seedPace(db, {
      pacemanRunId: 1, mcid: "Runner", timeline: "Bastion", rta: 150_000,
      date: offset(NOW, -8 * DAY),
    });

    expect(await getRecentPacesForPlayer("Runner")).toEqual([]);
  });
});

describe("getRunTimeline", () => {
  it("そのランの全スプリットを進行順で返す（Enter Nether も含む）", async () => {
    const date = offset(NOW, -DAY);
    // 挿入順は進行順とは無関係にしておく
    await seedPace(db, { pacemanRunId: 1, mcid: "Runner", timeline: "Enter End", rta: 400_000, date });
    await seedPace(db, {
      pacemanRunId: 1, mcid: "Runner", timeline: "Enter Nether", rta: 90_000, date,
      isNetherEnter: true,
    });
    await seedPace(db, { pacemanRunId: 1, mcid: "Runner", timeline: "Fortress", rta: 220_000, date });
    await seedPace(db, { pacemanRunId: 1, mcid: "Runner", timeline: "Bastion", rta: 150_000, date });

    const timeline = await getRunTimeline("Runner", 1);

    expect(timeline.map((entry) => entry.timeline)).toEqual([
      "Enter Nether",
      "Bastion",
      "Fortress",
      "Enter End",
    ]);
    expect(timeline.map((entry) => entry.rta)).toEqual([90_000, 150_000, 220_000, 400_000]);
  });

  it("同じランIDでも別プレイヤーの行は混ざらない", async () => {
    const date = offset(NOW, -DAY);
    await seedPace(db, { pacemanRunId: 7, mcid: "Runner", timeline: "Bastion", rta: 150_000, date });
    await seedPace(db, { pacemanRunId: 7, mcid: "Other", timeline: "Fortress", rta: 220_000, date });

    const timeline = await getRunTimeline("Runner", 7);

    expect(timeline.map((entry) => entry.timeline)).toEqual(["Bastion"]);
  });

  it("MCID は大小文字を無視して一致する", async () => {
    await seedPace(db, {
      pacemanRunId: 1, mcid: "RuNNeR", timeline: "Bastion", rta: 150_000,
      date: offset(NOW, -DAY),
    });

    expect(await getRunTimeline("runner", 1)).toHaveLength(1);
  });
});
