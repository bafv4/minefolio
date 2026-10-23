// Mojang API連携。formatUuid（純関数）、syncMcid（Cron用のMCID変更検出。
// 握りつぶしてよいエラーの範囲が最重要）、getSkinTextureUrl（textures プロパティの
// base64 デコード）、マント関連（toSafeMojangTextureUrl / fetchCapeTextureUrl）を検証する。
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  formatUuid,
  syncMcid,
  getSkinTextureUrl,
  toSafeMojangTextureUrl,
  fetchCapeTextureUrl,
  MojangError,
} from "../mojang";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================
// formatUuid
// ============================================

const HYPHENATED = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NO_HYPHENS = "aaaaaaaabbbbccccddddeeeeeeeeeeee";

describe("formatUuid", () => {
  it("ハイフン無しUUIDに 8-4-4-4-12 のハイフンを付与する", () => {
    expect(formatUuid(NO_HYPHENS)).toBe(HYPHENATED);
  });

  it("ハイフン付きUUIDを入力しても同じ結果になる（冪等性）", () => {
    expect(formatUuid(HYPHENATED)).toBe(HYPHENATED);
    // 2回適用しても結果が変わらない
    expect(formatUuid(formatUuid(HYPHENATED))).toBe(HYPHENATED);
  });
});

// ============================================
// syncMcid
// ============================================

/** SESSION_SERVER_BASE の /session/minecraft/profile/:uuid をスタブする */
function stubSessionProfile(opts: { ok?: boolean; status?: number; name?: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => ({ id: "uuid", name: opts.name ?? "Name", properties: [] }),
    })),
  );
}

describe("syncMcid", () => {
  it("大文字小文字だけが違う場合は changed:false を返す（実際には変更していない）", async () => {
    stubSessionProfile({ name: "dream" });
    const result = await syncMcid("uuid1", "Dream");
    expect(result).toEqual({ changed: false, newMcid: null });
  });

  it("実際にMCIDが変わっていれば changed:true と新MCIDを返す", async () => {
    stubSessionProfile({ name: "NewName" });
    const result = await syncMcid("uuid1", "OldName");
    expect(result).toEqual({ changed: true, newMcid: "NewName" });
  });

  it("UUID_NOT_FOUND（404）は握りつぶして changed:false を返す", async () => {
    stubSessionProfile({ ok: false, status: 404 });
    const result = await syncMcid("uuid1", "Dream");
    expect(result).toEqual({ changed: false, newMcid: null });
  });

  it("UUID_NOT_FOUND（204）も握りつぶして changed:false を返す", async () => {
    stubSessionProfile({ ok: false, status: 204 });
    const result = await syncMcid("uuid1", "Dream");
    expect(result).toEqual({ changed: false, newMcid: null });
  });

  it("UUID_NOT_FOUND 以外のエラーは握りつぶさず rethrow する", async () => {
    stubSessionProfile({ ok: false, status: 500 });
    await expect(syncMcid("uuid1", "Dream")).rejects.toBeInstanceOf(MojangError);
    stubSessionProfile({ ok: false, status: 500 });
    await expect(syncMcid("uuid1", "Dream")).rejects.toMatchObject({ code: "API_ERROR" });
  });
});

// ============================================
// getSkinTextureUrl
// ============================================

/** textures プロパティの value（base64エンコード済みJSON文字列）を生成する */
function encodeTextures(payload: unknown): string {
  return btoa(JSON.stringify(payload));
}

/** properties 配列を持つ session profile レスポンスをスタブする */
function stubSessionProperties(properties: Array<{ name: string; value: string }>, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ id: "uuid", name: "Name", properties }),
    })),
  );
}

describe("getSkinTextureUrl", () => {
  it("textures プロパティを base64 デコードして SKIN の url を返す", async () => {
    const texturesValue = encodeTextures({
      textures: { SKIN: { url: "https://textures.minecraft.net/texture/skin1" } },
    });
    stubSessionProperties([{ name: "textures", value: texturesValue }]);

    const result = await getSkinTextureUrl("skin-uuid-1");
    expect(result).toBe("https://textures.minecraft.net/texture/skin1");
  });

  it("壊れた base64（デコード不能）は null を返す", async () => {
    stubSessionProperties([{ name: "textures", value: "not-valid-base64!!!" }]);
    const result = await getSkinTextureUrl("skin-uuid-2");
    expect(result).toBeNull();
  });

  it("base64はデコードできてもJSONとして不正なら null を返す", async () => {
    stubSessionProperties([{ name: "textures", value: btoa("not json") }]);
    const result = await getSkinTextureUrl("skin-uuid-3");
    expect(result).toBeNull();
  });

  it("デコードした値がスキーマ不一致（textures キー無し）なら null を返す", async () => {
    const texturesValue = encodeTextures({ foo: "bar" });
    stubSessionProperties([{ name: "textures", value: texturesValue }]);

    const result = await getSkinTextureUrl("skin-uuid-4");
    expect(result).toBeNull();
  });

  it("textures プロパティ自体が無ければ null を返す", async () => {
    stubSessionProperties([{ name: "other", value: "x" }]);
    const result = await getSkinTextureUrl("skin-uuid-5");
    expect(result).toBeNull();
  });

  it("SKINが設定されていない（CAPEのみ等）場合は null を返す", async () => {
    const texturesValue = encodeTextures({
      textures: { CAPE: { url: "https://textures.minecraft.net/texture/cape1" } },
    });
    stubSessionProperties([{ name: "textures", value: texturesValue }]);

    const result = await getSkinTextureUrl("skin-uuid-6");
    expect(result).toBeNull();
  });

  it("レスポンスが非2xxなら null を返す", async () => {
    stubSessionProperties([], false);
    const result = await getSkinTextureUrl("skin-uuid-7");
    expect(result).toBeNull();
  });
});

// ============================================
// toSafeMojangTextureUrl
// ============================================

describe("toSafeMojangTextureUrl", () => {
  it("https の textures.minecraft.net はそのまま（https）返す", () => {
    expect(toSafeMojangTextureUrl("https://textures.minecraft.net/texture/abc")).toBe(
      "https://textures.minecraft.net/texture/abc",
    );
  });

  it("http（sessionserver が実際に返す形式）も https に正規化する", () => {
    expect(toSafeMojangTextureUrl("http://textures.minecraft.net/texture/abc")).toBe(
      "https://textures.minecraft.net/texture/abc",
    );
  });

  it("クエリ・フラグメントは正規化後の URL に含めない", () => {
    expect(toSafeMojangTextureUrl("http://textures.minecraft.net/texture/abc?x=1#frag")).toBe(
      "https://textures.minecraft.net/texture/abc",
    );
  });

  it.each([
    ["別ホスト", "https://example.com/texture/abc"],
    ["接尾に別ドメインを付けたホスト", "https://textures.minecraft.net.evil.com/texture/abc"],
    ["userinfo でホストを偽装（@ の後ろが実ホスト）", "https://textures.minecraft.net@evil.com/texture/abc"],
    ["ポート付き", "https://textures.minecraft.net:8443/texture/abc"],
    ["認証情報付き", "https://user:pass@textures.minecraft.net/texture/abc"],
    ["ユーザー名のみの認証情報付き", "https://user@textures.minecraft.net/texture/abc"],
    ["http + ポート付き", "http://textures.minecraft.net:8080/texture/abc"],
    ["http/https 以外のスキーム", "ftp://textures.minecraft.net/texture/abc"],
    ["パース不能な文字列", "not a url"],
    ["空文字", ""],
  ])("%s は null", (_label, raw) => {
    expect(toSafeMojangTextureUrl(raw)).toBeNull();
  });
});

// ============================================
// fetchCapeTextureUrl
// ============================================

const CAPE_TEXTURE_URL = "http://textures.minecraft.net/texture/cape-hash";
const CAPE_TEXTURE_URL_SAFE = "https://textures.minecraft.net/texture/cape-hash";

/** status 指定で session profile レスポンスをスタブし、fetch モックを返す */
function stubSessionResponse(opts: { status: number; json?: unknown }) {
  const fetchMock = vi.fn(async (_input: string | URL, _init?: unknown) => ({
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    json: async () => opts.json,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function profileWithTextures(value: string) {
  return { id: "uuid", name: "Name", properties: [{ name: "textures", value }] };
}

describe("fetchCapeTextureUrl", () => {
  it.each([
    ["204", 204],
    ["404", 404],
  ])("プロフィールが %s ならマント無しとして null を返す（throw しない）", async (_label, status) => {
    stubSessionResponse({ status });
    await expect(fetchCapeTextureUrl("cape-uuid-1")).resolves.toBeNull();
  });

  it("500 は MojangError(API_ERROR) を throw する（マント無しと区別する）", async () => {
    stubSessionResponse({ status: 500 });
    await expect(fetchCapeTextureUrl("cape-uuid-2")).rejects.toBeInstanceOf(MojangError);
    await expect(fetchCapeTextureUrl("cape-uuid-2")).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("429（レート制限）も throw する", async () => {
    stubSessionResponse({ status: 429 });
    await expect(fetchCapeTextureUrl("cape-uuid-3")).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("textures プロパティが無ければ null を返す", async () => {
    stubSessionResponse({
      status: 200,
      json: { id: "uuid", name: "Name", properties: [{ name: "other", value: "x" }] },
    });
    await expect(fetchCapeTextureUrl("cape-uuid-4")).resolves.toBeNull();
  });

  it("textures はあるが CAPE が無ければ null を返す", async () => {
    stubSessionResponse({
      status: 200,
      json: profileWithTextures(
        encodeTextures({ textures: { SKIN: { url: "https://textures.minecraft.net/texture/skin" } } }),
      ),
    });
    await expect(fetchCapeTextureUrl("cape-uuid-5")).resolves.toBeNull();
  });

  it("CAPE があれば https に正規化した URL を返す", async () => {
    stubSessionResponse({
      status: 200,
      json: profileWithTextures(encodeTextures({ textures: { CAPE: { url: CAPE_TEXTURE_URL } } })),
    });
    await expect(fetchCapeTextureUrl("cape-uuid-6")).resolves.toBe(CAPE_TEXTURE_URL_SAFE);
  });

  it("ハイフン付き UUID はハイフンを除去して sessionserver に問い合わせる", async () => {
    const fetchMock = stubSessionResponse({ status: 404 });
    await fetchCapeTextureUrl("01234567-89ab-cdef-0123-456789abcdef");
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/session\/minecraft\/profile\/0123456789abcdef0123456789abcdef$/,
    );
  });

  it("CAPE の URL が別ホストなら throw する（マント無し扱いにしない）", async () => {
    stubSessionResponse({
      status: 200,
      json: profileWithTextures(encodeTextures({ textures: { CAPE: { url: "https://evil.example/cape.png" } } })),
    });
    await expect(fetchCapeTextureUrl("cape-uuid-7")).rejects.toBeInstanceOf(MojangError);
  });

  it("CAPE の URL が userinfo 偽装なら throw する", async () => {
    stubSessionResponse({
      status: 200,
      json: profileWithTextures(
        encodeTextures({ textures: { CAPE: { url: "https://textures.minecraft.net@evil.com/cape.png" } } }),
      ),
    });
    await expect(fetchCapeTextureUrl("cape-uuid-8")).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("textures の base64 が不正なら throw する", async () => {
    stubSessionResponse({ status: 200, json: profileWithTextures("not-valid-base64!!!") });
    await expect(fetchCapeTextureUrl("cape-uuid-9")).rejects.toBeInstanceOf(MojangError);
  });

  it("base64 は妥当でも JSON として不正なら throw する", async () => {
    stubSessionResponse({ status: 200, json: profileWithTextures(btoa("not json")) });
    await expect(fetchCapeTextureUrl("cape-uuid-10")).rejects.toBeInstanceOf(MojangError);
  });

  it("textures がスキーマ不一致（textures キー無し）なら throw する", async () => {
    stubSessionResponse({ status: 200, json: profileWithTextures(encodeTextures({ foo: "bar" })) });
    await expect(fetchCapeTextureUrl("cape-uuid-11")).rejects.toBeInstanceOf(MojangError);
  });

  it("session profile 自体がスキーマ不一致なら throw する", async () => {
    stubSessionResponse({ status: 200, json: { unexpected: true } });
    await expect(fetchCapeTextureUrl("cape-uuid-12")).rejects.toBeInstanceOf(MojangError);
  });
});
