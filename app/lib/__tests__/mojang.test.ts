// Mojang API連携。formatUuid（純関数）、syncMcid（Cron用のMCID変更検出。
// 握りつぶしてよいエラーの範囲が最重要）、getSkinTextureUrl（textures プロパティの
// base64 デコード）を検証する。
import { describe, it, expect, afterEach, vi } from "vitest";
import { formatUuid, syncMcid, getSkinTextureUrl, MojangError } from "../mojang";

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
