// /api/skin の Cache-Control 出し分けと、カスタムスキンURLの再検証（SSRF 防止）の回帰テスト。
//
// 守りたい退行は2つ:
// 1. Mojang API が 429/5xx を返したときの Steve は「一時的な代替」なので短TTL・SWRなしで返す。
//    ここを長TTLヘッダーにすると、Mojang の一時障害中に配信された Steve が共有CDN（Vercel Edge）に
//    最大1日残り、復旧後も全訪問者に Steve が出続ける（実際に踏んだ事故）。
// 2. DB に保存済みの customSkinUrl も取得時に parseVercelBlobUrl で再検証する。
//    保存経路をすり抜けた（あるいは過去に保存された）不正URLを、サーバー側 fetch の宛先にしない。
//
// 外部HTTPは境界なので fetch をスタブし、DB は実DB（in-memory）を使う。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { loader } from "../skin";

// 実装（app/routes/api/skin.ts）と同じ値。ここが変わったら意図した変更か確認する
const LONG_CACHE = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";
const SHORT_CACHE = "public, max-age=300, s-maxage=300";

const STEVE_SKIN_URL =
  "https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb";
const TEXTURE_URL = "https://textures.minecraft.net/texture/custom-player-texture";
const BLOB_SKIN_URL = "https://store123.public.blob.vercel-storage.com/skins/abc/skin.png";
const UUID = "0123456789abcdef0123456789abcdef";

// レスポンス本文をURLごとに変えて「どのスキンが返ったか」を判別できるようにする
const STEVE_BYTES = [1, 1, 1];
const TEXTURE_BYTES = [2, 2, 2];
const BLOB_BYTES = [3, 3, 3];

function mojangProfileUrl(uuid: string): string {
  return `https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, "")}`;
}

/** Mojang のプロフィール応答（textures プロパティ入り） */
function profileJson(skinUrl: string) {
  return {
    id: UUID,
    name: "Runner",
    properties: [
      {
        name: "textures",
        value: btoa(JSON.stringify({ textures: { SKIN: { url: skinUrl } } })),
      },
    ],
  };
}

interface StubEntry {
  ok: boolean;
  status: number;
  json?: unknown;
  body?: number[];
}

/** URL → 応答のテーブルで fetch をスタブする。未登録URLは 404 扱い */
function stubFetch(routes: Record<string, StubEntry>) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const entry = routes[url] ?? { ok: false, status: 404 };
    return {
      ok: entry.ok,
      status: entry.status,
      json: async () => entry.json,
      arrayBuffer: async () => new Uint8Array(entry.body ?? []).buffer,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** fetch されたURL一覧 */
function fetchedUrls(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

async function callLoader(search: string): Promise<Response> {
  const request = new Request(`https://minefolio.app/api/skin${search}`);
  return loader({ request, params: {}, context: {} } as never);
}

async function bodyBytes(res: Response): Promise<number[]> {
  return Array.from(new Uint8Array(await res.arrayBuffer()));
}

const ENV_KEYS = ["TURSO_DATABASE_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("Mojang API 失敗時のキャッシュヘッダー", () => {
  it.each([
    ["レート制限（429）", 429],
    ["サーバーエラー（500）", 500],
    ["サービス停止（503）", 503],
  ])("%s では Steve を短TTLで返す（CDNに長期滞留させない）", async (_label, status) => {
    stubFetch({
      [mojangProfileUrl(UUID)]: { ok: false, status },
      [STEVE_SKIN_URL]: { ok: true, status: 200, body: STEVE_BYTES },
    });

    const res = await callLoader(`?uuid=${UUID}`);

    expect(res.status).toBe(200);
    expect(await bodyBytes(res)).toEqual(STEVE_BYTES);
    expect(res.headers.get("Cache-Control")).toBe(SHORT_CACHE);
    expect(res.headers.get("Cache-Control")).not.toContain("stale-while-revalidate");
  });

  it("プロフィールは取れてもテクスチャ取得に失敗したら Steve を短TTLで返す", async () => {
    stubFetch({
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileJson(TEXTURE_URL) },
      [TEXTURE_URL]: { ok: false, status: 500 },
      [STEVE_SKIN_URL]: { ok: true, status: 200, body: STEVE_BYTES },
    });

    const res = await callLoader(`?uuid=${UUID}`);

    expect(await bodyBytes(res)).toEqual(STEVE_BYTES);
    expect(res.headers.get("Cache-Control")).toBe(SHORT_CACHE);
  });
});

describe("Mojang API 成功時のキャッシュヘッダー", () => {
  it("テクスチャを解決できたら長TTL + stale-while-revalidate で返す", async () => {
    stubFetch({
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileJson(TEXTURE_URL) },
      [TEXTURE_URL]: { ok: true, status: 200, body: TEXTURE_BYTES },
    });

    const res = await callLoader(`?uuid=${UUID}`);

    expect(res.status).toBe(200);
    expect(await bodyBytes(res)).toEqual(TEXTURE_BYTES);
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
  });

  it("textures プロパティが無い（スキン未設定）正規の Steve は長TTLでよい", async () => {
    stubFetch({
      [mojangProfileUrl(UUID)]: {
        ok: true,
        status: 200,
        json: { id: UUID, name: "Runner", properties: [] },
      },
      [STEVE_SKIN_URL]: { ok: true, status: 200, body: STEVE_BYTES },
    });

    const res = await callLoader(`?uuid=${UUID}`);

    expect(await bodyBytes(res)).toEqual(STEVE_BYTES);
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
  });

  it("ハイフン付きUUIDでもハイフンを除去して問い合わせる", async () => {
    const hyphenated = "01234567-89ab-cdef-0123-456789abcdef";
    const fetchMock = stubFetch({
      [mojangProfileUrl(hyphenated)]: { ok: true, status: 200, json: profileJson(TEXTURE_URL) },
      [TEXTURE_URL]: { ok: true, status: 200, body: TEXTURE_BYTES },
    });

    const res = await callLoader(`?uuid=${hyphenated}`);

    expect(res.status).toBe(200);
    expect(fetchedUrls(fetchMock)[0]).toBe(mojangProfileUrl(hyphenated));
  });
});

describe("customSkinUrl の再検証（保存済み不正URLへのSSRF防止）", () => {
  it("信頼されないホストの customSkinUrl は fetch せず Mojang 経路へ落ちる", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      uuid: UUID,
      customSkinUrl: "https://evil.example/skin.png",
    });
    const fetchMock = stubFetch({
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileJson(TEXTURE_URL) },
      [TEXTURE_URL]: { ok: true, status: 200, body: TEXTURE_BYTES },
    });

    const res = await callLoader(`?userId=${user.id}`);

    const urls = fetchedUrls(fetchMock);
    expect(urls.some((url) => url.includes("evil.example"))).toBe(false);
    expect(urls[0]).toBe(mojangProfileUrl(UUID));
    expect(await bodyBytes(res)).toEqual(TEXTURE_BYTES);
  });

  it("フラグメントに正規ホスト名を混ぜたIPリテラルURLも fetch しない", async () => {
    const user = await seedUser(db, {
      slug: "ssrf",
      discordId: "discord-ssrf",
      uuid: UUID,
      customSkinUrl: "https://169.254.169.254/latest/meta-data/#blob.vercel-storage.com",
    });
    const fetchMock = stubFetch({
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileJson(TEXTURE_URL) },
      [TEXTURE_URL]: { ok: true, status: 200, body: TEXTURE_BYTES },
    });

    await callLoader(`?userId=${user.id}`);

    expect(fetchedUrls(fetchMock).some((url) => url.includes("169.254.169.254"))).toBe(false);
  });

  it("正規の Vercel Blob URL なら fetch して長TTLで返す（対照）", async () => {
    const user = await seedUser(db, {
      slug: "custom",
      discordId: "discord-custom",
      uuid: UUID,
      customSkinUrl: BLOB_SKIN_URL,
    });
    const fetchMock = stubFetch({
      [BLOB_SKIN_URL]: { ok: true, status: 200, body: BLOB_BYTES },
    });

    const res = await callLoader(`?userId=${user.id}`);

    expect(fetchedUrls(fetchMock)).toEqual([BLOB_SKIN_URL]);
    expect(await bodyBytes(res)).toEqual(BLOB_BYTES);
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
  });

  it("Blob の取得に失敗した場合は Mojang 経路へフォールバックする", async () => {
    const user = await seedUser(db, {
      slug: "fallback",
      discordId: "discord-fallback",
      uuid: UUID,
      customSkinUrl: BLOB_SKIN_URL,
    });
    stubFetch({
      [BLOB_SKIN_URL]: { ok: false, status: 404 },
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileJson(TEXTURE_URL) },
      [TEXTURE_URL]: { ok: true, status: 200, body: TEXTURE_BYTES },
    });

    const res = await callLoader(`?userId=${user.id}`);

    expect(await bodyBytes(res)).toEqual(TEXTURE_BYTES);
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
  });
});

describe("パラメータ不足", () => {
  it("uuid も userId も無ければ 400（外部へは問い合わせない）", async () => {
    const fetchMock = stubFetch({});

    const res = await callLoader("");

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
