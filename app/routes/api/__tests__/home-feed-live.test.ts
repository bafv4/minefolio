// /api/home-feed の未カバー分岐（pace-timeline の入力検証・不明 type・live-runs）の回帰テスト。
// youtube-videos / twitch-vods は home-feed-videos.test.ts でカバー済みのため対象外。
//
// live-runs は外部API（PaceMan）を叩くため fetchLiveRuns をモックし、DB に登録済みの mcid
// のみへ絞り込まれること・上限（20件）が効くことを実DBで検証する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { invalidateCache } from "@/lib/cache";
import { USER_DATA_CACHE_KEY } from "@/lib/home-user-data.server";

const pacemanMocks = vi.hoisted(() => ({
  fetchLiveRuns: vi.fn(),
}));

vi.mock("@/lib/paceman", () => ({ fetchLiveRuns: pacemanMocks.fetchLiveRuns }));

import { loader } from "../home-feed";

const LIVE_RUNS_CACHE_KEY = "home-feed:live-runs:all";

const ENV_KEYS = ["TURSO_DATABASE_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeStubLiveRun(nickname: string) {
  return {
    worldId: "world-1",
    gameVersion: "1.16.1",
    eventList: [],
    contextEventList: [],
    user: { uuid: "uuid-1", liveAccount: null },
    nickname,
    lastUpdated: Date.now(),
    isCheated: false,
    isHidden: false,
    numLeaves: 0,
  };
}

async function callLoader(query: string): Promise<Response> {
  const request = new Request(`https://minefolio.app/api/home-feed${query}`);
  return loader({ request, params: {}, context: {} } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);
  await invalidateCache(LIVE_RUNS_CACHE_KEY);
  await invalidateCache(USER_DATA_CACHE_KEY);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("?type=pace-timeline - 入力検証", () => {
  it("mcid・runId とも欠落は 400", async () => {
    const res = await callLoader("?type=pace-timeline");
    expect(res.status).toBe(400);
  });

  it("mcid のみ欠落は 400", async () => {
    const res = await callLoader("?type=pace-timeline&runId=123");
    expect(res.status).toBe(400);
  });

  it("runId が非数値は 400", async () => {
    const res = await callLoader("?type=pace-timeline&mcid=Runner&runId=abc");
    expect(res.status).toBe(400);
  });
});

describe("不明な type", () => {
  it("未知の type は 400", async () => {
    const res = await callLoader("?type=bogus");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid feed type" });
  });

  it("type 未指定は 400", async () => {
    const res = await callLoader("");
    expect(res.status).toBe(400);
  });
});

describe("?type=live-runs", () => {
  it("DB 登録済み（公開・mcid/uuid あり）の mcid のみに絞り込む", async () => {
    await seedUser(db, {
      slug: "runner1",
      mcid: "Runner1",
      uuid: "uuid-runner1",
      role: "runner",
      profileVisibility: "public",
    });
    pacemanMocks.fetchLiveRuns.mockResolvedValue([
      makeStubLiveRun("Runner1"), // 登録済み（大文字小文字を無視して一致）
      makeStubLiveRun("UnknownRunner"), // 未登録
    ]);

    const res = await callLoader("?type=live-runs");
    const body = (await res.json()) as { liveRuns: Array<{ nickname: string }> };

    expect(body.liveRuns.map((r) => r.nickname)).toEqual(["Runner1"]);
  });

  it("非公開ユーザーの mcid は登録済み扱いにならない", async () => {
    await seedUser(db, {
      slug: "hidden",
      mcid: "HiddenRunner",
      uuid: "uuid-hidden",
      role: "runner",
      profileVisibility: "private",
    });
    pacemanMocks.fetchLiveRuns.mockResolvedValue([makeStubLiveRun("HiddenRunner")]);

    const res = await callLoader("?type=live-runs");
    const body = (await res.json()) as { liveRuns: Array<{ nickname: string }> };

    expect(body.liveRuns).toEqual([]);
  });

  it("最大20件に制限される", async () => {
    await seedUser(db, {
      slug: "runner1",
      mcid: "Runner1",
      uuid: "uuid-runner1",
      role: "runner",
      profileVisibility: "public",
    });
    pacemanMocks.fetchLiveRuns.mockResolvedValue(
      Array.from({ length: 25 }, () => makeStubLiveRun("Runner1")),
    );

    const res = await callLoader("?type=live-runs");
    const body = (await res.json()) as { liveRuns: unknown[] };

    expect(body.liveRuns).toHaveLength(20);
  });
});
