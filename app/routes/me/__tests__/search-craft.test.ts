// /me/search-craft の action（saveAll）の回帰テスト。
// saveAll は「既存の crafts / loops を全削除して再挿入する」方式のため、payload の解釈を
// 誤ると既存データが黙って消える。特に守りたいのは以下の2点:
//  1. loops フィールドが未送信（Loop 機能追加前の古いタブからの保存）なら既存 Loop を保持し、
//     明示的に "[]" が送られたときだけ全削除する
//  2. "new-" 始まりの仮 id を採番し直したうえで、Loop の craftId 参照を最終 id へ引き換える
// あわせて items の型ガード（公開ガイド埋め込みの SSR を守る既存ガード）も検証する。
//
// セッションはモックし、ルート本体（プリセット前提条件・検証・DB書き込み）を実DBで検証する
// （app/routes/me/__tests__/devices.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedConfigPreset,
  schema,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { parseLoopSteps } from "@/lib/search-craft-loops";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../search-craft";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

type ActionResult = { success?: boolean; error?: string };

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/search-craft", {
    method: "POST",
    body: formData,
  });
}

async function callAction(formData: FormData): Promise<ActionResult> {
  return action({ request: makeRequest(formData), params: {}, context: {} } as never) as never;
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

/** 送信フィールドをそのまま並べた FormData を作る（未指定フィールドは「未送信」として扱われる） */
function formDataOf(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

/** saveAll はアクティブプリセットを要求するため、都度用意する */
async function setupUserWithActivePreset() {
  const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
  const preset = await seedConfigPreset(db, user.id, { name: "Main", isActive: true });
  signInAs("discord-runner");
  return { user, preset };
}

/** search_crafts を 1 件挿入して返す（このテスト専用） */
async function seedCraft(
  userId: string,
  values: { id: string; sequence: number; items: string[]; searchStr: string },
) {
  const [row] = await db
    .insert(schema.searchCrafts)
    .values({
      id: values.id,
      userId,
      sequence: values.sequence,
      items: JSON.stringify(values.items),
      keys: JSON.stringify([]),
      searchStr: values.searchStr,
      searchVariations: JSON.stringify([{ str: values.searchStr, withShift: false }]),
    })
    .returning();
  return row;
}

/** search_craft_loops を 1 件挿入して返す（このテスト専用） */
async function seedLoop(
  userId: string,
  values: { id: string; sequence: number; steps: unknown[] },
) {
  const [row] = await db
    .insert(schema.searchCraftLoops)
    .values({
      id: values.id,
      userId,
      sequence: values.sequence,
      steps: JSON.stringify(values.steps),
    })
    .returning();
  return row;
}

async function findCrafts(userId: string) {
  return db.query.searchCrafts.findMany({
    where: eq(schema.searchCrafts.userId, userId),
    orderBy: [asc(schema.searchCrafts.sequence)],
  });
}

async function findLoops(userId: string) {
  return db.query.searchCraftLoops.findMany({
    where: eq(schema.searchCraftLoops.userId, userId),
    orderBy: [asc(schema.searchCraftLoops.sequence)],
  });
}

/** crafts 2件 + それを繋ぐ Loop 1件を用意する（データ損失ガードの基準状態） */
async function setupCraftsWithLoop() {
  const { user, preset } = await setupUserWithActivePreset();
  await seedCraft(user.id, {
    id: "craft-a",
    sequence: 1,
    items: ["diamond_pickaxe"],
    searchStr: "pi",
  });
  await seedCraft(user.id, {
    id: "craft-b",
    sequence: 2,
    items: ["stone_pickaxe"],
    searchStr: "pic",
  });
  await seedLoop(user.id, {
    id: "loop-a",
    sequence: 1,
    steps: [
      { craftId: "craft-a", transition: null, variationIndex: 0 },
      { craftId: "craft-b", transition: { type: "backspace", bsCount: 0 }, variationIndex: 0 },
    ],
  });
  return { user, preset };
}

/** 既存 crafts をそのまま送り返す payload（クライアントが無変更で保存したときの形） */
const EXISTING_CRAFTS_PAYLOAD = JSON.stringify([
  { id: "craft-a", items: ["diamond_pickaxe"], variations: [{ str: "pi", withShift: false }] },
  { id: "craft-b", items: ["stone_pickaxe"], variations: [{ str: "pic", withShift: false }] },
]);

describe("action - saveAll の Loop データ損失ガード", () => {
  it("loops フィールドが未送信なら既存 Loop を保持する（旧クライアントからの保存で消さない）", async () => {
    const { user, preset } = await setupCraftsWithLoop();

    const res = await callAction(
      formDataOf({
        _action: "saveAll",
        presetId: preset.id,
        crafts: EXISTING_CRAFTS_PAYLOAD,
      }),
    );

    expect(res).toEqual({ success: true });
    const loops = await findLoops(user.id);
    expect(loops).toHaveLength(1);
    expect(parseLoopSteps(loops[0].steps).map((step) => step.craftId)).toEqual([
      "craft-a",
      "craft-b",
    ]);

    // プリセットスナップショットにも Loop が残る
    const updatedPreset = await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.id, preset.id),
    });
    expect(updatedPreset?.searchCraftLoopsData).not.toBeNull();
  });

  it('loops に "[]" を明示送信した場合は Loop を全削除する', async () => {
    const { user, preset } = await setupCraftsWithLoop();

    const res = await callAction(
      formDataOf({
        _action: "saveAll",
        presetId: preset.id,
        crafts: EXISTING_CRAFTS_PAYLOAD,
        loops: "[]",
      }),
    );

    expect(res).toEqual({ success: true });
    expect(await findLoops(user.id)).toHaveLength(0);
    // crafts 側は残る
    expect(await findCrafts(user.id)).toHaveLength(2);

    const updatedPreset = await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.id, preset.id),
    });
    expect(updatedPreset?.searchCraftLoopsData).toBeNull();
  });

  it("crafts から削除されたエントリを参照する Loop はステップ除去で破棄される", async () => {
    const { user, preset } = await setupCraftsWithLoop();

    // craft-b を削除した状態で保存（loops は未送信＝既存 Loop を引き継ぐ）
    const res = await callAction(
      formDataOf({
        _action: "saveAll",
        presetId: preset.id,
        crafts: JSON.stringify([
          {
            id: "craft-a",
            items: ["diamond_pickaxe"],
            variations: [{ str: "pi", withShift: false }],
          },
        ]),
      }),
    );

    expect(res).toEqual({ success: true });
    expect(await findCrafts(user.id)).toHaveLength(1);
    // ステップが1件になった Loop は破棄される（参照切れのまま残さない）
    expect(await findLoops(user.id)).toHaveLength(0);
  });
});

describe("action - saveAll の id 採番", () => {
  it('"new-" 始まりの craft id は採番し直され、Loop の craftId 参照も最終 id へ引き換わる', async () => {
    const { user, preset } = await setupUserWithActivePreset();

    const res = await callAction(
      formDataOf({
        _action: "saveAll",
        presetId: preset.id,
        crafts: JSON.stringify([
          { id: "new-1", items: ["diamond"], variations: [{ str: "di", withShift: false }] },
          { id: "new-2", items: ["dirt"], variations: [{ str: "dir", withShift: false }] },
        ]),
        loops: JSON.stringify([
          {
            id: "new-loop-1",
            steps: [
              { craftId: "new-1", transition: null },
              { craftId: "new-2", transition: { type: "backspace", bsCount: 0 } },
            ],
            comment: null,
            timing: null,
          },
        ]),
      }),
    );

    expect(res).toEqual({ success: true });

    const crafts = await findCrafts(user.id);
    expect(crafts).toHaveLength(2);
    expect(crafts.map((craft) => craft.id)).not.toContain("new-1");
    expect(crafts.map((craft) => craft.id)).not.toContain("new-2");
    expect(crafts.map((craft) => craft.sequence)).toEqual([1, 2]);
    expect(crafts.map((craft) => craft.searchStr)).toEqual(["di", "dir"]);

    const loops = await findLoops(user.id);
    expect(loops).toHaveLength(1);
    expect(loops[0].id).not.toBe("new-loop-1");
    expect(parseLoopSteps(loops[0].steps).map((step) => step.craftId)).toEqual([
      crafts[0].id,
      crafts[1].id,
    ]);
  });

  it("既存 id はそのまま維持される（採番し直さない）", async () => {
    const { user, preset } = await setupCraftsWithLoop();

    const res = await callAction(
      formDataOf({
        _action: "saveAll",
        presetId: preset.id,
        crafts: EXISTING_CRAFTS_PAYLOAD,
        loops: JSON.stringify([
          {
            id: "loop-a",
            steps: [
              { craftId: "craft-a", transition: null },
              { craftId: "craft-b", transition: { type: "backspace", bsCount: 0 } },
            ],
            comment: null,
            timing: null,
          },
        ]),
      }),
    );

    expect(res).toEqual({ success: true });
    expect((await findCrafts(user.id)).map((craft) => craft.id)).toEqual(["craft-a", "craft-b"]);
    expect((await findLoops(user.id)).map((loop) => loop.id)).toEqual(["loop-a"]);
  });
});

describe("action - saveAll の入力検証", () => {
  it("items に非文字列が含まれる payload は拒否し、DB を変更しない", async () => {
    const { user, preset } = await setupCraftsWithLoop();

    const res = await callAction(
      formDataOf({
        _action: "saveAll",
        presetId: preset.id,
        crafts: JSON.stringify([
          { id: "craft-a", items: ["diamond_pickaxe", 123], variations: [{ str: "pi", withShift: false }] },
        ]),
      }),
    );

    expect(res).toEqual({ error: "サーチクラフトのデータ形式が不正です" });
    expect((await findCrafts(user.id)).map((craft) => craft.id)).toEqual(["craft-a", "craft-b"]);
    expect(await findLoops(user.id)).toHaveLength(1);
  });

  it("items が配列でない payload は拒否し、DB を変更しない", async () => {
    const { user, preset } = await setupCraftsWithLoop();

    const res = await callAction(
      formDataOf({
        _action: "saveAll",
        presetId: preset.id,
        crafts: JSON.stringify([{ id: "craft-a", items: "diamond_pickaxe" }]),
      }),
    );

    expect(res).toEqual({ error: "サーチクラフトのデータ形式が不正です" });
    expect(await findCrafts(user.id)).toHaveLength(2);
  });

  it("ステップが2件未満の Loop を含む payload は拒否し、DB を変更しない", async () => {
    const { user, preset } = await setupCraftsWithLoop();

    const res = await callAction(
      formDataOf({
        _action: "saveAll",
        presetId: preset.id,
        crafts: EXISTING_CRAFTS_PAYLOAD,
        loops: JSON.stringify([
          { id: "loop-a", steps: [{ craftId: "craft-a", transition: null }], comment: null, timing: null },
        ]),
      }),
    );

    expect(res).toEqual({ error: "サーチクラフトのデータ形式が不正です" });
    expect(await findCrafts(user.id)).toHaveLength(2);
    expect(await findLoops(user.id)).toHaveLength(1);
  });

  it("loops が不正な JSON なら拒否し、DB を変更しない", async () => {
    const { user, preset } = await setupCraftsWithLoop();

    const res = await callAction(
      formDataOf({
        _action: "saveAll",
        presetId: preset.id,
        crafts: EXISTING_CRAFTS_PAYLOAD,
        loops: "{not json",
      }),
    );

    expect(res).toEqual({ error: "サーチクラフトのデータ形式が不正です" });
    expect(await findLoops(user.id)).toHaveLength(1);
  });
});

describe("action - プリセットゲート", () => {
  it("アクティブなプリセットが無い場合は presetRequired エラーを返す", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    await seedConfigPreset(db, user.id, { name: "Inactive", isActive: false });
    signInAs("discord-runner");
    await seedCraft(user.id, {
      id: "craft-a",
      sequence: 1,
      items: ["diamond_pickaxe"],
      searchStr: "pi",
    });

    const res = await callAction(
      formDataOf({ _action: "saveAll", crafts: JSON.stringify([]) }),
    );

    expect(res).toEqual({
      error: "サーチクラフトを保存するには、先にプリセットを作成してください",
    });
    expect(await findCrafts(user.id)).toHaveLength(1);
  });

  it("送信 presetId がアクティブプリセットと異なる場合は staleSession エラーを返す", async () => {
    const { user } = await setupCraftsWithLoop();
    const other = await seedConfigPreset(db, user.id, { name: "Other", isActive: false });

    const res = await callAction(
      formDataOf({ _action: "saveAll", presetId: other.id, crafts: JSON.stringify([]) }),
    );

    expect(res).toEqual({
      error: "プリセットが切り替わっています。ページを再読み込みしてください",
    });
    expect(await findCrafts(user.id)).toHaveLength(2);
  });
});
