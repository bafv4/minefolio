// /player/:slug 404時の解決（resolvePlayerSlugFallback）の回帰テスト。
// 2段構成: 1. slug_history（DB内、確実） 2. Mojang UUIDフォールバック（履歴ミス時のみ）。
//
// @/lib/mojang は fetchUuidFromMcid のみ差し替え、MojangError は実クラスをそのまま使う
// （player-slug-fallback.server.ts 側の `error instanceof MojangError` 判定と同一クラス参照に
// するため importOriginal で実モジュールを土台にする。パターンは app/routes/__tests__/onboarding.test.ts
// と同じ）。
//
// app/lib/cache.ts のインメモリキャッシュ（正引き・ネガティブキャッシュとも）はモジュール
// グローバルでテストファイル内の全テストを跨いで残り続ける。テストごとに異なるMCID文字列を
// 使うことで、あるテストが仕込んだキャッシュが別テストの結果に漏れ出さないようにしている。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "./helpers/test-db";
import { seedUser } from "./helpers/test-db";
import { recordSlugChange } from "../slug-history.server";

const mojangMocks = vi.hoisted(() => ({
  fetchUuidFromMcid: vi.fn(),
}));

vi.mock("../mojang", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mojang")>();
  return {
    ...actual,
    fetchUuidFromMcid: mojangMocks.fetchUuidFromMcid,
  };
});

import { MojangError } from "../mojang";
import { resolvePlayerSlugFallback } from "../player-slug-fallback.server";

let mcidCounter = 0;
/** テストごとに固有のMCID形状文字列を発行する（キャッシュ汚染回避のため） */
function uniqueMcid(): string {
  mcidCounter += 1;
  return `TestMcid${mcidCounter}`;
}

beforeEach(() => {
  mojangMocks.fetchUuidFromMcid.mockReset();
});

describe("resolvePlayerSlugFallback - slug_history 優先解決", () => {
  it("履歴にヒットしたら現在の slug を返し、Mojang（fetchUuidFromMcid）は呼ばれない", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "current-after-rename", profileVisibility: "public" });
    await recordSlugChange(db, {
      userId: user.id,
      oldSlug: "OldMcidBeforeRename",
      newSlug: "current-after-rename",
    });

    const result = await resolvePlayerSlugFallback(db, "OldMcidBeforeRename");

    expect(result).toBe("current-after-rename");
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });

  it("`@discordId` 形式の旧slug（MCID形状ガードでは弾かれる形）も履歴経由なら解決される", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "now-has-mcid", profileVisibility: "public" });
    await recordSlugChange(db, {
      userId: user.id,
      oldSlug: "@discord-123456",
      newSlug: "now-has-mcid",
    });

    const result = await resolvePlayerSlugFallback(db, "@discord-123456");

    expect(result).toBe("now-has-mcid");
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });

  it("履歴がミスした場合は従来どおり Mojang レイヤに進む（デグレなし）", async () => {
    const db = await createTestDb();
    const UUID = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
    const user = await seedUser(db, {
      uuid: UUID,
      slug: "current-via-mojang",
      profileVisibility: "public",
    });
    mojangMocks.fetchUuidFromMcid.mockResolvedValue(UUID);

    const result = await resolvePlayerSlugFallback(db, uniqueMcid());

    expect(result).toBe(user.slug);
    expect(mojangMocks.fetchUuidFromMcid).toHaveBeenCalledTimes(1);
  });
});

describe("resolvePlayerSlugFallback - MCID形状バリデーション", () => {
  it.each([
    ["ab", "2文字（3文字未満）"],
    ["a".repeat(17), "17文字（16文字超過）"],
    ["abc-def", "記号入り（ハイフン）"],
    ["@123456", "@discordId形式の生成slug"],
  ])("形状不一致の slug '%s'（%s）は fetchUuidFromMcid を呼ばず null を返す", async (slug) => {
    const db = await createTestDb();
    const result = await resolvePlayerSlugFallback(db, slug);
    expect(result).toBeNull();
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });
});

describe("resolvePlayerSlugFallback - Mojang 404（MCID_NOT_FOUND）", () => {
  it("null を返し、15分以内の再呼び出しはネガティブキャッシュされ fetchUuidFromMcid が再度呼ばれない", async () => {
    const db = await createTestDb();
    const mcid = uniqueMcid();
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(
      new MojangError("MCID_NOT_FOUND", "Minecraft ID not found"),
    );

    const first = await resolvePlayerSlugFallback(db, mcid);
    expect(first).toBeNull();
    expect(mojangMocks.fetchUuidFromMcid).toHaveBeenCalledTimes(1);

    const second = await resolvePlayerSlugFallback(db, mcid);
    expect(second).toBeNull();
    // ネガティブキャッシュにより2回目は fetchUuidFromMcid を呼ばない
    expect(mojangMocks.fetchUuidFromMcid).toHaveBeenCalledTimes(1);
  });
});

describe("resolvePlayerSlugFallback - Mojang 一時障害（API_ERROR・タイムアウト等）", () => {
  it("null を返すが、ネガティブキャッシュはされず次回も再試行される（API_ERROR）", async () => {
    const db = await createTestDb();
    const mcid = uniqueMcid();
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(
      new MojangError("API_ERROR", "Mojang API error: 500"),
    );

    const first = await resolvePlayerSlugFallback(db, mcid);
    expect(first).toBeNull();
    expect(mojangMocks.fetchUuidFromMcid).toHaveBeenCalledTimes(1);

    const second = await resolvePlayerSlugFallback(db, mcid);
    expect(second).toBeNull();
    // 一時障害はキャッシュしないため2回目も fetchUuidFromMcid が再度呼ばれる
    expect(mojangMocks.fetchUuidFromMcid).toHaveBeenCalledTimes(2);
  });

  it("MojangError 以外の例外（タイムアウト等）も握りつぶして null を返す（例外を投げない）", async () => {
    const db = await createTestDb();
    const mcid = uniqueMcid();
    mojangMocks.fetchUuidFromMcid.mockRejectedValue(
      new DOMException("The operation was aborted", "TimeoutError"),
    );

    await expect(resolvePlayerSlugFallback(db, mcid)).resolves.toBeNull();

    // タイムアウト等の一時障害もキャッシュされないため再試行できる
    const second = await resolvePlayerSlugFallback(db, mcid);
    expect(second).toBeNull();
    expect(mojangMocks.fetchUuidFromMcid).toHaveBeenCalledTimes(2);
  });
});

describe("resolvePlayerSlugFallback - 正常解決後のDB照合", () => {
  const UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("UUID一致ユーザーが public なら現在の slug を返す", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, {
      uuid: UUID,
      slug: "current-public-slug",
      profileVisibility: "public",
    });
    mojangMocks.fetchUuidFromMcid.mockResolvedValue(UUID);

    const result = await resolvePlayerSlugFallback(db, uniqueMcid());
    expect(result).toBe(user.slug);
  });

  it("UUID一致ユーザーが unlisted なら slug を返す", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, {
      uuid: UUID,
      slug: "current-unlisted-slug",
      profileVisibility: "unlisted",
    });
    mojangMocks.fetchUuidFromMcid.mockResolvedValue(UUID);

    const result = await resolvePlayerSlugFallback(db, uniqueMcid());
    expect(result).toBe(user.slug);
  });

  it("UUID一致ユーザーが private なら null を返す（存在を漏らさない）", async () => {
    const db = await createTestDb();
    await seedUser(db, {
      uuid: UUID,
      slug: "current-private-slug",
      profileVisibility: "private",
    });
    mojangMocks.fetchUuidFromMcid.mockResolvedValue(UUID);

    const result = await resolvePlayerSlugFallback(db, uniqueMcid());
    expect(result).toBeNull();
  });

  it("UUID一致ユーザーがいなければ null を返す", async () => {
    const db = await createTestDb();
    mojangMocks.fetchUuidFromMcid.mockResolvedValue(UUID);

    const result = await resolvePlayerSlugFallback(db, uniqueMcid());
    expect(result).toBeNull();
  });
});
