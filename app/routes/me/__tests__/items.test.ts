// /me/items の action（saveAll）の回帰テスト。
// saveAll は「既存のレイアウトを全削除して再挿入する」方式のため、payload の解釈を誤ると
// 既存データが黙って消える。主対象は JSON.parse 直後の shape 検証（isValidSlotShape を含む）で、
// 崩れた形のまま永続化されると公開プロフィール側の ItemHotbar（slots.find / items.map、
// CyclingSlotIcon の items.map）が TypeError を投げて SSR が 500 になる。
// このガードが db.transaction より手前で弾き、DB を一切変更しないことを実DBで確認する。
// あわせて "new-" 始まりの仮 id の採番し直しと displayOrder（配列順）の全置換も見る。
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

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../items";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

const INVALID_LAYOUT_ERROR = "アイテム配置のデータ形式が不正です";
const PRESET_REQUIRED_ERROR = "アイテム配置を保存するには、先にプリセットを作成してください";
const STALE_SESSION_ERROR = "プリセットが切り替わっています。ページを再読み込みしてください";

let db: TestDb;

type ActionResult = { success?: boolean; error?: string };

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/items", {
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

/** 送信フィールドをそのまま並べた FormData を作る */
function formDataOf(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

/** saveAll の FormData（layouts に文字列を渡すとそのまま送る＝壊れた JSON も試せる） */
function saveForm(layouts: unknown, presetId?: string): FormData {
  const entries: Record<string, string> = {
    _action: "saveAll",
    layouts: typeof layouts === "string" ? layouts : JSON.stringify(layouts),
  };
  if (presetId) entries.presetId = presetId;
  return formDataOf(entries);
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

/** item_layouts を 1 件挿入する（このテスト専用。segment は (userId, segment) が UNIQUE） */
async function seedLayout(
  userId: string,
  id: string,
  segment: string,
  displayOrder = 0,
): Promise<void> {
  await db.insert(schema.itemLayouts).values({
    id,
    userId,
    segment,
    slots: JSON.stringify([{ slot: 1, items: ["minecraft:stone"] }]),
    offhand: JSON.stringify([]),
    notes: null,
    displayOrder,
  });
}

async function findLayouts(userId: string) {
  return db.query.itemLayouts.findMany({
    where: eq(schema.itemLayouts.userId, userId),
    orderBy: [asc(schema.itemLayouts.displayOrder)],
  });
}

async function findHistory(userId: string) {
  return db.query.configHistory.findMany({
    where: eq(schema.configHistory.userId, userId),
  });
}

/** 妥当な 1 レイアウト（テスト側は壊したいフィールドだけ上書きする） */
function validLayout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "layout-a",
    segment: "Overworld",
    slots: [
      { slot: 1, items: ["minecraft:stone"] },
      { slot: 2, items: [] },
    ],
    offhand: ["minecraft:shield"],
    notes: null,
    ...overrides,
  };
}

describe("action - saveAll の shape 検証", () => {
  // 壊れた payload はどれも「db.transaction より手前で弾く」ため、既存行が丸ごと残ることを確認する
  it.each([
    ["layouts 自体が配列でない", { layouts: validLayout() }],
    ["slots が配列でない", [validLayout({ slots: "not-an-array" })]],
    ["slot 番号が数値でない", [validLayout({ slots: [{ slot: "1", items: [] }] })]],
    ["slot エントリの items が配列でない", [validLayout({ slots: [{ slot: 1, items: "stone" }] })]],
    ["slot エントリの items に非文字列が混ざる", [validLayout({ slots: [{ slot: 1, items: [123] }] })]],
    ["slot エントリがオブジェクトでない", [validLayout({ slots: ["minecraft:stone"] })]],
    ["offhand が配列でない", [validLayout({ offhand: "minecraft:shield" })]],
    ["offhand に非文字列が混ざる", [validLayout({ offhand: ["minecraft:shield", 7] })]],
    ["notes が数値", [validLayout({ notes: 42 })]],
    ["id が空文字", [validLayout({ id: "" })]],
    ["segment が文字列でない", [validLayout({ segment: 3 })]],
    ["エントリが null", [null]],
  ])("%s の payload は invalidLayoutData で拒否し、DB を変更しない", async (_label, payload) => {
    const { user, preset } = await setupUserWithActivePreset();
    await seedLayout(user.id, "layout-existing", "Nether");

    const res = await callAction(saveForm(payload, preset.id));

    expect(res).toEqual({ error: INVALID_LAYOUT_ERROR });
    const layouts = await findLayouts(user.id);
    expect(layouts.map((l) => l.id)).toEqual(["layout-existing"]);
    // 変更履歴も残さない
    expect(await findHistory(user.id)).toHaveLength(0);
  });

  it("空の slots・空の offhand は妥当な形として受け付ける", async () => {
    const { user, preset } = await setupUserWithActivePreset();

    const res = await callAction(
      saveForm([validLayout({ slots: [], offhand: [] })], preset.id),
    );

    expect(res).toEqual({ success: true });
    const layouts = await findLayouts(user.id);
    expect(layouts).toHaveLength(1);
    expect(JSON.parse(layouts[0].slots)).toEqual([]);
  });
});

describe("action - saveAll の正常系", () => {
  it('"new-" 始まりの id を採番し直し、displayOrder を配列順で全置換する', async () => {
    const { user, preset } = await setupUserWithActivePreset();
    await seedLayout(user.id, "layout-keep", "Nether", 0);
    await seedLayout(user.id, "layout-stale", "Stale", 1);

    const res = await callAction(
      saveForm(
        [
          validLayout({ id: "new-abc123", segment: "Overworld" }),
          validLayout({ id: "layout-keep", segment: "Nether", offhand: [], notes: "メモ" }),
        ],
        preset.id,
      ),
    );

    expect(res).toEqual({ success: true });

    const layouts = await findLayouts(user.id);
    // payload に無い既存行は消える（全置換）
    expect(layouts).toHaveLength(2);
    expect(layouts.map((l) => l.displayOrder)).toEqual([0, 1]);
    expect(layouts.map((l) => l.segment)).toEqual(["Overworld", "Nether"]);
    // 仮 id は採番し直され、既存 id はそのまま維持される
    expect(layouts[0].id).not.toMatch(/^new-/);
    expect(layouts[1].id).toBe("layout-keep");
    // slots / offhand / notes は JSON 文字列として保存される
    expect(JSON.parse(layouts[0].slots)).toEqual([
      { slot: 1, items: ["minecraft:stone"] },
      { slot: 2, items: [] },
    ]);
    expect(JSON.parse(layouts[0].offhand ?? "null")).toEqual(["minecraft:shield"]);
    expect(layouts[1].notes).toBe("メモ");
  });

  it("空配列の保存で既存レイアウトをすべて削除できる", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    await seedLayout(user.id, "layout-a", "Nether");

    const res = await callAction(saveForm([], preset.id));

    expect(res).toEqual({ success: true });
    expect(await findLayouts(user.id)).toHaveLength(0);
  });

  it("アクティブプリセットのスナップショットと変更履歴を更新する", async () => {
    const { user, preset } = await setupUserWithActivePreset();

    const res = await callAction(saveForm([validLayout({ id: "new-1" })], preset.id));

    expect(res).toEqual({ success: true });

    const updated = await db.query.configPresets.findFirst({
      where: eq(schema.configPresets.id, preset.id),
    });
    expect(JSON.parse(updated?.itemLayoutsData ?? "[]")).toEqual([
      expect.objectContaining({ segment: "Overworld", displayOrder: 0 }),
    ]);

    const history = await findHistory(user.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      changeType: "game_setting",
      changeDescription: "アイテム配置を更新",
    });
  });
});

describe("action - プリセットゲート", () => {
  it("アクティブなプリセットが無い場合は presetRequired エラーを返す", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    await seedConfigPreset(db, user.id, { name: "Inactive", isActive: false });
    signInAs("discord-runner");
    await seedLayout(user.id, "layout-existing", "Nether");

    const res = await callAction(saveForm([]));

    expect(res).toEqual({ error: PRESET_REQUIRED_ERROR });
    expect(await findLayouts(user.id)).toHaveLength(1);
  });

  it("送信 presetId がアクティブプリセットと異なる場合は staleSession エラーを返す", async () => {
    const { user } = await setupUserWithActivePreset();
    const other = await seedConfigPreset(db, user.id, { name: "Other", isActive: false });
    await seedLayout(user.id, "layout-existing", "Nether");

    const res = await callAction(saveForm([], other.id));

    expect(res).toEqual({ error: STALE_SESSION_ERROR });
    expect(await findLayouts(user.id)).toHaveLength(1);
  });
});

describe("action - 未知のアクション", () => {
  it("saveAll 以外の _action は unknownAction を返し、DB を変更しない", async () => {
    const { user, preset } = await setupUserWithActivePreset();
    await seedLayout(user.id, "layout-existing", "Nether");

    const res = await callAction(
      formDataOf({ _action: "bogus", presetId: preset.id }),
    );

    expect(res).toEqual({ error: "不明なアクション" });
    expect(await findLayouts(user.id)).toHaveLength(1);
  });
});
