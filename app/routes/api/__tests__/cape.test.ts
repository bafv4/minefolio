// GET /api/cape の入力検証・Cache-Control 出し分け・サイズ上限の回帰テスト。
//
// 守りたい挙動:
// 1. uuid が不正/欠落なら 400（外部へは問い合わせない）。
// 2. マント有無が確定した応答（200 / 404）は長TTL。Mojang 側の失敗（502）は短TTL・SWR なし
//    （一時障害の失敗応答が共有CDNに長期滞留しないように。/api/skin と同じ方針）。
// 3. 想定外に大きい本体（1MB 超）は中継しない。
//
// 外部HTTPは境界なので fetch をスタブする（/api/skin のテストと同じ方式）。DB は使わない。
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { loader } from "../cape";

// 実装（app/routes/api/cape.ts）と同じ値。ここが変わったら意図した変更か確認する
const LONG_CACHE = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";
const SHORT_CACHE = "public, max-age=300, s-maxage=300";
const MAX_CAPE_BYTES = 1024 * 1024;

const UUID = "0123456789abcdef0123456789abcdef";
const HYPHENATED_UUID = "01234567-89ab-cdef-0123-456789abcdef";
const CAPE_TEXTURE_URL = "https://textures.minecraft.net/texture/cape-hash";
const CAPE_BYTES = [9, 8, 7];

function mojangProfileUrl(uuid: string): string {
  return `https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, "")}`;
}

/** Mojang のプロフィール応答（textures プロパティ入り） */
function profileJson(textures: unknown) {
  return {
    id: UUID,
    name: "Runner",
    properties: [{ name: "textures", value: btoa(JSON.stringify(textures)) }],
  };
}

function profileWithCape(capeUrl: string = CAPE_TEXTURE_URL) {
  return profileJson({ textures: { CAPE: { url: capeUrl } } });
}

interface StubEntry {
  ok: boolean;
  status: number;
  json?: unknown;
  body?: ArrayBuffer;
  /** true なら fetch 自体を reject（通信例外・redirect:"error" 違反等） */
  throws?: boolean;
}

/** URL → 応答のテーブルで fetch をスタブする。未登録URLは 404 扱い */
function stubFetch(routes: Record<string, StubEntry>) {
  const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = String(input);
    const entry = routes[url] ?? { ok: false, status: 404 };
    if (entry.throws) throw new Error("network failure");
    return {
      ok: entry.ok,
      status: entry.status,
      json: async () => entry.json,
      arrayBuffer: async () => entry.body ?? new ArrayBuffer(0),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bytes(values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

async function callLoader(search: string): Promise<Response> {
  const request = new Request(`https://minefolio.app/api/cape${search}`);
  return loader({ request, params: {}, context: {} } as never);
}

async function bodyBytes(res: Response): Promise<number[]> {
  return Array.from(new Uint8Array(await res.arrayBuffer()));
}

beforeEach(() => {
  // 失敗系では実装が console.error を出す。出力を汚さないよう黙らせる
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uuid の検証", () => {
  it.each([
    ["欠落", ""],
    ["空", "?uuid="],
    ["短すぎる", "?uuid=abc123"],
    ["hex 以外の文字を含む（32桁）", "?uuid=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"],
    ["パストラバーサル風", "?uuid=..%2F..%2Fetc%2Fpasswd"],
    ["ハイフン位置が不正", "?uuid=0123456789abcdef-0123456789abcdef"],
    ["末尾に余計な文字", `?uuid=${UUID}x`],
  ])("%s は 400 で外部へ問い合わせない", async (_label, search) => {
    const fetchMock = stubFetch({});

    const res = await callLoader(search);

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ハイフン付き UUID（8-4-4-4-12）は受理しハイフンを除去して問い合わせる", async () => {
    const fetchMock = stubFetch({
      [mojangProfileUrl(HYPHENATED_UUID)]: { ok: true, status: 200, json: profileWithCape() },
      [CAPE_TEXTURE_URL]: { ok: true, status: 200, body: bytes(CAPE_BYTES) },
    });

    const res = await callLoader(`?uuid=${HYPHENATED_UUID}`);

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(mojangProfileUrl(UUID));
  });
});

describe("マント無し（404）", () => {
  it.each([
    ["プロフィールが 204", { ok: true, status: 204 }],
    ["プロフィールが 404", { ok: false, status: 404 }],
  ])("%s なら 404 + 長TTL（マント無しはキャッシュしてよい）", async (_label, entry) => {
    stubFetch({ [mojangProfileUrl(UUID)]: entry });

    const res = await callLoader(`?uuid=${UUID}`);

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
  });

  it("textures に CAPE が無ければ 404 + 長TTL で、テクスチャは取りに行かない", async () => {
    const fetchMock = stubFetch({
      [mojangProfileUrl(UUID)]: {
        ok: true,
        status: 200,
        json: profileJson({
          textures: { SKIN: { url: "https://textures.minecraft.net/texture/skin" } },
        }),
      },
    });

    const res = await callLoader(`?uuid=${UUID}`);

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("マントあり（200）", () => {
  it("PNG として本体を返し、長TTL + stale-while-revalidate", async () => {
    stubFetch({
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileWithCape() },
      [CAPE_TEXTURE_URL]: { ok: true, status: 200, body: bytes(CAPE_BYTES) },
    });

    const res = await callLoader(`?uuid=${UUID}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
    expect(await bodyBytes(res)).toEqual(CAPE_BYTES);
  });

  it("sessionserver が http:// を返しても https で取得し、redirect:\"error\" で辿らない", async () => {
    const fetchMock = stubFetch({
      [mojangProfileUrl(UUID)]: {
        ok: true,
        status: 200,
        json: profileWithCape("http://textures.minecraft.net/texture/cape-hash"),
      },
      [CAPE_TEXTURE_URL]: { ok: true, status: 200, body: bytes(CAPE_BYTES) },
    });

    const res = await callLoader(`?uuid=${UUID}`);

    expect(res.status).toBe(200);
    const textureCall = fetchMock.mock.calls[1];
    expect(String(textureCall?.[0])).toBe(CAPE_TEXTURE_URL);
    expect(textureCall?.[1]).toMatchObject({ redirect: "error" });
  });

  it("ちょうど 1MB の本体は中継する（境界値）", async () => {
    stubFetch({
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileWithCape() },
      [CAPE_TEXTURE_URL]: { ok: true, status: 200, body: new ArrayBuffer(MAX_CAPE_BYTES) },
    });

    const res = await callLoader(`?uuid=${UUID}`);

    expect(res.status).toBe(200);
  });
});

describe("上流の失敗（502 + 短TTL）", () => {
  const expectShortTtl = (res: Response) => {
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe(SHORT_CACHE);
    expect(res.headers.get("Cache-Control")).not.toContain("stale-while-revalidate");
  };

  it.each([
    ["レート制限（429）", 429],
    ["サーバーエラー（500）", 500],
    ["サービス停止（503）", 503],
  ])("sessionserver が %s なら 502 + 短TTL", async (_label, status) => {
    stubFetch({ [mojangProfileUrl(UUID)]: { ok: false, status } });

    expectShortTtl(await callLoader(`?uuid=${UUID}`));
  });

  it("sessionserver の通信例外も 502 + 短TTL", async () => {
    stubFetch({ [mojangProfileUrl(UUID)]: { ok: false, status: 0, throws: true } });

    expectShortTtl(await callLoader(`?uuid=${UUID}`));
  });

  it("プロフィールは取れてもテクスチャ取得が非 2xx なら 502 + 短TTL", async () => {
    stubFetch({
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileWithCape() },
      [CAPE_TEXTURE_URL]: { ok: false, status: 500 },
    });

    expectShortTtl(await callLoader(`?uuid=${UUID}`));
  });

  it("テクスチャ取得の通信例外（リダイレクト拒否含む）も 502 + 短TTL", async () => {
    stubFetch({
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileWithCape() },
      [CAPE_TEXTURE_URL]: { ok: false, status: 0, throws: true },
    });

    expectShortTtl(await callLoader(`?uuid=${UUID}`));
  });

  it("本体が 1MB を超えたら 502 + 短TTL（中継しない）", async () => {
    stubFetch({
      [mojangProfileUrl(UUID)]: { ok: true, status: 200, json: profileWithCape() },
      [CAPE_TEXTURE_URL]: { ok: true, status: 200, body: new ArrayBuffer(MAX_CAPE_BYTES + 1) },
    });

    expectShortTtl(await callLoader(`?uuid=${UUID}`));
  });

  it("CAPE の URL が別ホストなら取得せず 502 + 短TTL（SSRF 防止）", async () => {
    const fetchMock = stubFetch({
      [mojangProfileUrl(UUID)]: {
        ok: true,
        status: 200,
        json: profileWithCape("https://evil.example/cape.png"),
      },
    });

    expectShortTtl(await callLoader(`?uuid=${UUID}`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("textures プロパティが壊れていたら 502 + 短TTL", async () => {
    stubFetch({
      [mojangProfileUrl(UUID)]: {
        ok: true,
        status: 200,
        json: {
          id: UUID,
          name: "Runner",
          properties: [{ name: "textures", value: "not-valid-base64!!!" }],
        },
      },
    });

    expectShortTtl(await callLoader(`?uuid=${UUID}`));
  });
});
