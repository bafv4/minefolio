// /developers/export の loader（対象ユーザー一覧の絞り込み）の回帰テスト。UI（default export）は対象外。
//
// 実際のCSV出力は /api/keybindings-csv（loadKeybindingsListPlayers 経由）が担うため、
// ここでは「エクスポート対象として選べるユーザー一覧」の可視性フィルタ・空ユーザー除外・
// 返却カラムのみを検証する。
//
// 認証不要のルートのためセッションのモックは不要。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDbAt,
  seedUser,
  seedKeybinding,
  schema,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

import { loader } from "../export";

const ENV_KEYS = ["TURSO_DATABASE_URL", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

async function callLoader(): Promise<{
  appUrl: string;
  availableUsers: Array<Record<string, unknown>>;
}> {
  const request = new Request("https://minefolio.app/developers/export");
  return loader({ request, params: {}, context: {} } as never) as never;
}

beforeEach(async () => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("loader - 可視性フィルタ", () => {
  it("profileVisibility が private / unlisted のユーザーは一覧に含まれない", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    const unl = await seedUser(db, { slug: "unl", profileVisibility: "unlisted" });
    const prv = await seedUser(db, { slug: "prv", profileVisibility: "private" });
    for (const u of [pub, unl, prv]) {
      await seedKeybinding(db, u.id, { action: "forward", keyCode: "KeyW" });
    }

    const res = await callLoader();

    expect(res.availableUsers.map((u) => u.slug)).toEqual(["pub"]);
  });
});

describe("loader - 空ユーザー除外", () => {
  it("keybindings/keyRemaps/customActions すべて0件のユーザーは除外される", async () => {
    await seedUser(db, { slug: "empty", profileVisibility: "public" });

    const res = await callLoader();

    expect(res.availableUsers).toEqual([]);
  });

  it("keybindings が1件でもあれば含まれる", async () => {
    const user = await seedUser(db, { slug: "has-kb", profileVisibility: "public" });
    await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW" });

    const res = await callLoader();

    expect(res.availableUsers.map((u) => u.slug)).toEqual(["has-kb"]);
  });

  it("keyRemaps のみでも含まれる", async () => {
    const user = await seedUser(db, { slug: "has-remap", profileVisibility: "public" });
    await db.insert(schema.keyRemaps).values({
      userId: user.id,
      sourceKey: "KeyA",
      targetKey: "KeyB",
    });

    const res = await callLoader();

    expect(res.availableUsers.map((u) => u.slug)).toEqual(["has-remap"]);
  });

  it("customActions のみでも含まれる", async () => {
    const user = await seedUser(db, { slug: "has-custom", profileVisibility: "public" });
    await db.insert(schema.customActions).values({
      userId: user.id,
      actionName: "DPI切替",
      triggerKey: "Ctrl+KeyX",
    });

    const res = await callLoader();

    expect(res.availableUsers.map((u) => u.slug)).toEqual(["has-custom"]);
  });
});

describe("loader - 返却カラム", () => {
  it("表示用カラムのみを返し、機微情報を含まない", async () => {
    const user = await seedUser(db, {
      slug: "pub",
      discordId: "discord-secret",
      profileVisibility: "public",
      mcid: "Runner",
      displayName: "Runner Name",
      displayNameAlphabet: "Runner Alphabet",
    });
    await seedKeybinding(db, user.id, { action: "forward", keyCode: "KeyW" });

    const res = await callLoader();

    expect(res.availableUsers).toHaveLength(1);
    const returned = res.availableUsers[0];
    expect(returned).not.toHaveProperty("discordId");
    expect(returned).not.toHaveProperty("id");
    expect(Object.keys(returned).sort()).toEqual(
      ["slug", "mcid", "displayName", "displayNameAlphabet"].sort(),
    );
  });
});
