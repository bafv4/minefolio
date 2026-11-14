// /api/home-feed の未カバー分岐（pace-timeline の入力検証・不明 type・live-runs）の回帰テスト。
// youtube-videos / twitch-vods は home-feed-videos.test.ts でカバー済みのため対象外。
//
// live-runs は外部API（PaceMan）を叩くため fetchLiveRuns をモックし、DB に登録済みの mcid
// のみへ絞り込まれること・上限（20件）が効くことを実DBで検証する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  schema,
  seedUser,
  seedPace,
  daysAgo,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { invalidateCache } from "@/lib/cache";
import { USER_DATA_CACHE_KEY } from "@/lib/home-user-data.server";
import { HOME_HIDDEN_USERS_CACHE_KEY } from "@/lib/home-visibility.server";

const pacemanMocks = vi.hoisted(() => ({
  fetchLiveRuns: vi.fn(),
}));

vi.mock("@/lib/paceman", () => ({ fetchLiveRuns: pacemanMocks.fetchLiveRuns }));

const twitchMocks = vi.hoisted(() => ({
  getTwitchAppToken: vi.fn(),
  getLiveStreams: vi.fn(),
}));

vi.mock("@/lib/twitch", () => ({
  getTwitchAppToken: twitchMocks.getTwitchAppToken,
  getLiveStreams: twitchMocks.getLiveStreams,
}));

import { loader } from "../home-feed";

const LIVE_RUNS_CACHE_KEY = "home-feed:live-runs:v3";

const ENV_KEYS = ["TURSO_DATABASE_URL", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"] as const;
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
  await invalidateCache(HOME_HIDDEN_USERS_CACHE_KEY);
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

describe("?type=pace-timeline - 登録有無の秘匿", () => {
  const timelineOf = async (mcid: string, runId: number) =>
    ((await (await callLoader(`?type=pace-timeline&mcid=${mcid}&runId=${runId}`)).json()) as {
      timeline: Array<{ timeline: string }>;
    }).timeline.map((e) => e.timeline);

  it("公開プロフィール（視聴者除外）の mcid は全スプリットを返す（大文字小文字は無視）", async () => {
    await seedUser(db, { slug: "pubrunner", mcid: "PubRunner", uuid: "uuid-pub", role: "runner", profileVisibility: "public" });
    await seedPace(db, { mcid: "PubRunner", pacemanRunId: 501, timeline: "Bastion", rta: 100_000 });
    await seedPace(db, { mcid: "PubRunner", pacemanRunId: 501, timeline: "Fortress", rta: 200_000 });

    expect(await timelineOf("pubrunner", 501)).toEqual(["Bastion", "Fortress"]);
  });

  it("非公開・視聴者・未登録の mcid は、ペースが DB にあっても空（存在しない場合と区別できない）", async () => {
    await seedUser(db, { slug: "privrunner", mcid: "PrivRunner", uuid: "uuid-priv", role: "runner", profileVisibility: "private" });
    await seedUser(db, { slug: "viewerx", mcid: "ViewerX", uuid: "uuid-viewer", role: "viewer", profileVisibility: "public" });
    await seedPace(db, { mcid: "PrivRunner", pacemanRunId: 601, timeline: "Bastion" });
    await seedPace(db, { mcid: "ViewerX", pacemanRunId: 602, timeline: "Bastion" });
    await seedPace(db, { mcid: "Nobody", pacemanRunId: 603, timeline: "Bastion" });

    expect(await timelineOf("PrivRunner", 601)).toEqual([]);
    expect(await timelineOf("ViewerX", 602)).toEqual([]);
    expect(await timelineOf("Nobody", 603)).toEqual([]);
    // 全く存在しない mcid / run と同じ応答
    expect(await timelineOf("NoSuchPlayer", 999)).toEqual([]);
  });
});

describe("?type=live-runs - showTwitchOnHome=false の人の配信リンク", () => {
  it("liveAccount（Twitch で見る・配信中の印の元）を消し、他の人・Twitch 設定オンの人は残す", async () => {
    await seedUser(db, { slug: "twoff", mcid: "TwOff", uuid: "u-off", role: "runner", profileVisibility: "public", showTwitchOnHome: false });
    await seedUser(db, { slug: "twon", mcid: "TwOn", uuid: "u-on", role: "runner", profileVisibility: "public" });
    const run = (nickname: string, liveAccount: string) => ({ ...makeStubLiveRun(nickname), user: { uuid: "x", liveAccount } });
    pacemanMocks.fetchLiveRuns.mockResolvedValue([run("TwOff", "twoff_tv"), run("TwOn", "twon_tv")]);

    const body = (await (await callLoader("?type=live-runs")).json()) as {
      liveRuns: Array<{ nickname: string; user: { liveAccount: string | null } }>;
    };
    const byName = new Map(body.liveRuns.map((r) => [r.nickname, r.user.liveAccount]));
    expect(byName.get("TwOff")).toBeNull(); // ライブランの行自体は残る（PaceMan 設定は別）
    expect(byName.get("TwOn")).toBe("twon_tv");
  });
});

describe("?type=twitch-streams", () => {
  it("配信中の走者にアルファベット表記の表示名（displayNameAlphabet）を載せる（英語表示で他の欄と名前を揃えるため）", async () => {
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "secret";
    await invalidateCache("home-feed:twitch:all:v2");
    await invalidateCache("home-feed:twitch-links:v2");
    const user = await seedUser(db, {
      slug: "tw-runner", mcid: "TwRunner", uuid: "uuid-tw", displayName: "ツイッチ走者", displayNameAlphabet: "Twitch Runner",
      role: "runner", profileVisibility: "public",
    });
    await db.insert(schema.socialLinks).values({ userId: user.id, platform: "twitch", identifier: "twrunner" });
    twitchMocks.getTwitchAppToken.mockResolvedValue("token");
    twitchMocks.getLiveStreams.mockResolvedValue([
      { id: "1", user_login: "twrunner", user_name: "TwRunner", title: "RSG", game_id: "27471", game_name: "Minecraft", viewer_count: 5, started_at: new Date().toISOString() },
    ]);

    const res = await callLoader("?type=twitch-streams");
    const body = (await res.json()) as { liveStreams: Array<{ slug: string; displayName: string | null; displayNameAlphabet: string | null }> };

    expect(body.liveStreams).toHaveLength(1);
    expect(body.liveStreams[0]).toMatchObject({ slug: "tw-runner", displayName: "ツイッチ走者", displayNameAlphabet: "Twitch Runner" });
    await invalidateCache("home-feed:twitch:all:v2");
    await invalidateCache("home-feed:twitch-links:v2");
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

  it("マップは liveRuns に出てくる mcid の分だけ（全公開ユーザー分は載せない）", async () => {
    await seedUser(db, {
      slug: "runner1", mcid: "Runner1", uuid: "uuid-runner1", displayName: "走者1",
      role: "runner", profileVisibility: "public",
    });
    await seedUser(db, {
      slug: "other", mcid: "Other", uuid: "uuid-other", displayName: "他の人",
      role: "runner", profileVisibility: "public",
    });
    pacemanMocks.fetchLiveRuns.mockResolvedValue([makeStubLiveRun("runner1")]);

    const res = await callLoader("?type=live-runs");
    const body = (await res.json()) as Record<string, Record<string, string>>;

    expect(body.mcidToUuid).toEqual({ runner1: "uuid-runner1" });
    expect(body.mcidToSlug).toEqual({ runner1: "runner1" });
    expect(body.mcidToDisplayName).toEqual({ runner1: "走者1" });
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

describe("?type=live-runs / recent-paces - showPacemanOnHome（全員のホームから除外）", () => {
  it("showPacemanOnHome=false の人のライブランは除き、true・null は出す", async () => {
    await seedUser(db, { slug: "off", mcid: "OffRunner", uuid: "uuid-off", role: "runner", profileVisibility: "public", showPacemanOnHome: false });
    await seedUser(db, { slug: "on", mcid: "OnRunner", uuid: "uuid-on", role: "runner", profileVisibility: "public", showPacemanOnHome: true });
    await seedUser(db, { slug: "unset", mcid: "UnsetRunner", uuid: "uuid-unset", role: "runner", profileVisibility: "public", showPacemanOnHome: null });
    pacemanMocks.fetchLiveRuns.mockResolvedValue([
      makeStubLiveRun("offrunner"), // 大文字小文字を無視して照合される
      makeStubLiveRun("OnRunner"),
      makeStubLiveRun("UnsetRunner"),
    ]);

    const res = await callLoader("?type=live-runs");
    const body = (await res.json()) as { liveRuns: Array<{ nickname: string }>; mcidToSlug: Record<string, string> };

    expect(body.liveRuns.map((r) => r.nickname)).toEqual(["OnRunner", "UnsetRunner"]);
    expect(body.mcidToSlug.offrunner).toBeUndefined();
  });

  it("recent-paces からも showPacemanOnHome=false の人のペースを除く", async () => {
    const off = await seedUser(db, { slug: "off", mcid: "OffRunner", uuid: "uuid-off", role: "runner", profileVisibility: "public", showPacemanOnHome: false });
    const on = await seedUser(db, { slug: "on", mcid: "OnRunner", uuid: "uuid-on", role: "runner", profileVisibility: "public" });
    await seedPace(db, { userId: off.id, mcid: "OffRunner", pacemanRunId: 1, timeline: "Bastion", date: daysAgo(0.1) });
    await seedPace(db, { userId: on.id, mcid: "OnRunner", pacemanRunId: 2, timeline: "Bastion", date: daysAgo(0.1) });

    const res = await callLoader("?type=recent-paces");
    const body = (await res.json()) as { recentPaces: Array<{ mcid: string }> };

    expect(body.recentPaces.map((p) => p.mcid)).toEqual(["OnRunner"]);
  });
});

describe("?type=live-runs - 上流失敗", () => {
  it("fetchLiveRuns が null（上流失敗）なら 502 + no-store で返し、キャッシュしない", async () => {
    pacemanMocks.fetchLiveRuns.mockResolvedValue(null);
    const res = await callLoader("?type=live-runs");
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    // 直後に復旧したら失敗がキャッシュされておらず正常応答になる
    pacemanMocks.fetchLiveRuns.mockResolvedValue([]);
    const ok = await callLoader("?type=live-runs");
    expect(ok.status).toBe(200);
  });
});

describe("?type=live-runs - 同区間ベスト（splitBests）", () => {
  it("2つ目の構造物は、同じランで両方に着いたものの遅い方の最小を Second Structure に入れる（種類別のベストとは別）", async () => {
    await seedUser(db, { slug: "sbrunner", mcid: "SbRunner", uuid: "u-sb", role: "runner", profileVisibility: "public" });
    const old = daysAgo(1);
    // ラン 1: Bastion → Fortress（2つ目 = Fortress 250s）
    await seedPace(db, { mcid: "SbRunner", pacemanRunId: 701, timeline: "Bastion", rta: 100_000, date: old });
    await seedPace(db, { mcid: "SbRunner", pacemanRunId: 701, timeline: "Fortress", rta: 250_000, date: old });
    // ラン 2: Fortress → Bastion（2つ目 = Bastion 200s）
    await seedPace(db, { mcid: "SbRunner", pacemanRunId: 702, timeline: "Fortress", rta: 90_000, date: old });
    await seedPace(db, { mcid: "SbRunner", pacemanRunId: 702, timeline: "Bastion", rta: 200_000, date: old });
    // ラン 3: Bastion だけ（2つ目なし）
    await seedPace(db, { mcid: "SbRunner", pacemanRunId: 703, timeline: "Bastion", rta: 80_000, date: old });
    // 直近3時間のラン（進行中のラン自身）は比較対象にしない
    await seedPace(db, { mcid: "SbRunner", pacemanRunId: 704, timeline: "Bastion", rta: 150_000 });
    await seedPace(db, { mcid: "SbRunner", pacemanRunId: 704, timeline: "Fortress", rta: 160_000 });
    pacemanMocks.fetchLiveRuns.mockResolvedValue([makeStubLiveRun("SbRunner")]);

    const body = (await (await callLoader("?type=live-runs")).json()) as {
      splitBests: Record<string, Record<string, number>>;
    };
    expect(body.splitBests.sbrunner).toEqual({ Bastion: 80_000, Fortress: 90_000, "Second Structure": 200_000 });
  });
});
