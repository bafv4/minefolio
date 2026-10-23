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
  seedPlayerConfig,
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

// ---------------------------------------------------------------------------
// パラメータ検証（sections / userSlugs）
//
// 検証順: sections → userSlugs の空判定 → DB ローダー → userSlugs の存在照合。
// 200 系のケースは、グローバルキャッシュ（"keybindings:list:all"）を経由しないよう
// 必ず userSlugs を指定する。
// ---------------------------------------------------------------------------

/** クエリ文字列（先頭の ? なし）をそのまま渡して loader を呼ぶ。値のエンコードは呼び出し側の責任 */
async function callLoader(query: string): Promise<Response> {
  const url = `https://minefolio.app/api/keybindings-csv${query ? `?${query}` : ""}`;
  return (await loader({
    request: new Request(url),
    params: {},
    context: {},
  } as never)) as Response;
}

/** 400 応答が JSON であり、CSV として返されていないことを検証して body を返す */
async function expectBadRequest(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(400);
  expect(res.headers.get("Content-Type")).toContain("application/json");
  expect(res.headers.get("Content-Type")).not.toContain("text/csv");
  expect(res.headers.get("Content-Disposition")).toBeNull();
  return (await res.json()) as Record<string, unknown>;
}

const NOT_FOUND_ERROR = "Some userSlugs were not found or are not exportable";

describe("loader - sections パラメータの検証", () => {
  const ALLOWED = "actions, remaps, custom-actions, mouse";

  it.each([
    ["sections=", "空文字"],
    ["sections=,", "カンマのみ"],
    ["sections=%20,%20", "空白とカンマのみ"],
  ])("%s（%s）は空として 400 を返す", async (query) => {
    const body = await expectBadRequest(await callLoader(query));

    expect(body).toEqual({
      error: `sections must contain at least one of: ${ALLOWED}`,
    });
  });

  it("許可リスト外の値は 400 で、不明な値と許可リストをエラーに含める", async () => {
    const body = await expectBadRequest(await callLoader("sections=foo"));

    expect(body).toEqual({ error: `Unknown sections: foo. Allowed: ${ALLOWED}` });
  });

  it("有効値と不明値の混在（actions,foo）でも 400 を返す", async () => {
    const body = await expectBadRequest(await callLoader("sections=actions,foo"));

    expect(body).toEqual({ error: `Unknown sections: foo. Allowed: ${ALLOWED}` });
  });

  it("不明値が複数ある場合は全て列挙する", async () => {
    const body = await expectBadRequest(await callLoader("sections=foo,actions,bar"));

    expect(body).toEqual({ error: `Unknown sections: foo, bar. Allowed: ${ALLOWED}` });
  });

  it("許可リストの照合は大文字小文字を区別する（Actions は 400）", async () => {
    const body = await expectBadRequest(await callLoader("sections=Actions"));

    expect(body.error).toBe(`Unknown sections: Actions. Allowed: ${ALLOWED}`);
  });

  it("sections の検証は userSlugs の検証より先に行われる", async () => {
    const body = await expectBadRequest(await callLoader("sections=foo&userSlugs="));

    expect(body.error).toEqual(expect.stringContaining("Unknown sections: foo"));
  });

  it("sections 未指定は actions として 200 を返す", async () => {
    await seedPlayer("runner", "Runner");

    const res = await callLoader("userSlugs=runner");
    const csv = await res.text();

    expect(res.status).toBe(200);
    const lines = csv.replace("﻿", "").split("\n");
    // actions セクションのみ: ヘッダー行 + プレイヤー行
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("Player,")).toBe(true);
    expect(lines[1].startsWith("Runner,")).toBe(true);
  });

  it("重複（actions,actions）は 200 で、セクションは1回だけ出力される", async () => {
    await seedPlayer("runner", "Runner");

    const res = await callLoader("sections=actions,actions&userSlugs=runner");
    const csv = await res.text();

    expect(res.status).toBe(200);
    expect(csv.replace("﻿", "").split("\n")).toHaveLength(2);
  });

  it("前後に空白（actions, mouse）があっても 200 で両セクションを出力する", async () => {
    await seedPlayer("runner", "Runner");

    const res = await callLoader("sections=actions,%20mouse&userSlugs=runner");
    const csv = await res.text();

    expect(res.status).toBe(200);
    expect(csv).toContain("Player,DPI,Sensitivity (%)");
  });

  it("空要素が混ざっていても有効値が残れば 200（actions,,mouse）", async () => {
    await seedPlayer("runner", "Runner");

    const res = await callLoader("sections=actions,,mouse&userSlugs=runner");

    expect(res.status).toBe(200);
  });
});

describe("loader - userSlugs パラメータの検証", () => {
  it.each([
    ["userSlugs=", "空文字（以前は未指定扱い）"],
    ["userSlugs=,", "カンマのみ"],
    ["userSlugs=%20,%20", "空白とカンマのみ"],
  ])("%s（%s）は 400 を返す", async (query) => {
    const body = await expectBadRequest(await callLoader(query));

    expect(body).toEqual({ error: "userSlugs must contain at least one slug" });
  });

  it("userSlugs= は、公開ユーザーが存在しても全件出力にフォールバックしない", async () => {
    await seedPlayer("runner", "Runner");

    const res = await callLoader("sections=actions&userSlugs=");

    expect(res.status).toBe(400);
  });

  it("存在しない slug は 400 で notFound に入る", async () => {
    const body = await expectBadRequest(await callLoader("userSlugs=ghost"));

    expect(body).toEqual({ error: NOT_FOUND_ERROR, notFound: ["ghost"] });
  });

  it("非公開・限定公開ユーザー・視聴者・設定が空のユーザーは存在しない slug と同じ応答になる", async () => {
    const privateUser = await seedUser(db, { slug: "priv", profileVisibility: "private" });
    await seedKeybinding(db, privateUser.id, { action: "forward", keyCode: "KeyW" });
    const unlistedUser = await seedUser(db, { slug: "unlisted", profileVisibility: "unlisted" });
    await seedKeybinding(db, unlistedUser.id, { action: "forward", keyCode: "KeyW" });
    const viewer = await seedUser(db, {
      slug: "viewer1",
      profileVisibility: "public",
      role: "viewer",
    });
    await seedKeybinding(db, viewer.id, { action: "forward", keyCode: "KeyW" });
    // 公開・ランナーだがキー配置・リマップ・カスタムアクションがすべて空
    await seedUser(db, { slug: "empty", profileVisibility: "public" });

    const responses = await Promise.all(
      ["ghost", "priv", "unlisted", "viewer1", "empty"].map(async (slug) => {
        const body = await expectBadRequest(await callLoader(`userSlugs=${slug}`));
        return { slug, body };
      }),
    );

    for (const { slug, body } of responses) {
      // slug 以外は完全に同一の応答（存在・非公開の区別がつかない）
      expect(body).toEqual({ error: NOT_FOUND_ERROR, notFound: [slug] });
    }
  });

  it("有効な slug と混在しても 400 で、notFound には見つからなかった slug だけが入る", async () => {
    await seedPlayer("runner", "Runner");
    const privateUser = await seedUser(db, { slug: "priv", profileVisibility: "private" });
    await seedKeybinding(db, privateUser.id, { action: "forward", keyCode: "KeyW" });

    const body = await expectBadRequest(await callLoader("userSlugs=runner,ghost,priv"));

    expect(body).toEqual({ error: NOT_FOUND_ERROR, notFound: ["ghost", "priv"] });
  });

  it("notFound は重複を除く", async () => {
    await seedPlayer("runner", "Runner");

    const body = await expectBadRequest(await callLoader("userSlugs=ghost,runner,ghost,%20ghost"));

    expect(body).toEqual({ error: NOT_FOUND_ERROR, notFound: ["ghost"] });
  });

  it("slug の照合は大文字小文字を区別する（大小違いは notFound）", async () => {
    await seedPlayer("runner", "Runner");

    const body = await expectBadRequest(await callLoader("userSlugs=Runner"));

    expect(body).toEqual({ error: NOT_FOUND_ERROR, notFound: ["Runner"] });
  });

  it("不正な sections は userSlugs の存在照合より先に 400 になる", async () => {
    const body = await expectBadRequest(await callLoader("sections=foo&userSlugs=ghost"));

    expect(body.error).toEqual(expect.stringContaining("Unknown sections"));
    expect(body).not.toHaveProperty("notFound");
  });
});

describe("loader - 正常系の回帰", () => {
  it("有効な sections と userSlugs で 200・CSV ヘッダー・UTF-8 BOM を返す", async () => {
    await seedPlayer("runner", "Runner");

    const res = await callLoader("sections=actions&userSlugs=runner");
    // Response.text() は UTF-8 の BOM を除去するため、生バイトで BOM（EF BB BF）を確認する
    const bytes = new Uint8Array(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="keybindings.csv"');
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toContain("Runner,");
  });

  it("slug 前後の空白はトリムされて照合される（userSlugs=%20runner%20）", async () => {
    await seedPlayer("runner", "Runner");

    const res = await callLoader("userSlugs=%20runner%20");

    expect(res.status).toBe(200);
  });

  it("複数 slug の指定で全員を出力する", async () => {
    await seedPlayer("runner-a", "Alpha");
    await seedPlayer("runner-b", "Bravo");

    const res = await callLoader("sections=actions&userSlugs=runner-a,runner-b");
    const csv = await res.text();

    expect(res.status).toBe(200);
    expect(csv).toContain("\nAlpha,");
    expect(csv).toContain("\nBravo,");
  });

  it("sections=mouse は mouse の見出しだけを含み、他セクションの見出しを含まない", async () => {
    const user = await seedPlayer("runner", "Runner");
    await seedPlayerConfig(db, user.id, { mouseDpi: 800 });

    const res = await callLoader("sections=mouse&userSlugs=runner");
    const csv = await res.text();

    expect(res.status).toBe(200);
    expect(csv).toContain("Player,DPI,Sensitivity (%),cm/360");
    expect(csv).not.toContain("Source Key");
    expect(csv).not.toContain("Trigger Key");
    expect(csv.replace("﻿", "").split("\n")[0].startsWith("Player,DPI,")).toBe(true);
  });

  it("sections=remaps,custom-actions はその見出しだけを含む", async () => {
    await seedPlayer("runner", "Runner");

    const res = await callLoader("sections=remaps,custom-actions&userSlugs=runner");
    const csv = await res.text();

    expect(res.status).toBe(200);
    expect(csv).toContain("Player,Source Key,Target Key,Type");
    expect(csv).toContain("Player,Trigger Key,Action Name");
    expect(csv).not.toContain("Player,DPI");
    expect(csv.replace("﻿", "").split("\n")[0]).toBe("Player,Source Key,Target Key,Type");
  });
});
