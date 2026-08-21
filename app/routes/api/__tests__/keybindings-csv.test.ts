// /api/keybindings-csv の loader の回帰テスト。
//
// データ取得（可視性フィルタ・空ユーザー除外・プリセット優先）は loadKeybindingsListPlayers 側で
// 既にテスト済み（app/lib/__tests__/keybindings-list.server.test.ts）のため、ここでは
// このルート固有の価値である escapeCsv（CSV数式インジェクション対策・カンマ/引用符/改行の
// クォート）のみを、実DBに悪意ある表示名のユーザーをシードして loader 経由で検証する。
// escapeCsv 自体は export されていないため、直接ユニットテストできない。
//
// 対象を1ユーザーに絞るため userSlugs を指定する（"keybindings:list:all" のグローバル
// メモリキャッシュを経由しない絞り込みクエリになるため、テスト間のキャッシュ汚染も避けられる）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDbAt,
  seedUser,
  seedKeybinding,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

import { loader } from "../keybindings-csv";

const ENV_KEYS = ["TURSO_DATABASE_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

/** 公開ユーザー1件 + 最小のキーバインド1件をシードし、CSV先頭行（Player列）に displayName を出す */
async function seedPlayer(slug: string, displayName: string) {
  const user = await seedUser(db, { slug, profileVisibility: "public", displayName });
  await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW" });
  return user;
}

async function callLoaderCsv(slug: string): Promise<string> {
  const url = `https://minefolio.app/api/keybindings-csv?sections=actions&userSlugs=${encodeURIComponent(slug)}`;
  const res = (await loader({
    request: new Request(url),
    params: {},
    context: {},
  } as never)) as Response;
  return res.text();
}

beforeEach(async () => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("loader - CSV数式インジェクション対策（escapeCsv）", () => {
  it.each([
    ["=cmd()", "'=cmd(),"],
    ["+x", "'+x,"],
    ["@x", "'@x,"],
  ])('表示名 "%s" は先頭に \' を付けて出力される', async (displayName, expectedField) => {
    await seedPlayer("runner", displayName);

    const csv = await callLoaderCsv("runner");

    expect(csv).toContain(expectedField);
    // 生の（'を付けない）値のままでは出力されないこと
    expect(csv).not.toContain(`\n${displayName},`);
  });

  it("カンマ・引用符を含む値は正しくクォートされる", async () => {
    await seedPlayer("runner", 'Say "Hi", friend');

    const csv = await callLoaderCsv("runner");

    expect(csv).toContain('"Say ""Hi"", friend"');
  });

  it("改行を含む値は引用符で囲まれる", async () => {
    await seedPlayer("runner", "Line1\nLine2");

    const csv = await callLoaderCsv("runner");

    expect(csv).toContain('"Line1\nLine2"');
  });
});
