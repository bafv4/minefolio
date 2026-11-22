// targeted-refresh.server.ts の各即時リフレッシュ関数は、プロフィール編集の action から
// レスポンスを返した後にバックグラウンドで呼ばれる想定のため、必要な環境変数
// （TWITCH_CLIENT_ID/SECRET・YOUTUBE_API_KEY）が未設定でも action をブロック・失敗させては
// いけない（ファイル冒頭のコメント参照）。ここでは env 未設定時に外部APIを一切呼ばず
// no-op で完了する（throwしない）ことを検証する。
//
// 外部API層（twitch.ts / youtube.ts / twitch-vod-cache.ts / youtube-cache.ts）はモックし、
// env 未設定時にそれらが一切呼ばれないことを確認する。DBのみを触る箇所は実DBで検証する
// （twitch-vod-cache.test.ts / youtube-cache.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  schema,
  type TestDb,
} from "./helpers/test-db";

const twitchMocks = vi.hoisted(() => ({
  getTwitchAppToken: vi.fn(),
  getRecentVods: vi.fn(),
}));
vi.mock("../twitch", () => twitchMocks);

const twitchVodCacheMocks = vi.hoisted(() => ({
  applyFetchedVods: vi.fn(),
  findKnownVodIds: vi.fn(),
}));
vi.mock("../twitch-vod-cache", () => twitchVodCacheMocks);

const youtubeMocks = vi.hoisted(() => ({
  resolveChannelId: vi.fn(),
}));
vi.mock("../youtube", () => youtubeMocks);

const youtubeCacheMocks = vi.hoisted(() => ({
  fetchChannelUploadsForCache: vi.fn(),
  upsertVideoCache: vi.fn(),
}));
vi.mock("../youtube-cache", () => youtubeCacheMocks);

import {
  refreshTwitchVodsForLogin,
  refreshYoutubeForChannel,
  deleteTwitchVodsForLogin,
  deleteYoutubeVideosForChannelIdentifier,
  refreshSrcRankingsForUser,
} from "../targeted-refresh.server";

const ENV_KEYS = [
  "TURSO_DATABASE_URL",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "YOUTUBE_API_KEY",
] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("refreshTwitchVodsForLogin", () => {
  it("TWITCH_CLIENT_ID/SECRET未設定時はAPIを一切呼ばずno-opで完了する（throwしない）", async () => {
    await expect(refreshTwitchVodsForLogin("someuser")).resolves.toBeUndefined();

    expect(twitchMocks.getTwitchAppToken).not.toHaveBeenCalled();
    expect(twitchMocks.getRecentVods).not.toHaveBeenCalled();
    expect(twitchVodCacheMocks.applyFetchedVods).not.toHaveBeenCalled();
  });

  it("トークン取得に失敗した場合もVOD取得へ進まずno-opで完了する（throwしない）", async () => {
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "secret";
    twitchMocks.getTwitchAppToken.mockResolvedValue(null);

    await expect(refreshTwitchVodsForLogin("someuser")).resolves.toBeUndefined();

    expect(twitchMocks.getRecentVods).not.toHaveBeenCalled();
    expect(twitchVodCacheMocks.applyFetchedVods).not.toHaveBeenCalled();
  });
});

describe("refreshYoutubeForChannel", () => {
  it("YOUTUBE_API_KEY未設定時はAPIを一切呼ばずno-opで完了する（throwしない）", async () => {
    await expect(refreshYoutubeForChannel("@somechannel", "mcid1")).resolves.toBeUndefined();

    expect(youtubeCacheMocks.fetchChannelUploadsForCache).not.toHaveBeenCalled();
    expect(youtubeCacheMocks.upsertVideoCache).not.toHaveBeenCalled();
  });
});

/** twitch_vod_cache に VOD を1行入れる */
async function seedVod(vodId: string, userLogin: string) {
  await db.insert(schema.twitchVodCache).values({ vodId, userLogin, title: "t", publishedAt: new Date() });
}

describe("deleteTwitchVodsForLogin", () => {
  it("自分以外のユーザーが同じloginのtwitchリンクを持っているときは、VODキャッシュを消さない", async () => {
    const attacker = await seedUser(db, { slug: "attacker", discordId: "d-attacker" });
    const victim = await seedUser(db, { slug: "victim", discordId: "d-victim" });
    // 被害者は MixedCase で登録（大文字小文字を無視して一致することも確認する）
    await db.insert(schema.socialLinks).values({ userId: victim.id, platform: "twitch", identifier: "VictimCh" });
    await seedVod("1", "victimch");

    // 攻撃者は同じloginでリンクを作って外した（呼び出し時点で攻撃者のリンクは既に無い）
    await deleteTwitchVodsForLogin("victimch", { userId: attacker.id, mcids: [] });

    expect(await db.query.twitchVodCache.findMany()).toHaveLength(1);
  });

  it("ほかに登録者がいなければ（自分のリンクだけだったなら）、大文字小文字を無視して削除する", async () => {
    const me = await seedUser(db, { slug: "me", discordId: "d-me" });
    // 他人は別チャンネル。自分のリンク行が残っていても「自分以外」ではないので判定に影響しない
    const other = await seedUser(db, { slug: "other", discordId: "d-other" });
    await db.insert(schema.socialLinks).values({ userId: other.id, platform: "twitch", identifier: "otherch" });
    await db.insert(schema.socialLinks).values({ userId: me.id, platform: "twitch", identifier: "MyCh" });
    await seedVod("1", "mych");
    await seedVod("2", "otherch");

    await deleteTwitchVodsForLogin("MyCh", { userId: me.id, mcids: [] });

    const rows = await db.query.twitchVodCache.findMany();
    expect(rows.map((r) => r.vodId)).toEqual(["2"]);
  });

  it("他人の youtube リンクなど別プラットフォームの同名identifierは判定に使わない", async () => {
    const me = await seedUser(db, { slug: "me", discordId: "d-me" });
    const other = await seedUser(db, { slug: "other", discordId: "d-other" });
    await db.insert(schema.socialLinks).values({ userId: other.id, platform: "youtube", identifier: "mych" });
    await seedVod("1", "mych");

    await deleteTwitchVodsForLogin("mych", { userId: me.id, mcids: [] });

    expect(await db.query.twitchVodCache.findMany()).toHaveLength(0);
  });
});

describe("deleteYoutubeVideosForChannelIdentifier", () => {
  const CHANNEL = "UC000000000000000000gone";

  it("本人のMCIDに帰属した行だけを削除し、他の走者のMCIDに帰属した同一チャンネルの行は残す（大文字小文字は無視）", async () => {
    await db.insert(schema.youtubeVideoCache).values([
      { videoId: "mine", channelId: CHANNEL, minefolioMcid: "MyMcid", title: "t", publishedAt: new Date() },
      { videoId: "theirs", channelId: CHANNEL, minefolioMcid: "VictimMcid", title: "t", publishedAt: new Date() },
      { videoId: "unattributed", channelId: CHANNEL, minefolioMcid: null, title: "t", publishedAt: new Date() },
      { videoId: "elsewhere", channelId: "UC000000000000000000else", minefolioMcid: "MyMcid", title: "t", publishedAt: new Date() },
    ]);

    await deleteYoutubeVideosForChannelIdentifier(CHANNEL, { userId: "u1", mcids: ["mymcid"] });

    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows.map((r) => r.videoId).sort()).toEqual(["elsewhere", "theirs", "unattributed"]);
  });

  it("MCIDを変更する保存では旧・新どちらのMCIDに帰属した行も削除する", async () => {
    await db.insert(schema.youtubeVideoCache).values([
      { videoId: "old", channelId: CHANNEL, minefolioMcid: "OldMcid", title: "t", publishedAt: new Date() },
      { videoId: "new", channelId: CHANNEL, minefolioMcid: "NewMcid", title: "t", publishedAt: new Date() },
      { videoId: "theirs", channelId: CHANNEL, minefolioMcid: "Other", title: "t", publishedAt: new Date() },
    ]);

    await deleteYoutubeVideosForChannelIdentifier(CHANNEL, { userId: "u1", mcids: ["OldMcid", null, "NewMcid"] });

    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows.map((r) => r.videoId)).toEqual(["theirs"]);
  });

  it("本人のMCIDが無ければ何も消さない（取得がスキップされるため帰属行も無い）", async () => {
    await db.insert(schema.youtubeVideoCache).values({
      videoId: "keep",
      channelId: CHANNEL,
      minefolioMcid: "Someone",
      title: "t",
      publishedAt: new Date(),
    });

    await deleteYoutubeVideosForChannelIdentifier(CHANNEL, { userId: "u1", mcids: [null] });

    expect(await db.query.youtubeVideoCache.findMany()).toHaveLength(1);
  });

  it("ハンドル形式かつYOUTUBE_API_KEY未設定時はチャンネルIDを解決できずno-opで完了する（throwしない）", async () => {
    await db.insert(schema.youtubeVideoCache).values({
      videoId: "keep1",
      channelId: "UC000000000000000000keep",
      minefolioMcid: "Mcid1",
      title: "t",
      publishedAt: new Date(),
    });

    await expect(
      deleteYoutubeVideosForChannelIdentifier("@somehandle", { userId: "u1", mcids: ["Mcid1"] }),
    ).resolves.toBeUndefined();

    // apiKeyが無ければハンドル解決（resolveChannelId）自体を試みない
    expect(youtubeMocks.resolveChannelId).not.toHaveBeenCalled();

    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows).toHaveLength(1);
  });

  it("UCチャンネルID形式ならYOUTUBE_API_KEY未設定でも解決不要のため削除できる", async () => {
    await db.insert(schema.youtubeVideoCache).values({
      videoId: "gone1",
      channelId: "UC000000000000000000gone",
      minefolioMcid: "Mcid1",
      title: "t",
      publishedAt: new Date(),
    });

    await expect(
      deleteYoutubeVideosForChannelIdentifier("UC000000000000000000gone", { userId: "u1", mcids: ["Mcid1"] }),
    ).resolves.toBeUndefined();

    expect(youtubeMocks.resolveChannelId).not.toHaveBeenCalled();
    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows).toHaveLength(0);
  });
});

describe("refreshSrcRankingsForUser", () => {
  it("該当ユーザーが存在しない場合はno-opで完了する（throwしない）", async () => {
    await expect(refreshSrcRankingsForUser("nonexistent-user-id")).resolves.toBeUndefined();
  });
});
