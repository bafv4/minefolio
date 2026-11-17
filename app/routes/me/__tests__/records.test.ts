import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  seedCategoryRecord,
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

import { action } from "../records";
import { isHttpUrl as isHttpVideoUrl } from "@/lib/safe-url";
import { PROFILE_FIELD_LIMITS } from "@/lib/profile-edit-validation";

// pbVideoUrl の Stored XSS 対策（http/https スキーム許可リスト）の回帰テスト。
describe("isHttpVideoUrl", () => {
  it("accepts http/https URLs", () => {
    expect(isHttpVideoUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isHttpVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isHttpVideoUrl("http://example.com/clip")).toBe(true);
  });

  it("rejects javascript: and other dangerous schemes", () => {
    expect(isHttpVideoUrl("javascript:alert(document.domain)")).toBe(false);
    expect(isHttpVideoUrl("JavaScript:alert(1)")).toBe(false);
    expect(isHttpVideoUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpVideoUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isHttpVideoUrl("ftp://example.com/file")).toBe(false);
  });

  it("rejects non-URL and schemeless values", () => {
    expect(isHttpVideoUrl("not a url")).toBe(false);
    expect(isHttpVideoUrl("//example.com")).toBe(false);
    expect(isHttpVideoUrl("")).toBe(false);
  });
});

// /me/records の action の回帰テスト（カテゴリ名の長さ検証・登録上限50件）。
// セッションはモックし、ルート本体を実DBで検証する（app/routes/me/__tests__/devices.test.ts と同じ方針）。
const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/records", {
    method: "POST",
    body: formData,
  });
}

async function callAction(formData: FormData): Promise<{ success?: boolean; error?: string }> {
  return action({ request: makeRequest(formData), params: {}, context: {} } as never) as never;
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
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

type OpInput = {
  id?: string | null;
  delete?: boolean;
  category?: string;
  categoryDisplayName?: string;
  personalBest?: number | null;
  pbVideoUrl?: string | null;
  isVisible?: boolean;
  isPinned?: boolean;
};

/** saveRecords のフォーム。records は変更一覧（既定は空）、旗は既定で空 */
function saveForm(ops: OpInput[] = [], flags: { hidden?: unknown; pinned?: unknown } = {}): FormData {
  const fd = new FormData();
  fd.set("_action", "saveRecords");
  fd.set("hidden", JSON.stringify(flags.hidden ?? []));
  fd.set("pinned", JSON.stringify(flags.pinned ?? []));
  fd.set(
    "records",
    JSON.stringify(
      ops.map((o) => ({
        id: null,
        delete: false,
        category: "any_glitchless",
        categoryDisplayName: "Any% Glitchless",
        personalBest: null,
        pbVideoUrl: null,
        isVisible: true,
        isPinned: false,
        ...o,
      })),
    ),
  );
  return fd;
}

async function recordCount(userId: string): Promise<number> {
  return (
    await db.query.categoryRecords.findMany({ where: eq(schema.categoryRecords.userId, userId) })
  ).length;
}

describe("action - 検証", () => {
  it("101文字のカテゴリ名は categoryTooLong エラーになり、行を作らない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    const res = await callAction(saveForm([{ category: "a".repeat(101) }]));

    expect(res).toEqual({ error: "カテゴリ名は100文字以内で入力してください" });
    expect(await recordCount(user.id)).toBe(0);
  });

  it("不正な動画URL・時間は何も書かずにエラーにする", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    expect((await callAction(saveForm([{ pbVideoUrl: "javascript:alert(1)" }]))).error).toBeTruthy();
    expect((await callAction(saveForm([{ personalBest: -5 }]))).error).toBeTruthy();
    expect(await recordCount(user.id)).toBe(0);
  });

  it("動画URLが上限（2000文字）を超えると何も書かずにエラーにし、上限ちょうどは保存できる", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    const base = "https://example.com/";
    const limit = PROFILE_FIELD_LIMITS.recordVideoUrl;

    const tooLong = await callAction(saveForm([{ pbVideoUrl: base + "a".repeat(limit - base.length + 1) }]));
    expect(tooLong).toEqual({ error: "動画URLは2000文字以内で入力してください" });
    expect(await recordCount(user.id)).toBe(0);

    const ok = await callAction(saveForm([{ pbVideoUrl: base + "a".repeat(limit - base.length) }]));
    expect(ok.success).toBe(true);
    expect(await recordCount(user.id)).toBe(1);
  });

  it("形が不正な変更一覧は invalidAction", async () => {
    await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    const fd = saveForm();
    fd.set("records", "not json");
    expect(await callAction(fd)).toEqual({ error: "無効な操作です" });
  });
});

describe("action - 登録上限（50件）", () => {
  it("既存50件がある状態での追加は errorLimitReached を返し、件数が増えない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    await db.insert(schema.categoryRecords).values(
      Array.from({ length: 50 }, (_, i) => ({
        userId: user.id,
        category: `cat-${i}`,
        categoryDisplayName: `Category ${i}`,
        recordType: "custom" as const,
      })),
    );

    const res = await callAction(saveForm([{}]));

    expect(res).toEqual({ error: "記録は50件まで登録できます" });
    expect(await recordCount(user.id)).toBe(50);
  });

  it("49件の状態では追加が成功し50件になる", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    for (let i = 0; i < 49; i++) {
      await seedCategoryRecord(db, user.id, { category: `cat-${i}`, recordType: "custom" });
    }

    const res = await callAction(saveForm([{}]));

    expect(res).toEqual({ success: true });
    expect(await recordCount(user.id)).toBe(50);
  });

  it("50件から1件削除して2件追加すると51件になるので拒否し、何も書かない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    const rows = [];
    for (let i = 0; i < 50; i++) {
      rows.push(await seedCategoryRecord(db, user.id, { category: `cat-${i}`, recordType: "custom" }));
    }

    const res = await callAction(
      saveForm([{ id: rows[0].id, delete: true }, { category: "n1" }, { category: "n2" }]),
    );

    expect(res.error).toBeTruthy();
    expect(await recordCount(user.id)).toBe(50);
  });
});

describe("action - saveRecords（カスタム記録のまとめて保存）", () => {
  it("作成・更新・削除が混在していても1回で反映され、旗も同時に保存される", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    const toUpdate = await seedCategoryRecord(db, user.id, { category: "rsg_any", recordType: "custom" });
    const toDelete = await seedCategoryRecord(db, user.id, { category: "ssg_any", recordType: "custom" });

    const res = await callAction(
      saveForm(
        [
          { id: toUpdate.id, category: "rsg_any", categoryDisplayName: "RSG 更新後", personalBest: 600000 },
          { id: toDelete.id, delete: true },
          { category: "aa_any", categoryDisplayName: "AA 新規", isPinned: true },
        ],
        { hidden: ["h1"], pinned: ["p1"] },
      ),
    );

    expect(res).toMatchObject({ success: true });
    const rows = await db.query.categoryRecords.findMany({ where: eq(schema.categoryRecords.userId, user.id) });
    expect(rows.map((r) => r.category).sort()).toEqual(["aa_any", "rsg_any"]);
    const updated = rows.find((r) => r.id === toUpdate.id)!;
    expect(updated.categoryDisplayName).toBe("RSG 更新後");
    expect(updated.personalBest).toBe(600000);
    expect(rows.find((r) => r.category === "aa_any")!.isPinned).toBe(true);
    const after = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(JSON.parse(after!.hiddenSpeedrunRecords ?? "[]")).toEqual(["h1"]);
    expect(JSON.parse(after!.pinnedSpeedrunRecords ?? "[]")).toEqual(["p1"]);
  });

  it("同じカテゴリの重複は categoryDuplicate エラーになり、ほかの変更も旗も書かれない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    const existing = await seedCategoryRecord(db, user.id, { category: "rsg_any", recordType: "custom" });

    const res = await callAction(
      saveForm(
        [
          { id: existing.id, category: "rsg_any", categoryDisplayName: "変更されないはず" },
          { category: "aa_any" },
          { category: "rsg_any" },
        ],
        { hidden: ["h1"] },
      ),
    );

    expect(res).toEqual({ error: "同じカテゴリ・サブカテゴリの記録がすでにあります" });
    const rows = await db.query.categoryRecords.findMany({ where: eq(schema.categoryRecords.userId, user.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0].categoryDisplayName).not.toBe("変更されないはず");
    const after = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(after!.hiddenSpeedrunRecords ?? null).toBeNull();
  });

  it("削除と同時に同じカテゴリを作り直せる", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");
    const old = await seedCategoryRecord(db, user.id, { category: "rsg_any", recordType: "custom" });

    const res = await callAction(saveForm([{ id: old.id, delete: true }, { category: "rsg_any" }]));

    expect(res).toMatchObject({ success: true });
    const rows = await db.query.categoryRecords.findMany({ where: eq(schema.categoryRecords.userId, user.id) });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(old.id);
  });

  it("他人の記録 ID を混ぜると invalidAction になり、本人側の変更も他人の記録も書かれない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    signInAs("discord-runner");
    const othersRecord = await seedCategoryRecord(db, other.id, {
      category: "rsg_any",
      categoryDisplayName: "他人の記録",
      recordType: "custom",
    });

    const res = await callAction(
      saveForm([
        { category: "aa_any" },
        { id: othersRecord.id, categoryDisplayName: "書き換え" },
        { id: othersRecord.id, delete: true },
      ]),
    );
    expect(res).toEqual({ error: "無効な操作です" });

    const res2 = await callAction(saveForm([{ category: "aa_any" }, { id: othersRecord.id, delete: true }]));
    expect(res2).toEqual({ error: "無効な操作です" });

    expect(await recordCount(user.id)).toBe(0);
    const stillThere = await db.query.categoryRecords.findFirst({
      where: eq(schema.categoryRecords.id, othersRecord.id),
    });
    expect(stillThere?.categoryDisplayName).toBe("他人の記録");
  });
});

describe("action - Speedrun.com 記録の旗（非表示・ピン留め）", () => {
  it("非表示だけが変わったときは updatedAt（最近の更新）を進めない", async () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner", updatedAt: past });
    signInAs("discord-runner");

    const res = await callAction(saveForm([], { hidden: ["run-1"], pinned: [] }));

    expect(res).toMatchObject({ success: true });
    const after = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(JSON.parse(after!.hiddenSpeedrunRecords ?? "[]")).toEqual(["run-1"]);
    expect(after!.updatedAt?.getTime()).toBe(past.getTime());
  });

  it("ピン留めが変わったときは updatedAt を進め、両方の一覧をまとめて置き換える", async () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner", updatedAt: past });
    signInAs("discord-runner");

    await callAction(saveForm([], { hidden: ["h1"], pinned: ["p1", "p2"] }));
    const res = await callAction(saveForm([], { hidden: [], pinned: ["p2"] }));

    expect(res).toMatchObject({ success: true });
    const after = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(JSON.parse(after!.hiddenSpeedrunRecords ?? "[]")).toEqual([]);
    expect(JSON.parse(after!.pinnedSpeedrunRecords ?? "[]")).toEqual(["p2"]);
    expect(after!.updatedAt!.getTime()).toBeGreaterThan(past.getTime());
  });

  it("不正な入力はエラーにして何も書き換えない", async () => {
    const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
    signInAs("discord-runner");

    const fd = saveForm([{ category: "rsg_any" }]);
    fd.set("hidden", "not json");
    const res = await callAction(fd);

    expect(res.error).toBeTruthy();
    expect(await recordCount(user.id)).toBe(0);
    const after = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    expect(after!.hiddenSpeedrunRecords ?? null).toBeNull();
  });
});
