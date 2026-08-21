// /player/:slug の loader の回帰テスト（action は無い。UI は対象外）。
//
// 守りたい不変条件は2つ:
//  1. 非公開（profileVisibility="private"）プロフィールは本人以外に 404 を返す
//     （限定公開 unlisted は直リンクで閲覧可 = 一覧から外れるだけ、という境界も併せて固定する）
//  2. 非アクティブなプリセットを閲覧しているとき、表示データはそのスナップショットのみに由来し、
//     スナップショットが null の種別でライブ（編集中）テーブルへフォールバックしない
//     （フォールバックすると「今まさに編集中の設定」が公開面に漏れる）
//
// 外部API（Mojang / PaceMan 等）は loader から呼ばれない構成でシードする:
// PaceMan 統計は `player.mcid` があるときだけ発火するため、mcid を持たないユーザーを使う。
//
// セッションはモックし、ルート本体は実DBで検証する
// （app/routes/guides/__tests__/view.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedConfigPreset,
  seedKeybinding,
  seedPlayerConfig,
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

import { loader } from "../profile";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

/** ライブ（編集中）テーブル由来であることを一目で判別するためのマーカー */
const LIVE_MARKER = "LIVE_ONLY";

let db: TestDb;

type LoaderData = {
  isOwner: boolean;
  selectedPresetId: string | null;
  presets: { id: string; name: string; isActive: boolean; isMain: boolean }[];
  player: {
    slug: string;
    keybindings: { action: string; keyCode: string }[];
    keyRemaps: { sourceKey: string }[];
    itemLayouts: { segment: string }[];
    searchCrafts: { sequence: number }[];
    searchCraftLoops: unknown[];
    customKeys: { keyCode: string }[];
    customActions: { actionName: string }[];
    playerConfig: { mouseModel: string | null } | null;
  };
};

async function callLoader(slug: string, search = ""): Promise<LoaderData> {
  const request = new Request(`https://minefolio.app/player/${slug}${search}`);
  return loader({ request, params: { slug }, context: {} } as never) as never;
}

/** loader が 404 の Response を throw することを検証する */
async function expectNotFound(slug: string, search = "") {
  const thrown = await callLoader(slug, search).then(
    () => null,
    (e: unknown) => e,
  );
  expect(thrown).toBeInstanceOf(Response);
  expect((thrown as Response).status).toBe(404);
}

function signInAs(discordId: string) {
  sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: discordId } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  // 既定は未ログイン
  sessionMocks.getOptionalSession.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

/** 外部API を発火させないプレイヤー（mcid なし）を作る */
async function seedPlayer(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  return seedUser(db, {
    slug: "runner",
    discordId: "discord-runner",
    displayName: "Runner",
    mcid: null,
    ...overrides,
  });
}

describe("loader - プロフィール可視性のゲート", () => {
  it("非公開プロフィールは未ログインの閲覧者に 404 を返す", async () => {
    await seedPlayer({ profileVisibility: "private" });

    await expectNotFound("runner");
  });

  it("非公開プロフィールは他のログインユーザーにも 404 を返す", async () => {
    await seedPlayer({ profileVisibility: "private" });
    await seedUser(db, { slug: "viewer", discordId: "discord-viewer" });
    signInAs("discord-viewer");

    await expectNotFound("runner");
  });

  it("非公開プロフィールでも本人は閲覧できる", async () => {
    await seedPlayer({ profileVisibility: "private" });
    signInAs("discord-runner");

    const data = await callLoader("runner");

    expect(data.player.slug).toBe("runner");
    expect(data.isOwner).toBe(true);
  });

  it("限定公開（unlisted）は未ログインでも直リンクで閲覧できる", async () => {
    await seedPlayer({ profileVisibility: "unlisted" });

    const data = await callLoader("runner");

    expect(data.player.slug).toBe("runner");
    expect(data.isOwner).toBe(false);
  });

  it("公開プロフィールは未ログインで閲覧でき、isOwner は false", async () => {
    await seedPlayer({ profileVisibility: "public" });

    const data = await callLoader("runner");

    expect(data.player.slug).toBe("runner");
    expect(data.isOwner).toBe(false);
  });
});

describe("loader - slug の解決", () => {
  it("存在しない slug は 404 を返す", async () => {
    await seedPlayer();

    await expectNotFound("ghost");
  });

  it("slug は大文字小文字を区別せずに解決する", async () => {
    await seedPlayer({ slug: "runner" });

    const data = await callLoader("RuNNeR");

    expect(data.player.slug).toBe("runner");
  });
});

describe("loader - ?preset= のフォールバック連鎖", () => {
  /** メイン（非アクティブ）と編集中（アクティブ）の2件を持つプレイヤー */
  async function seedPlayerWithPresets() {
    const player = await seedPlayer();
    const main = await seedConfigPreset(db, player.id, {
      name: "Main",
      isMain: true,
      isActive: false,
    });
    const active = await seedConfigPreset(db, player.id, {
      name: "Editing",
      isMain: false,
      isActive: true,
    });
    return { player, main, active };
  }

  it("有効な ?preset= はそのプリセットが選択される", async () => {
    const { active } = await seedPlayerWithPresets();

    const data = await callLoader("runner", `?preset=${active.id}`);

    expect(data.selectedPresetId).toBe(active.id);
  });

  it("?preset= 未指定ならメイン（公開用）プリセットが選択される", async () => {
    const { main } = await seedPlayerWithPresets();

    const data = await callLoader("runner");

    expect(data.selectedPresetId).toBe(main.id);
  });

  it("存在しない ?preset= はメインへフォールバックする", async () => {
    const { main } = await seedPlayerWithPresets();

    const data = await callLoader("runner", "?preset=does-not-exist");

    expect(data.selectedPresetId).toBe(main.id);
  });

  it("削除済みの ?preset= はメインへフォールバックする", async () => {
    const { player, main } = await seedPlayerWithPresets();
    const removed = await seedConfigPreset(db, player.id, { name: "Removed" });
    await db.delete(schema.configPresets).where(eq(schema.configPresets.id, removed.id));

    const data = await callLoader("runner", `?preset=${removed.id}`);

    expect(data.selectedPresetId).toBe(main.id);
  });

  it("他人のプリセット ID を指定してもメインへフォールバックする（他人の設定は覗けない）", async () => {
    const { main } = await seedPlayerWithPresets();
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    const otherPreset = await seedConfigPreset(db, other.id, { name: "Other Main" });

    const data = await callLoader("runner", `?preset=${otherPreset.id}`);

    expect(data.selectedPresetId).toBe(main.id);
    expect(data.presets.map((p) => p.id)).not.toContain(otherPreset.id);
  });

  it("メインが無ければ編集中（アクティブ）プリセットへフォールバックする", async () => {
    const player = await seedPlayer();
    const active = await seedConfigPreset(db, player.id, {
      name: "Editing",
      isMain: false,
      isActive: true,
    });
    await seedConfigPreset(db, player.id, { name: "Spare", isMain: false, isActive: false });

    const data = await callLoader("runner", "?preset=does-not-exist");

    expect(data.selectedPresetId).toBe(active.id);
  });

  it("プリセットが1件も無ければ selectedPresetId は null", async () => {
    await seedPlayer();

    const data = await callLoader("runner");

    expect(data.selectedPresetId).toBeNull();
    expect(data.presets).toEqual([]);
  });
});

describe("loader - 非アクティブプリセット閲覧時の表示データ", () => {
  /**
   * ライブ（編集中）テーブルに LIVE_MARKER 入りのデータを一式持つプレイヤーを作る。
   * これらがスナップショット閲覧時に出てきたら、編集中データの漏出。
   */
  async function seedPlayerWithLiveConfig() {
    const player = await seedPlayer();
    await seedKeybinding(db, player.id, {
      action: "attack",
      keyCode: `${LIVE_MARKER}_ATTACK`,
      category: "combat",
    });
    await seedPlayerConfig(db, player.id, { mouseModel: `${LIVE_MARKER}_MOUSE`, mouseDpi: 1234 });
    await db.insert(schema.keyRemaps).values({
      userId: player.id,
      sourceKey: `${LIVE_MARKER}_SOURCE`,
      targetKey: "KeyB",
    });
    await db.insert(schema.itemLayouts).values({
      userId: player.id,
      segment: `${LIVE_MARKER}_SEGMENT`,
      slots: "[]",
    });
    await db.insert(schema.searchCrafts).values({
      userId: player.id,
      sequence: 1,
      items: JSON.stringify([`${LIVE_MARKER}_ITEM`]),
      keys: "[]",
    });
    await db.insert(schema.customKeys).values({
      userId: player.id,
      keyCode: `${LIVE_MARKER}_CUSTOM_KEY`,
      keyName: "Live",
      category: "keyboard",
    });
    await db.insert(schema.customActions).values({
      userId: player.id,
      actionName: `${LIVE_MARKER}_ACTION`,
      category: "macro",
      triggerKey: "KeyZ",
    });
    return player;
  }

  /** キーバインドだけを持つ非アクティブなスナップショット（他の種別は null = 「空」） */
  const KEYBINDINGS_ONLY_SNAPSHOT = JSON.stringify([
    { action: "sprint", keyCode: "SNAPSHOT_SPRINT", category: "movement" },
  ]);

  it("スナップショットを持つ種別はスナップショット由来のデータへ差し替わる", async () => {
    const player = await seedPlayerWithLiveConfig();
    const preset = await seedConfigPreset(db, player.id, {
      name: "Snapshot",
      isMain: true,
      isActive: false,
      keybindingsData: KEYBINDINGS_ONLY_SNAPSHOT,
    });

    const data = await callLoader("runner", `?preset=${preset.id}`);

    expect(data.selectedPresetId).toBe(preset.id);
    expect(data.player.keybindings.map((kb) => kb.keyCode)).toEqual(["SNAPSHOT_SPRINT"]);
  });

  it("スナップショットが null の種別はライブへフォールバックせず空になる", async () => {
    const player = await seedPlayerWithLiveConfig();
    const preset = await seedConfigPreset(db, player.id, {
      name: "Snapshot",
      isMain: true,
      isActive: false,
      keybindingsData: KEYBINDINGS_ONLY_SNAPSHOT,
      // 他の *Data は null（= その種別は「空」。ライブ設定を代わりに出してはいけない）
    });

    const data = await callLoader("runner", `?preset=${preset.id}`);

    expect(data.player.keyRemaps).toEqual([]);
    expect(data.player.itemLayouts).toEqual([]);
    expect(data.player.searchCrafts).toEqual([]);
    expect(data.player.searchCraftLoops).toEqual([]);
    expect(data.player.customKeys).toEqual([]);
    expect(data.player.customActions).toEqual([]);
    // playerConfig は「設定なし」= null（ライブの player_configs 行を出さない）
    expect(data.player.playerConfig).toBeNull();
  });

  it("ペイロード全体にライブ（編集中）データの痕跡が残らない", async () => {
    const player = await seedPlayerWithLiveConfig();
    const preset = await seedConfigPreset(db, player.id, {
      name: "Snapshot",
      isMain: true,
      isActive: false,
      keybindingsData: KEYBINDINGS_ONLY_SNAPSHOT,
    });

    const data = await callLoader("runner", `?preset=${preset.id}`);

    expect(JSON.stringify(data)).not.toContain(LIVE_MARKER);
  });

  it("アクティブなプリセットの閲覧ではライブ設定が表示される（スナップショットは使わない）", async () => {
    const player = await seedPlayerWithLiveConfig();
    // 編集中プリセットにも（同期済みの）スナップショットは載っているが、
    // 「アクティブプリセット = ライブテーブル」が不変条件なのでライブ側を表示する
    const preset = await seedConfigPreset(db, player.id, {
      name: "Editing",
      isMain: true,
      isActive: true,
      keybindingsData: KEYBINDINGS_ONLY_SNAPSHOT,
    });

    const data = await callLoader("runner", `?preset=${preset.id}`);

    expect(data.player.keybindings.map((kb) => kb.keyCode)).toEqual([`${LIVE_MARKER}_ATTACK`]);
    expect(data.player.itemLayouts.map((l) => l.segment)).toEqual([`${LIVE_MARKER}_SEGMENT`]);
    expect(data.player.playerConfig?.mouseModel).toBe(`${LIVE_MARKER}_MOUSE`);
  });

  // このテストは「ライブ側のシードが全種別ちゃんと入っている」ことの確認も兼ねる
  // （上の「空になる」系アサーションが空振りで通っていないことの担保）。
  it("プリセットが1件も無ければ全種別でライブ設定を表示する", async () => {
    await seedPlayerWithLiveConfig();

    const data = await callLoader("runner");

    expect(data.selectedPresetId).toBeNull();
    expect(data.player.keybindings.map((kb) => kb.keyCode)).toEqual([`${LIVE_MARKER}_ATTACK`]);
    expect(data.player.keyRemaps.map((r) => r.sourceKey)).toEqual([`${LIVE_MARKER}_SOURCE`]);
    expect(data.player.itemLayouts.map((l) => l.segment)).toEqual([`${LIVE_MARKER}_SEGMENT`]);
    expect(data.player.searchCrafts.map((c) => c.sequence)).toEqual([1]);
    expect(data.player.customKeys.map((k) => k.keyCode)).toEqual([`${LIVE_MARKER}_CUSTOM_KEY`]);
    expect(data.player.customActions.map((a) => a.actionName)).toEqual([`${LIVE_MARKER}_ACTION`]);
    expect(data.player.playerConfig?.mouseModel).toBe(`${LIVE_MARKER}_MOUSE`);
    expect(JSON.stringify(data)).toContain(LIVE_MARKER);
  });
});
