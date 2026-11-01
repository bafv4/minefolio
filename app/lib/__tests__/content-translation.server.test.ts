// 利用者コンテンツの自動翻訳（app/lib/content-translation.server.ts）の回帰テスト。仕様は docs/translation.md。
//
// - 純関数（原文ロケール判定・翻訳先）はそのまま検証する
// - DB を使う箇所は createTestDb() の実 DB で検証する（モック DB にしない）
// - 翻訳エンジンは `translate` オプションで偽の関数を差し替える。**Anthropic API は呼ばない**
// - 読み取り関数は isTranslationEnabled() を見るため、読み取り系の describe だけ ANTHROPIC_API_KEY にダミー値を
//   入れる（API は叩かない。translate は常に差し替えるか、翻訳に到達しない対象だけを渡す）。
//   既定（beforeEach）では未設定＝機能無効にして、無効時の挙動をそのまま検証できるようにしている
// - waitUntil（@vercel/functions）は vi.mock をトップレベルに置いてモックする
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedGuide, seedUser, schema, type TestDb } from "./helpers/test-db";

const mocks = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: mocks.waitUntil }));

import {
  DEFAULT_CRON_LIMIT,
  FAILED_RETRY_MS,
  PENDING_RETRY_MS,
  detectSourceLocale,
  getGuideTranslation,
  getGuideTranslations,
  getUserBioTranslation,
  getUserBioTranslations,
  guideSourceLocale,
  guideSourceTexts,
  processPendingTranslations,
  removeGuideTranslations,
  removeUserBioTranslations,
  scheduleGuideTranslation,
  scheduleTranslation,
  scheduleUserBioTranslation,
  translateGuide,
  translateUserBio,
  translationTargetLocales,
  userBioSourceLocale,
  userBioSourceTexts,
} from "../content-translation.server";
import { SUPPORTED_LOCALES } from "../locale";
import { GLOSSARY_VERSION } from "../translation-glossary";
import { TRANSLATION_ENGINE, sourceHash, type translateTexts } from "../translate.server";

type TranslateFn = typeof translateTexts;
type Database = Parameters<typeof translateGuide>[0];

const { contentTranslations, guides, users } = schema;

// ============================================
// 共通ヘルパー
// ============================================

/** 偽の翻訳関数。各要素の先頭に `[<to>]` を付ける（空白のみの要素は本物と同じく素通し） */
function fakeTranslate() {
  return vi.fn<TranslateFn>(async (texts, options) => ({
    texts: texts.map((t) => (t.trim() === "" ? t : `[${options.to}]${t}`)),
    model: "fake-model",
    engine: TRANSLATION_ENGINE,
    glossaryVersion: GLOSSARY_VERSION,
  }));
}

/** 偽の翻訳関数。API 応答待ちに見立てて、結果を返す直前に `during` を実行する（翻訳中の操作を再現する） */
function fakeTranslateDuring(during: () => Promise<void>) {
  return vi.fn<TranslateFn>(async (texts, options) => {
    await during();
    return {
      texts: texts.map((t) => (t.trim() === "" ? t : `[${options.to}]${t}`)),
      model: "fake-model",
      engine: TRANSLATION_ENGINE,
      glossaryVersion: GLOSSARY_VERSION,
    };
  });
}

/** 失敗（null）を返す偽の翻訳関数 */
function failingTranslate() {
  return vi.fn<TranslateFn>(async () => null);
}

let originalKey: string | undefined;

function enableFeature() {
  process.env.ANTHROPIC_API_KEY = "sk-test-dummy";
}

beforeEach(() => {
  originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  mocks.waitUntil.mockReset();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});

const asDb = () => db as unknown as Database;

async function allRows() {
  return db.select().from(contentTranslations);
}

async function rowFor(targetType: "userBio" | "guide", targetId: string, locale: "ja" | "en" = "en") {
  const [row] = await db
    .select()
    .from(contentTranslations)
    .where(
      and(
        eq(contentTranslations.targetType, targetType),
        eq(contentTranslations.targetId, targetId),
        eq(contentTranslations.locale, locale),
      ),
    );
  return row;
}

/** 翻訳行を直接書き込む（読み取り・Cron の条件分岐を作るため） */
async function insertRow(values: Partial<typeof contentTranslations.$inferInsert> & {
  targetType: "userBio" | "guide";
  targetId: string;
}) {
  await db.insert(contentTranslations).values({
    locale: "en",
    sourceHash: "dummy",
    glossaryVersion: GLOSSARY_VERSION,
    status: "ready",
    ...values,
  });
}

async function setRow(
  targetType: "userBio" | "guide",
  targetId: string,
  set: Partial<typeof contentTranslations.$inferInsert>,
) {
  await db
    .update(contentTranslations)
    .set(set)
    .where(and(eq(contentTranslations.targetType, targetType), eq(contentTranslations.targetId, targetId)));
}

/** 日本語 bio を持つユーザー */
function seedBioUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  return seedUser(db, { bio: "自己紹介です", shortBio: "ランナー", ...overrides });
}

/** 日本語の公開ガイド */
function seedJaGuide(authorId: string, overrides: Partial<typeof guides.$inferInsert> = {}) {
  return seedGuide(db, authorId, {
    title: "日本語のガイド",
    summary: "概要です",
    content: "<p>本文です</p>",
    isPublished: true,
    ...overrides,
  });
}

// ============================================
// 原文ロケールの判定（純関数）
// ============================================

describe("detectSourceLocale", () => {
  it.each([
    ["ひらがな", "あ"],
    ["カタカナ", "カ"],
    ["長音を含むカタカナ", "ランナー"],
    ["漢字", "漢"],
    ["半角カナ", "ｱｲｳ"],
    ["英文に日本語が 1 文字混ざる", "Hello, 世 world"],
  ])("%s を含むと ja", (_name, text) => {
    expect(detectSourceLocale(text)).toBe("ja");
  });

  it.each([
    ["英数字", "Hello world 123"],
    ["記号のみ", "!@#$%^&*()_+-=[]{};:'\",.<>/?"],
    ["空文字", ""],
    ["空白のみ", "  \n\t "],
    ["絵文字のみ", "🎮🔥"],
  ])("%s は en", (_name, text) => {
    expect(detectSourceLocale(text)).toBe("en");
  });
});

describe("translationTargetLocales", () => {
  it("原文ロケール以外の対応ロケールをすべて返す（同じロケールへは翻訳しない）", () => {
    expect(translationTargetLocales("ja")).toEqual(["en"]);
    expect(translationTargetLocales("en")).toEqual(["ja"]);
    for (const source of SUPPORTED_LOCALES) {
      const targets = translationTargetLocales(source);
      expect(targets).not.toContain(source);
      expect([...targets, source].sort()).toEqual([...SUPPORTED_LOCALES].sort());
    }
  });
});

describe("userBioSourceLocale / guideSourceLocale", () => {
  it("bio は bio + shortBio を連結して 1 つ判定する（片方でも日本語なら ja）", () => {
    expect(userBioSourceLocale({ bio: "English bio", shortBio: "ランナー" })).toBe("ja");
    expect(userBioSourceLocale({ bio: "日本語の自己紹介", shortBio: "runner" })).toBe("ja");
    expect(userBioSourceLocale({ bio: "English bio", shortBio: "runner" })).toBe("en");
    expect(userBioSourceLocale({ bio: null, shortBio: null })).toBe("en");
  });

  it("ガイドは title + summary + 本文テキストで判定し、タグ・属性は除く", () => {
    expect(guideSourceLocale({ title: "Guide", summary: null, content: "<p>English</p>" })).toBe("en");
    expect(guideSourceLocale({ title: "ガイド", summary: null, content: "<p>English</p>" })).toBe("ja");
    expect(guideSourceLocale({ title: "Guide", summary: "概要", content: "<p>English</p>" })).toBe("ja");
    expect(guideSourceLocale({ title: "Guide", summary: null, content: "<p>日本語の本文</p>" })).toBe("ja");
    // 属性値の日本語は判定に含めない
    expect(
      guideSourceLocale({
        title: "Guide",
        summary: null,
        content: '<div data-preset-name="メイン" class="日本語"><p>English</p></div>',
      }),
    ).toBe("en");
  });

  it("sourceTexts は sourceHash の入力（空は空文字）", () => {
    expect(userBioSourceTexts({ bio: null, shortBio: "s" })).toEqual(["", "s"]);
    expect(guideSourceTexts({ title: "t", summary: null, content: "<p>c</p>" })).toEqual(["t", "", "<p>c</p>"]);
  });
});

// ============================================
// bio の翻訳と読み取り
// ============================================

describe("translateUserBio / getUserBioTranslation", () => {
  beforeEach(enableFeature);

  it("翻訳して ready 行を保存し、読み取りで訳文が返る", async () => {
    const user = await seedBioUser();
    const translate = fakeTranslate();

    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("translated");

    // [bio, shortBio] の順で ja → en に渡す
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][0]).toEqual(["自己紹介です", "ランナー"]);
    expect(translate.mock.calls[0][1]).toMatchObject({ from: "ja", to: "en" });

    const row = await rowFor("userBio", user.id);
    expect(row).toMatchObject({
      status: "ready",
      locale: "en",
      title: null,
      summary: "[en]ランナー",
      content: "[en]自己紹介です",
      engine: TRANSLATION_ENGINE,
      model: "fake-model",
      error: null,
      glossaryVersion: GLOSSARY_VERSION,
      sourceHash: sourceHash(["自己紹介です", "ランナー"]),
    });

    expect(await getUserBioTranslation(asDb(), { ...user }, "en")).toEqual({
      bio: "[en]自己紹介です",
      shortBio: "[en]ランナー",
      sourceLocale: "ja",
    });
  });

  it("閲覧ロケールが原文ロケールと同じなら null", async () => {
    const user = await seedBioUser();
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    expect(await getUserBioTranslation(asDb(), { ...user }, "ja")).toBeNull();
  });

  it("原文を変えるとハッシュ不一致で null、翻訳し直すと再び返る", async () => {
    const user = await seedBioUser();
    const translate = fakeTranslate();
    await translateUserBio(asDb(), user.id, { translate });

    const edited = { ...user, bio: "編集後の自己紹介です" };
    expect(await getUserBioTranslation(asDb(), edited, "en")).toBeNull();

    await db.update(users).set({ bio: edited.bio }).where(eq(users.id, user.id));
    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("translated");
    expect(await getUserBioTranslation(asDb(), edited, "en")).toMatchObject({ bio: "[en]編集後の自己紹介です" });
  });

  it("原文が同じなら upToDate で API（translate）を呼ばない", async () => {
    const user = await seedBioUser();
    const translate = fakeTranslate();
    await translateUserBio(asDb(), user.id, { translate });
    translate.mockClear();

    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("upToDate");
    expect(translate).not.toHaveBeenCalled();
    expect(await allRows()).toHaveLength(1);
  });

  it("shortBio だけ（bio が null）でも訳せて、無い側は null で返る", async () => {
    const user = await seedBioUser({ bio: null, shortBio: "ランナー" });
    const translate = fakeTranslate();
    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("translated");
    expect(translate.mock.calls[0][0]).toEqual(["", "ランナー"]);

    const row = await rowFor("userBio", user.id);
    expect(row.content).toBeNull();
    expect(row.summary).toBe("[en]ランナー");
    expect(await getUserBioTranslation(asDb(), { ...user }, "en")).toEqual({
      bio: null,
      shortBio: "[en]ランナー",
      sourceLocale: "ja",
    });
  });

  it("用語集バージョン不一致で null", async () => {
    const user = await seedBioUser();
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    await setRow("userBio", user.id, { glossaryVersion: GLOSSARY_VERSION + 1 });
    expect(await getUserBioTranslation(asDb(), { ...user }, "en")).toBeNull();
  });

  it.each(["pending", "failed"] as const)("status が %s なら null", async (status) => {
    const user = await seedBioUser();
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    await setRow("userBio", user.id, { status });
    expect(await getUserBioTranslation(asDb(), { ...user }, "en")).toBeNull();
  });

  it("翻訳関数が null（失敗）を返すと failed 行になり、読み取りは null", async () => {
    const user = await seedBioUser();
    expect(await translateUserBio(asDb(), user.id, { translate: failingTranslate() })).toBe("failed");

    const row = await rowFor("userBio", user.id);
    expect(row.status).toBe("failed");
    expect(row.error).toBeTruthy();
    expect(row.content).toBeNull();
    expect(await getUserBioTranslation(asDb(), { ...user }, "en")).toBeNull();
  });

  it("翻訳関数が例外を投げても例外にせず failed 行にする", async () => {
    const user = await seedBioUser();
    const translate = vi.fn<TranslateFn>(async () => {
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("failed");
    const row = await rowFor("userBio", user.id);
    expect(row.status).toBe("failed");
    expect(row.error).toContain("boom");
  });

  it("失敗後の再実行で翻訳に成功すれば ready になる", async () => {
    const user = await seedBioUser();
    await translateUserBio(asDb(), user.id, { translate: failingTranslate() });
    expect(await translateUserBio(asDb(), user.id, { translate: fakeTranslate() })).toBe("translated");
    expect((await rowFor("userBio", user.id)).status).toBe("ready");
  });

  it("オプトアウト（allowAutoTranslation = false）なら行を削除し、読み取りも null", async () => {
    const user = await seedBioUser();
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    expect(await allRows()).toHaveLength(1);

    await db.update(users).set({ allowAutoTranslation: false }).where(eq(users.id, user.id));
    expect(await translateUserBio(asDb(), user.id, { translate: fakeTranslate() })).toBe("removed");
    expect(await allRows()).toHaveLength(0);
    expect(await getUserBioTranslation(asDb(), { ...user, allowAutoTranslation: false }, "en")).toBeNull();
  });

  it("オプトアウトのユーザーは行が残っていても読み取りで null", async () => {
    const user = await seedBioUser();
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    expect(await getUserBioTranslation(asDb(), { ...user, allowAutoTranslation: false }, "en")).toBeNull();
  });

  it("bio も shortBio も空（空白のみ含む）なら行を削除する", async () => {
    const user = await seedBioUser();
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    expect(await allRows()).toHaveLength(1);

    await db.update(users).set({ bio: "   ", shortBio: "" }).where(eq(users.id, user.id));
    const translate = fakeTranslate();
    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("removed");
    expect(translate).not.toHaveBeenCalled();
    expect(await allRows()).toHaveLength(0);
  });

  it("存在しないユーザーは skipped", async () => {
    expect(await translateUserBio(asDb(), "no-such-user", { translate: fakeTranslate() })).toBe("skipped");
    expect(await allRows()).toHaveLength(0);
  });

  it("原文が英語になったら、翻訳先でなくなったロケールの行を消して新しい翻訳先へ訳す", async () => {
    const user = await seedBioUser();
    const translate = fakeTranslate();
    await translateUserBio(asDb(), user.id, { translate });
    expect(await rowFor("userBio", user.id, "en")).toBeTruthy();

    await db.update(users).set({ bio: "English bio", shortBio: "runner" }).where(eq(users.id, user.id));
    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("translated");

    expect(await rowFor("userBio", user.id, "en")).toBeUndefined();
    expect(await rowFor("userBio", user.id, "ja")).toMatchObject({ status: "ready", content: "[ja]English bio" });
    expect(translate.mock.calls.at(-1)?.[1]).toMatchObject({ from: "en", to: "ja" });
  });

  it("翻訳中に原文が編集されたら結果を捨てる（ready にならない）", async () => {
    const user = await seedBioUser();
    const translate = vi.fn<TranslateFn>(async (texts, options) => {
      await db.update(users).set({ bio: "翻訳中に編集されました" }).where(eq(users.id, user.id));
      return {
        texts: texts.map((t) => `[${options.to}]${t}`),
        model: "fake-model",
        engine: TRANSLATION_ENGINE,
        glossaryVersion: GLOSSARY_VERSION,
      };
    });

    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("failed");
    const row = await rowFor("userBio", user.id);
    expect(row.status).not.toBe("ready");
    expect(row.content).toBeNull();
  });

  it("非公開プロフィールは翻訳 API を呼ばず、既存の訳文行を削除する（removed）", async () => {
    const user = await seedBioUser();
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    expect(await allRows()).toHaveLength(1);

    await db.update(users).set({ profileVisibility: "private" }).where(eq(users.id, user.id));
    const translate = fakeTranslate();
    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("removed");
    expect(translate).not.toHaveBeenCalled();
    expect(await allRows()).toHaveLength(0);
  });

  it("最初から非公開のプロフィールは行を作らない（removed）", async () => {
    const user = await seedBioUser({ profileVisibility: "private" });
    const translate = fakeTranslate();
    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("removed");
    expect(translate).not.toHaveBeenCalled();
    expect(await allRows()).toHaveLength(0);
  });

  it("限定公開（unlisted）は従来どおり翻訳する", async () => {
    const user = await seedBioUser({ profileVisibility: "unlisted" });
    expect(await translateUserBio(asDb(), user.id, { translate: fakeTranslate() })).toBe("translated");
    expect((await rowFor("userBio", user.id)).status).toBe("ready");
  });

  it("非公開プロフィールの訳文は行が残っていても読み取りで null", async () => {
    const user = await seedBioUser();
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    await db.update(users).set({ profileVisibility: "private" }).where(eq(users.id, user.id));
    expect(await getUserBioTranslation(asDb(), { ...user, profileVisibility: "private" }, "en")).toBeNull();
    expect((await getUserBioTranslations(asDb(), [user.id], "en")).size).toBe(0);
  });

  it("翻訳中に許可をオフにして訳文行を削除されたら、結果を書き込まない（行が復活しない）", async () => {
    const user = await seedBioUser();
    const translate = fakeTranslateDuring(async () => {
      await db.update(users).set({ allowAutoTranslation: false }).where(eq(users.id, user.id));
      await removeUserBioTranslations(asDb(), user.id);
    });

    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("failed");
    expect(translate).toHaveBeenCalled();
    expect(await allRows()).toHaveLength(0);
  });

  it("翻訳中にプロフィールを非公開にされたら、結果を書き込まない", async () => {
    const user = await seedBioUser();
    const translate = fakeTranslateDuring(async () => {
      await db.update(users).set({ profileVisibility: "private" }).where(eq(users.id, user.id));
      await removeUserBioTranslations(asDb(), user.id);
    });

    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("failed");
    expect(await allRows()).toHaveLength(0);
  });

  it("翻訳関数が要素数の違う配列を返したら failed（部分的な訳文を保存しない）", async () => {
    const user = await seedBioUser();
    const translate = vi.fn<TranslateFn>(async () => ({
      texts: ["only one"],
      model: "fake-model",
      engine: TRANSLATION_ENGINE,
      glossaryVersion: GLOSSARY_VERSION,
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await translateUserBio(asDb(), user.id, { translate })).toBe("failed");
    expect((await rowFor("userBio", user.id)).status).toBe("failed");
  });
});

describe("getUserBioTranslations（一覧用）", () => {
  beforeEach(enableFeature);

  it("複数ユーザーの訳文をまとめて返し、オプトアウト・失効・原文ロケール一致を除く", async () => {
    const ok1 = await seedBioUser({ bio: "一人目の自己紹介", shortBio: null });
    const ok2 = await seedBioUser({ bio: "二人目の自己紹介", shortBio: "二人目" });
    const optedOut = await seedBioUser({ bio: "三人目の自己紹介" });
    const stale = await seedBioUser({ bio: "四人目の自己紹介" });
    const glossaryOld = await seedBioUser({ bio: "五人目の自己紹介" });
    const translate = fakeTranslate();
    for (const u of [ok1, ok2, optedOut, stale, glossaryOld]) {
      await translateUserBio(asDb(), u.id, { translate });
    }
    await db.update(users).set({ allowAutoTranslation: false }).where(eq(users.id, optedOut.id));
    await db.update(users).set({ bio: "編集済みの自己紹介" }).where(eq(users.id, stale.id));
    await setRow("userBio", glossaryOld.id, { glossaryVersion: GLOSSARY_VERSION + 1 });

    const result = await getUserBioTranslations(
      asDb(),
      [ok1.id, ok2.id, optedOut.id, stale.id, glossaryOld.id, ok1.id, "no-such-user"],
      "en",
    );
    expect([...result.keys()].sort()).toEqual([ok1.id, ok2.id].sort());
    expect(result.get(ok1.id)).toEqual({ bio: "[en]一人目の自己紹介", shortBio: null, sourceLocale: "ja" });
    expect(result.get(ok2.id)).toEqual({
      bio: "[en]二人目の自己紹介",
      shortBio: "[en]二人目",
      sourceLocale: "ja",
    });

    // 閲覧ロケールが原文ロケールなら誰も返らない
    expect((await getUserBioTranslations(asDb(), [ok1.id, ok2.id], "ja")).size).toBe(0);
  });

  it("id が空なら空の Map", async () => {
    expect((await getUserBioTranslations(asDb(), [], "en")).size).toBe(0);
  });
});

// ============================================
// ガイドの翻訳と読み取り
// ============================================

describe("translateGuide / getGuideTranslation", () => {
  beforeEach(enableFeature);

  it("公開版の title / summary / 本文を翻訳して保存し、読み取りで訳文が返る", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id, { content: "<p>本文です</p><pre><code>/seed 12345</code></pre>" });
    const translate = fakeTranslate();

    expect(await translateGuide(asDb(), guide.id, { translate })).toBe("translated");

    // [title, summary, ...本文テキストノード]（<pre> は含まれない）
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][0]).toEqual(["日本語のガイド", "概要です", "本文です"]);
    expect(translate.mock.calls[0][1]).toMatchObject({ from: "ja", to: "en" });

    const row = await rowFor("guide", guide.id);
    expect(row).toMatchObject({
      status: "ready",
      title: "[en]日本語のガイド",
      summary: "[en]概要です",
      content: "<p>[en]本文です</p><pre><code>/seed 12345</code></pre>",
      engine: TRANSLATION_ENGINE,
      model: "fake-model",
      sourceHash: sourceHash(["日本語のガイド", "概要です", "<p>本文です</p><pre><code>/seed 12345</code></pre>"]),
      glossaryVersion: GLOSSARY_VERSION,
    });

    const translated = await getGuideTranslation(
      asDb(),
      { ...guide },
      "en",
    );
    expect(translated).toEqual({
      title: "[en]日本語のガイド",
      summary: "[en]概要です",
      content: "<p>[en]本文です</p><pre><code>/seed 12345</code></pre>",
      sourceLocale: "ja",
    });
  });

  it("埋め込み div・img の属性は壊れず、alt は翻訳される", async () => {
    const author = await seedUser(db);
    const embed = '<div data-keybind-embed="" data-user-slug="runner1">埋め込み</div>';
    // サニタイザは値が空の属性を裸属性（data-keybind-embed）で出力する
    const sanitizedEmbed = '<div data-keybind-embed data-user-slug="runner1">埋め込み</div>';
    const guide = await seedJaGuide(author.id, {
      content: `<p>本文です</p>${embed}<img src="https://example.com/a.png" alt="図です">`,
    });
    await translateGuide(asDb(), guide.id, { translate: fakeTranslate() });
    const translated = await getGuideTranslation(asDb(), { ...guide }, "en");
    expect(translated?.content).toContain(sanitizedEmbed);
    expect(translated?.content).toContain('alt="[en]図です"');
    expect(translated?.content).toContain('src="https://example.com/a.png"');
  });

  it("訳文 HTML は読み取り時にサニタイズされる（保存済みの危険なタグは除かれる）", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    await insertRow({
      targetType: "guide",
      targetId: guide.id,
      sourceHash: sourceHash(guideSourceTexts(guide)),
      title: "T",
      summary: "S",
      content: '<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
    });
    const translated = await getGuideTranslation(asDb(), { ...guide }, "en");
    expect(translated?.content).toContain("<p>ok</p>");
    expect(translated?.content).not.toContain("<script");
    expect(translated?.content).not.toContain("onerror");
  });

  it("翻訳時にも訳文はサニタイズされ、訳文に混ぜたタグは注入されない", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    const translate = vi.fn<TranslateFn>(async (texts) => ({
      texts: texts.map(() => "<b>x</b><script>alert(1)</script>"),
      model: "fake-model",
      engine: TRANSLATION_ENGINE,
      glossaryVersion: GLOSSARY_VERSION,
    }));
    await translateGuide(asDb(), guide.id, { translate });
    const row = await rowFor("guide", guide.id);
    expect(row.content).not.toContain("<script");
    expect(row.content).not.toContain("<b>");
  });

  it("未公開のガイドは翻訳しない（skipped・行を作らない）", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id, { isPublished: false });
    const translate = fakeTranslate();
    expect(await translateGuide(asDb(), guide.id, { translate })).toBe("skipped");
    expect(translate).not.toHaveBeenCalled();
    expect(await allRows()).toHaveLength(0);
  });

  it("下書き列（draftTitle / draftSummary / draftContent）は翻訳に渡さず、保存もしない", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id, {
      draftTitle: "下書きタイトル",
      draftSummary: "下書きの概要",
      draftContent: "<p>下書きの本文</p>",
    });
    const translate = fakeTranslate();
    await translateGuide(asDb(), guide.id, { translate });

    const sent = translate.mock.calls.flatMap((c) => c[0]).join("\n");
    expect(sent).not.toContain("下書き");
    const row = await rowFor("guide", guide.id);
    expect(`${row.title}${row.summary}${row.content}`).not.toContain("下書き");
  });

  it("ガイドのオプトアウトで行を削除する（未公開でも削除される）", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    await translateGuide(asDb(), guide.id, { translate: fakeTranslate() });
    expect(await allRows()).toHaveLength(1);

    await db.update(guides).set({ allowAutoTranslation: false }).where(eq(guides.id, guide.id));
    expect(await translateGuide(asDb(), guide.id, { translate: fakeTranslate() })).toBe("removed");
    expect(await allRows()).toHaveLength(0);
    expect(await getGuideTranslation(asDb(), { ...guide, allowAutoTranslation: false }, "en")).toBeNull();
  });

  it("翻訳中に許可をオフにして訳文行を削除されたら、結果を書き込まない（行が復活しない）", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    const translate = fakeTranslateDuring(async () => {
      await db.update(guides).set({ allowAutoTranslation: false }).where(eq(guides.id, guide.id));
      await removeGuideTranslations(asDb(), guide.id);
    });

    expect(await translateGuide(asDb(), guide.id, { translate })).toBe("failed");
    expect(translate).toHaveBeenCalled();
    expect(await allRows()).toHaveLength(0);
  });

  it("翻訳中にガイドを非公開（ドラフト）に戻されたら、結果を書き込まない", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    const translate = fakeTranslateDuring(async () => {
      await db.update(guides).set({ isPublished: false }).where(eq(guides.id, guide.id));
    });

    expect(await translateGuide(asDb(), guide.id, { translate })).toBe("failed");
    expect((await rowFor("guide", guide.id))?.status).not.toBe("ready");
    expect((await rowFor("guide", guide.id))?.content ?? null).toBeNull();
  });

  it("存在しないガイドは skipped", async () => {
    expect(await translateGuide(asDb(), "no-such-guide", { translate: fakeTranslate() })).toBe("skipped");
  });

  it("原文を編集すると読み取りは null（古い訳文を出さない）、再翻訳で戻る", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    const translate = fakeTranslate();
    await translateGuide(asDb(), guide.id, { translate });

    const edited = { ...guide, content: "<p>編集後の本文です</p>" };
    expect(await getGuideTranslation(asDb(), edited, "en")).toBeNull();

    await db.update(guides).set({ content: edited.content }).where(eq(guides.id, guide.id));
    expect(await translateGuide(asDb(), guide.id, { translate })).toBe("translated");
    expect(await getGuideTranslation(asDb(), edited, "en")).toMatchObject({
      content: "<p>[en]編集後の本文です</p>",
    });
  });

  it("同じ原文なら upToDate で translate を呼ばない", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    const translate = fakeTranslate();
    await translateGuide(asDb(), guide.id, { translate });
    translate.mockClear();
    expect(await translateGuide(asDb(), guide.id, { translate })).toBe("upToDate");
    expect(translate).not.toHaveBeenCalled();
  });

  it("未公開・オプトアウト・閲覧ロケール一致・用語集不一致・status != ready は読み取りで null", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    await translateGuide(asDb(), guide.id, { translate: fakeTranslate() });

    expect(await getGuideTranslation(asDb(), { ...guide }, "en")).not.toBeNull();
    expect(await getGuideTranslation(asDb(), { ...guide, isPublished: false }, "en")).toBeNull();
    expect(await getGuideTranslation(asDb(), { ...guide, allowAutoTranslation: false }, "en")).toBeNull();
    expect(await getGuideTranslation(asDb(), { ...guide }, "ja")).toBeNull();

    await setRow("guide", guide.id, { status: "failed" });
    expect(await getGuideTranslation(asDb(), { ...guide }, "en")).toBeNull();
    await setRow("guide", guide.id, { status: "ready", glossaryVersion: GLOSSARY_VERSION + 1 });
    expect(await getGuideTranslation(asDb(), { ...guide }, "en")).toBeNull();
  });

  it("訳文の title が空の壊れた行は使わない", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    await translateGuide(asDb(), guide.id, { translate: fakeTranslate() });
    await setRow("guide", guide.id, { title: "" });
    expect(await getGuideTranslation(asDb(), { ...guide }, "en")).toBeNull();
  });

  it("summary が無いガイドは summary が null のまま返る", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id, { summary: null });
    const translate = fakeTranslate();
    await translateGuide(asDb(), guide.id, { translate });
    expect(translate.mock.calls[0][0].slice(0, 2)).toEqual(["日本語のガイド", ""]);
    expect(await getGuideTranslation(asDb(), { ...guide }, "en")).toMatchObject({ summary: null });
  });

  it("英語のガイドは ja へ翻訳される", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id, {
      title: "English guide",
      summary: "Summary",
      content: "<p>English body</p>",
    });
    const translate = fakeTranslate();
    await translateGuide(asDb(), guide.id, { translate });
    expect(translate.mock.calls[0][1]).toMatchObject({ from: "en", to: "ja" });
    expect(await getGuideTranslation(asDb(), { ...guide }, "ja")).toMatchObject({
      title: "[ja]English guide",
      sourceLocale: "en",
    });
    expect(await getGuideTranslation(asDb(), { ...guide }, "en")).toBeNull();
  });

  it("失敗（null）は failed 行になり、読み取りは null", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id);
    expect(await translateGuide(asDb(), guide.id, { translate: failingTranslate() })).toBe("failed");
    const row = await rowFor("guide", guide.id);
    expect(row.status).toBe("failed");
    expect(row.error).toBeTruthy();
    expect(await getGuideTranslation(asDb(), { ...guide }, "en")).toBeNull();
  });

  it("長い本文は上限ごとのチャンクに分けて順に翻訳し、結果は順序どおりに書き戻される", async () => {
    const author = await seedUser(db);
    const long = (c: string) => c.repeat(5000);
    const guide = await seedJaGuide(author.id, {
      content: `<p>${long("あ")}</p><p>${long("い")}</p><p>${long("う")}</p>`,
    });
    const translate = fakeTranslate();
    expect(await translateGuide(asDb(), guide.id, { translate })).toBe("translated");

    expect(translate.mock.calls.length).toBeGreaterThan(1);
    for (const [texts] of translate.mock.calls) {
      expect(texts.join("").length).toBeLessThanOrEqual(8000);
    }
    // 全チャンクの入力を連結すると [title, summary, ...本文] の順
    const sent = translate.mock.calls.flatMap((c) => c[0]);
    expect(sent).toEqual(["日本語のガイド", "概要です", long("あ"), long("い"), long("う")]);

    const row = await rowFor("guide", guide.id);
    expect(row.content).toBe(`<p>[en]${long("あ")}</p><p>[en]${long("い")}</p><p>[en]${long("う")}</p>`);
  });

  it("チャンクのどれか 1 つでも失敗したら全体を failed にする", async () => {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id, {
      content: `<p>${"あ".repeat(5000)}</p><p>${"い".repeat(5000)}</p>`,
    });
    let call = 0;
    const translate = vi.fn<TranslateFn>(async (texts, options) => {
      call++;
      if (call === 2) return null;
      return {
        texts: texts.map((t) => `[${options.to}]${t}`),
        model: "fake-model",
        engine: TRANSLATION_ENGINE,
        glossaryVersion: GLOSSARY_VERSION,
      };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await translateGuide(asDb(), guide.id, { translate })).toBe("failed");
    expect(call).toBe(2);
    const row = await rowFor("guide", guide.id);
    expect(row.status).toBe("failed");
    expect(row.content).toBeNull();
  });
});

describe("getGuideTranslations（一覧用）", () => {
  beforeEach(enableFeature);

  it("複数件を正しく返し、オプトアウト・非公開・失効・閲覧ロケール一致を除外する", async () => {
    const author = await seedUser(db);
    const a = await seedJaGuide(author.id, { title: "ガイドA", summary: "概要A" });
    const b = await seedJaGuide(author.id, { title: "ガイドB", summary: null });
    const optedOut = await seedJaGuide(author.id, { title: "ガイドC" });
    const unpublished = await seedJaGuide(author.id, { title: "ガイドD" });
    const stale = await seedJaGuide(author.id, { title: "ガイドE" });
    const glossaryOld = await seedJaGuide(author.id, { title: "ガイドF" });
    const translate = fakeTranslate();
    for (const g of [a, b, optedOut, unpublished, stale, glossaryOld]) {
      await translateGuide(asDb(), g.id, { translate });
    }
    await db.update(guides).set({ allowAutoTranslation: false }).where(eq(guides.id, optedOut.id));
    await db.update(guides).set({ isPublished: false }).where(eq(guides.id, unpublished.id));
    await db.update(guides).set({ content: "<p>変わった本文</p>" }).where(eq(guides.id, stale.id));
    await setRow("guide", glossaryOld.id, { glossaryVersion: GLOSSARY_VERSION + 1 });

    const ids = [a, b, optedOut, unpublished, stale, glossaryOld].map((g) => g.id);
    const result = await getGuideTranslations(asDb(), [...ids, a.id, "no-such-guide"], "en");

    expect([...result.keys()].sort()).toEqual([a.id, b.id].sort());
    expect(result.get(a.id)).toEqual({ title: "[en]ガイドA", summary: "[en]概要A", sourceLocale: "ja" });
    expect(result.get(b.id)).toEqual({ title: "[en]ガイドB", summary: null, sourceLocale: "ja" });
    // 一覧版は本文を返さない
    expect(result.get(a.id)).not.toHaveProperty("content");

    expect((await getGuideTranslations(asDb(), ids, "ja")).size).toBe(0);
  });

  it("id が空なら空の Map", async () => {
    expect((await getGuideTranslations(asDb(), [], "en")).size).toBe(0);
  });
});

// ============================================
// 機能無効時（ANTHROPIC_API_KEY 未設定）
// ============================================

describe("機能無効時", () => {
  it("isTranslationEnabled() が false の前提（API キー未設定）", () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("読み取りは ready 行があっても null / 空の Map", async () => {
    const author = await seedUser(db);
    const user = await seedBioUser();
    const guide = await seedJaGuide(author.id);
    // 機能有効のときに翻訳して行を作り、その後で無効に戻す
    enableFeature();
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    await translateGuide(asDb(), guide.id, { translate: fakeTranslate() });
    expect(await getUserBioTranslation(asDb(), { ...user }, "en")).not.toBeNull();
    delete process.env.ANTHROPIC_API_KEY;

    expect(await getUserBioTranslation(asDb(), { ...user }, "en")).toBeNull();
    expect((await getUserBioTranslations(asDb(), [user.id], "en")).size).toBe(0);
    expect(await getGuideTranslation(asDb(), { ...guide }, "en")).toBeNull();
    expect((await getGuideTranslations(asDb(), [guide.id], "en")).size).toBe(0);
  });

  it("translate 差し替えなしの translateUserBio / translateGuide は skipped で DB を書かない", async () => {
    const author = await seedUser(db);
    const user = await seedBioUser();
    const guide = await seedJaGuide(author.id);
    expect(await translateUserBio(asDb(), user.id)).toBe("skipped");
    expect(await translateGuide(asDb(), guide.id)).toBe("skipped");
    expect(await allRows()).toHaveLength(0);
  });

  it("機能無効では opt-out 済みでも skipped（削除もしない）", async () => {
    const user = await seedBioUser({ allowAutoTranslation: false });
    await insertRow({ targetType: "userBio", targetId: user.id });
    expect(await translateUserBio(asDb(), user.id)).toBe("skipped");
    expect(await allRows()).toHaveLength(1);
  });

  it("scheduleTranslation は何もしない（waitUntil も呼ばない）", async () => {
    const user = await seedBioUser();
    const guide = await seedJaGuide(user.id);
    scheduleTranslation(asDb(), { type: "userBio", id: user.id });
    scheduleTranslation(asDb(), { type: "guide", id: guide.id });
    scheduleUserBioTranslation(asDb(), user.id);
    scheduleGuideTranslation(asDb(), guide.id);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
    expect(await allRows()).toHaveLength(0);
  });

  it("processPendingTranslations は全件 0 を返し、DB を書かない", async () => {
    const user = await seedBioUser();
    await seedJaGuide(user.id);
    const before = await db.select().from(guides);

    const result = await processPendingTranslations(asDb());
    expect(result).toEqual({ processed: 0, translated: 0, upToDate: 0, failed: 0, skipped: 0, removed: 0 });
    expect(await allRows()).toHaveLength(0);
    expect(await db.select().from(guides)).toEqual(before);
  });

  it("processPendingTranslations は機能無効では掃除もしない（opt-out 対象の残存行にも触れない）", async () => {
    const user = await seedBioUser({ allowAutoTranslation: false });
    await insertRow({ targetType: "userBio", targetId: user.id });

    const result = await processPendingTranslations(asDb());
    expect(result).toEqual({ processed: 0, translated: 0, upToDate: 0, failed: 0, skipped: 0, removed: 0 });
    expect(await allRows()).toHaveLength(1);
  });

  it("removeUserBioTranslations / removeGuideTranslations は機能無効でも行を削除する", async () => {
    const author = await seedBioUser();
    const other = await seedBioUser();
    const guide = await seedJaGuide(author.id);
    const otherGuide = await seedJaGuide(author.id);
    await insertRow({ targetType: "userBio", targetId: author.id });
    await insertRow({ targetType: "userBio", targetId: author.id, locale: "ja" });
    await insertRow({ targetType: "userBio", targetId: other.id });
    await insertRow({ targetType: "guide", targetId: guide.id });
    await insertRow({ targetType: "guide", targetId: otherGuide.id });

    await removeUserBioTranslations(asDb(), author.id);
    expect((await allRows()).map((r) => `${r.targetType}:${r.targetId}`).sort()).toEqual(
      [`userBio:${other.id}`, `guide:${guide.id}`, `guide:${otherGuide.id}`].sort(),
    );

    await removeGuideTranslations(asDb(), guide.id);
    expect((await allRows()).map((r) => `${r.targetType}:${r.targetId}`).sort()).toEqual(
      [`userBio:${other.id}`, `guide:${otherGuide.id}`].sort(),
    );
  });
});

// ============================================
// scheduleTranslation（waitUntil）
// ============================================

describe("scheduleTranslation（機能有効）", () => {
  beforeEach(enableFeature);

  it("waitUntil に Promise を渡し、完了まで走る（存在しない対象なら何も書かない）", async () => {
    scheduleTranslation(asDb(), { type: "userBio", id: "no-such-user" });
    scheduleGuideTranslation(asDb(), "no-such-guide");
    scheduleUserBioTranslation(asDb(), "no-such-user-2");

    expect(mocks.waitUntil).toHaveBeenCalledTimes(3);
    for (const [task] of mocks.waitUntil.mock.calls) {
      expect(task).toBeInstanceOf(Promise);
      await expect(task).resolves.toBe("skipped");
    }
    expect(await allRows()).toHaveLength(0);
  });

  it("waitUntil が例外を投げても throw しない", async () => {
    mocks.waitUntil.mockImplementation(() => {
      throw new Error("waitUntil unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => scheduleTranslation(asDb(), { type: "guide", id: "no-such-guide" })).not.toThrow();
    await Promise.resolve();
  });
});

// ============================================
// Cron: processPendingTranslations
// ============================================

describe("processPendingTranslations", () => {
  /** 固定の基準時刻。translation 行の updatedAt と `now` をここからの相対で組み立てる */
  const T0 = new Date("2025-06-01T00:00:00Z");
  const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);
  /** 原文の updatedAt。T0 より古くしておくと「原文が更新された ready 行」に誤ってかからない */
  const OLD = new Date("2025-01-01T00:00:00Z");

  beforeEach(enableFeature);

  /** 翻訳済み（ready・最新ハッシュ）の状態を作り、翻訳行の updatedAt を T0 に固定する */
  async function makeReadyGuide() {
    const author = await seedUser(db);
    const guide = await seedJaGuide(author.id, { updatedAt: OLD });
    await translateGuide(asDb(), guide.id, { translate: fakeTranslate() });
    await setRow("guide", guide.id, { updatedAt: T0 });
    return guide;
  }

  async function makeReadyBio() {
    const user = await seedBioUser({ updatedAt: OLD });
    await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
    await setRow("userBio", user.id, { updatedAt: T0 });
    return user;
  }

  it("定数の値（pending 10 分 / failed 6 時間 / 既定 limit 10）", () => {
    expect(PENDING_RETRY_MS).toBe(10 * 60 * 1000);
    expect(FAILED_RETRY_MS).toBe(6 * 60 * 60 * 1000);
    expect(DEFAULT_CRON_LIMIT).toBe(10);
  });

  it("翻訳行の無い公開ガイドと空でない bio を拾って翻訳する", async () => {
    const author = await seedBioUser({ updatedAt: OLD });
    const guide = await seedJaGuide(author.id, { updatedAt: OLD });
    const translate = fakeTranslate();

    const result = await processPendingTranslations(asDb(), { translate, now: T0 });
    expect(result).toEqual({ processed: 2, translated: 2, upToDate: 0, failed: 0, skipped: 0, removed: 0 });
    expect((await rowFor("guide", guide.id)).status).toBe("ready");
    expect((await rowFor("userBio", author.id)).status).toBe("ready");

    // 2 回目は対象なし
    translate.mockClear();
    const again = await processPendingTranslations(asDb(), { translate, now: T0 });
    expect(again.processed).toBe(0);
    expect(translate).not.toHaveBeenCalled();
  });

  it("対象外: 未公開ガイド・オプトアウト・非公開プロフィールの bio・空の bio", async () => {
    const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
    await seedJaGuide(author.id, { isPublished: false, updatedAt: OLD });
    await seedJaGuide(author.id, { allowAutoTranslation: false, updatedAt: OLD });
    await seedBioUser({ profileVisibility: "private", updatedAt: OLD });
    await seedBioUser({ allowAutoTranslation: false, updatedAt: OLD });
    await seedUser(db, { bio: "   ", shortBio: null, updatedAt: OLD });
    const translate = fakeTranslate();

    const result = await processPendingTranslations(asDb(), { translate, now: T0 });
    expect(result.processed).toBe(0);
    expect(translate).not.toHaveBeenCalled();
    expect(await allRows()).toHaveLength(0);
  });

  it("unlisted プロフィールの bio は対象（private のみ除外）", async () => {
    const user = await seedBioUser({ profileVisibility: "unlisted", updatedAt: OLD });
    const result = await processPendingTranslations(asDb(), { translate: fakeTranslate(), now: T0 });
    expect(result).toMatchObject({ processed: 1, translated: 1 });
    expect((await rowFor("userBio", user.id)).status).toBe("ready");
  });

  it("limit を守る（ガイドと bio の合計）", async () => {
    const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
    for (let i = 0; i < 3; i++) await seedJaGuide(author.id, { title: `ガイド${i}`, updatedAt: OLD });
    for (let i = 0; i < 3; i++) await seedBioUser({ bio: `自己紹介${i}`, updatedAt: OLD });

    const translate = fakeTranslate();
    const first = await processPendingTranslations(asDb(), { translate, now: T0, limit: 4 });
    expect(first.processed).toBe(4);
    expect(first.translated).toBe(4);
    expect(await allRows()).toHaveLength(4);

    // 続きの実行で残りを処理する
    const second = await processPendingTranslations(asDb(), { translate, now: T0, limit: 4 });
    expect(second.processed).toBe(2);
    expect(await allRows()).toHaveLength(6);
  });

  it("limit 0 なら何も処理しない／limit 省略時は既定上限（10 件）で打ち切る", async () => {
    const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
    for (let i = 0; i < DEFAULT_CRON_LIMIT + 2; i++) {
      await seedJaGuide(author.id, { title: `ガイド${i}`, updatedAt: OLD });
    }
    const translate = fakeTranslate();

    expect((await processPendingTranslations(asDb(), { translate, now: T0, limit: 0 })).processed).toBe(0);
    expect(await allRows()).toHaveLength(0);

    expect((await processPendingTranslations(asDb(), { translate, now: T0 })).processed).toBe(DEFAULT_CRON_LIMIT);
    expect(await allRows()).toHaveLength(DEFAULT_CRON_LIMIT);
  });

  describe("failed の再試行間隔", () => {
    it("間隔内（6 時間未満）は対象外、過ぎたら対象", async () => {
      const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
      const guide = await seedJaGuide(author.id, { updatedAt: OLD });
      await insertRow({ targetType: "guide", targetId: guide.id, status: "failed", error: "x", updatedAt: T0 });
      const translate = fakeTranslate();

      // pending の猶予（10 分）は過ぎているが failed の間隔（6 時間）の内側
      const early = await processPendingTranslations(asDb(), { translate, now: at(FAILED_RETRY_MS - 60_000) });
      expect(early.processed).toBe(0);
      expect(translate).not.toHaveBeenCalled();
      expect((await rowFor("guide", guide.id)).status).toBe("failed");

      const late = await processPendingTranslations(asDb(), { translate, now: at(FAILED_RETRY_MS + 60_000) });
      expect(late).toMatchObject({ processed: 1, translated: 1 });
      expect((await rowFor("guide", guide.id)).status).toBe("ready");
    });

    it("bio も同様に間隔で判定され、再試行が失敗すれば failed が数えられる", async () => {
      const user = await seedBioUser({ updatedAt: OLD });
      await insertRow({ targetType: "userBio", targetId: user.id, status: "failed", error: "x", updatedAt: T0 });

      expect(
        (await processPendingTranslations(asDb(), { translate: fakeTranslate(), now: at(FAILED_RETRY_MS - 60_000) }))
          .processed,
      ).toBe(0);

      vi.spyOn(console, "error").mockImplementation(() => {});
      const late = await processPendingTranslations(asDb(), {
        translate: failingTranslate(),
        now: at(FAILED_RETRY_MS + 60_000),
      });
      expect(late).toMatchObject({ processed: 1, failed: 1, translated: 0 });
    });
  });

  describe("pending の再試行猶予", () => {
    it("猶予内（10 分未満）は対象外、過ぎたら対象", async () => {
      const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
      const guide = await seedJaGuide(author.id, { updatedAt: OLD });
      await insertRow({ targetType: "guide", targetId: guide.id, status: "pending", updatedAt: T0 });
      const translate = fakeTranslate();

      expect(
        (await processPendingTranslations(asDb(), { translate, now: at(PENDING_RETRY_MS - 60_000) })).processed,
      ).toBe(0);
      expect(translate).not.toHaveBeenCalled();

      const late = await processPendingTranslations(asDb(), { translate, now: at(PENDING_RETRY_MS + 60_000) });
      expect(late).toMatchObject({ processed: 1, translated: 1 });
      expect((await rowFor("guide", guide.id)).status).toBe("ready");
    });

    it("pending の猶予（10 分）と failed の間隔（6 時間）は別の閾値", async () => {
      const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
      const pendingGuide = await seedJaGuide(author.id, { title: "pendingのガイド", updatedAt: OLD });
      const failedGuide = await seedJaGuide(author.id, { title: "failedのガイド", updatedAt: OLD });
      await insertRow({ targetType: "guide", targetId: pendingGuide.id, status: "pending", updatedAt: T0 });
      await insertRow({ targetType: "guide", targetId: failedGuide.id, status: "failed", updatedAt: T0 });
      const translate = fakeTranslate();

      // 1 時間後: pending だけが対象
      const result = await processPendingTranslations(asDb(), { translate, now: at(60 * 60 * 1000) });
      expect(result.processed).toBe(1);
      expect((await rowFor("guide", pendingGuide.id)).status).toBe("ready");
      expect((await rowFor("guide", failedGuide.id)).status).toBe("failed");
    });
  });

  it("ready でも用語集バージョンが古い行は再翻訳する", async () => {
    const guide = await makeReadyGuide();
    const user = await makeReadyBio();
    await setRow("guide", guide.id, { glossaryVersion: GLOSSARY_VERSION - 1 });
    await setRow("userBio", user.id, { glossaryVersion: GLOSSARY_VERSION - 1 });
    const translate = fakeTranslate();

    const result = await processPendingTranslations(asDb(), { translate, now: at(60_000) });
    expect(result).toMatchObject({ processed: 2, translated: 2 });
    expect((await rowFor("guide", guide.id)).glossaryVersion).toBe(GLOSSARY_VERSION);
    expect((await rowFor("userBio", user.id)).glossaryVersion).toBe(GLOSSARY_VERSION);
  });

  it("最新の ready 行（原文も用語集も更新なし）は対象外", async () => {
    await makeReadyGuide();
    await makeReadyBio();
    const translate = fakeTranslate();
    const result = await processPendingTranslations(asDb(), { translate, now: at(FAILED_RETRY_MS * 10) });
    expect(result.processed).toBe(0);
    expect(translate).not.toHaveBeenCalled();
  });

  it("原文の updatedAt が翻訳行より新しい ready 行を拾い、ハッシュが同じなら upToDate で再検出を止める", async () => {
    const guide = await makeReadyGuide();
    // 無関係な列の更新（タイトル等は同じ）で updatedAt だけ進んだ状態
    await db.update(guides).set({ updatedAt: at(60_000) }).where(eq(guides.id, guide.id));
    const translate = fakeTranslate();

    const first = await processPendingTranslations(asDb(), { translate, now: at(120_000) });
    expect(first).toMatchObject({ processed: 1, upToDate: 1, translated: 0 });
    expect(translate).not.toHaveBeenCalled();

    // 翻訳行の updatedAt が進んだので、次の実行では再検出されない
    const second = await processPendingTranslations(asDb(), { translate, now: at(180_000) });
    expect(second.processed).toBe(0);
  });

  it("原文が実際に編集された ready 行は再翻訳する", async () => {
    const guide = await makeReadyGuide();
    await db
      .update(guides)
      .set({ content: "<p>編集後の本文です</p>", updatedAt: at(60_000) })
      .where(eq(guides.id, guide.id));
    const translate = fakeTranslate();

    const result = await processPendingTranslations(asDb(), { translate, now: at(120_000) });
    expect(result).toMatchObject({ processed: 1, translated: 1 });
    expect((await rowFor("guide", guide.id)).content).toBe("<p>[en]編集後の本文です</p>");
  });

  it("オプトアウト・非公開化されたものは行が残っていても翻訳を再試行しない（掃除で削除される）", async () => {
    const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
    const optedOut = await seedJaGuide(author.id, { title: "オプトアウト", updatedAt: OLD });
    const unpublished = await seedJaGuide(author.id, { title: "非公開", updatedAt: OLD });
    const privateUser = await seedBioUser({ profileVisibility: "private", updatedAt: OLD });
    for (const id of [optedOut.id, unpublished.id]) {
      await insertRow({ targetType: "guide", targetId: id, status: "failed", updatedAt: T0 });
    }
    await insertRow({ targetType: "userBio", targetId: privateUser.id, status: "failed", updatedAt: T0 });
    await db.update(guides).set({ allowAutoTranslation: false }).where(eq(guides.id, optedOut.id));
    await db.update(guides).set({ isPublished: false }).where(eq(guides.id, unpublished.id));
    const translate = fakeTranslate();

    const result = await processPendingTranslations(asDb(), { translate, now: at(FAILED_RETRY_MS * 2) });
    expect(translate).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 3, translated: 0, upToDate: 0, failed: 0, skipped: 0, removed: 3 });
    expect(await allRows()).toHaveLength(0);
  });

  describe("掃除: 翻訳が許されなくなった対象に残っている訳文行を削除する", () => {
    it("許可オフ・非公開 bio・未公開ガイドの訳文行を削除し、removed に数える（API は呼ばない）", async () => {
      const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
      const optedOutGuide = await seedJaGuide(author.id, { title: "オプトアウト", updatedAt: OLD });
      const draftGuide = await seedJaGuide(author.id, { title: "ドラフト", updatedAt: OLD });
      const privateUser = await seedBioUser({ profileVisibility: "private", updatedAt: OLD });
      const optedOutUser = await seedBioUser({ allowAutoTranslation: false, updatedAt: OLD });
      const keepGuide = await makeReadyGuide();
      const keepUser = await makeReadyBio();
      for (const g of [optedOutGuide, draftGuide]) await insertRow({ targetType: "guide", targetId: g.id });
      await insertRow({ targetType: "guide", targetId: optedOutGuide.id, locale: "ja" });
      for (const u of [privateUser, optedOutUser]) await insertRow({ targetType: "userBio", targetId: u.id });
      await db.update(guides).set({ allowAutoTranslation: false }).where(eq(guides.id, optedOutGuide.id));
      await db.update(guides).set({ isPublished: false }).where(eq(guides.id, draftGuide.id));
      const translate = fakeTranslate();

      const result = await processPendingTranslations(asDb(), { translate, now: T0 });
      expect(result).toEqual({ processed: 4, translated: 0, upToDate: 0, failed: 0, skipped: 0, removed: 4 });
      expect(translate).not.toHaveBeenCalled();
      // 翻訳が許されている対象の行は残る
      expect((await allRows()).map((r) => `${r.targetType}:${r.targetId}`).sort()).toEqual(
        [`guide:${keepGuide.id}`, `userBio:${keepUser.id}`].sort(),
      );
    });

    it("unlisted の bio の行は掃除しない", async () => {
      const user = await seedBioUser({ profileVisibility: "unlisted", updatedAt: OLD });
      await translateUserBio(asDb(), user.id, { translate: fakeTranslate() });
      await setRow("userBio", user.id, { updatedAt: T0 });

      const result = await processPendingTranslations(asDb(), { translate: fakeTranslate(), now: T0 });
      expect(result.processed).toBe(0);
      expect(await allRows()).toHaveLength(1);
    });

    it("limit を翻訳と共有し、1 回で捌けない分は次の実行で削除する", async () => {
      const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
      for (let i = 0; i < 3; i++) {
        const g = await seedJaGuide(author.id, { title: `ドラフト${i}`, isPublished: false, updatedAt: OLD });
        await insertRow({ targetType: "guide", targetId: g.id });
      }

      const first = await processPendingTranslations(asDb(), { translate: fakeTranslate(), now: T0, limit: 2 });
      expect(first).toMatchObject({ processed: 2, removed: 2 });
      expect(await allRows()).toHaveLength(1);

      const second = await processPendingTranslations(asDb(), { translate: fakeTranslate(), now: T0, limit: 2 });
      expect(second).toMatchObject({ processed: 1, removed: 1 });
      expect(await allRows()).toHaveLength(0);
    });

    it("timeBudgetMs を使い切っていたら掃除もしない／limit 0 でも何もしない", async () => {
      const user = await seedBioUser({ allowAutoTranslation: false, updatedAt: OLD });
      await insertRow({ targetType: "userBio", targetId: user.id });
      const translate = fakeTranslate();

      expect((await processPendingTranslations(asDb(), { translate, now: T0, timeBudgetMs: 0 })).processed).toBe(0);
      expect((await processPendingTranslations(asDb(), { translate, now: T0, limit: 0 })).processed).toBe(0);
      expect(await allRows()).toHaveLength(1);
    });
  });

  it("再試行すべき行が、行の無い新規対象より優先される", async () => {
    const author = await seedUser(db, { bio: null, shortBio: null, updatedAt: OLD });
    const retry = await seedJaGuide(author.id, { title: "再試行", updatedAt: OLD });
    const fresh = await seedJaGuide(author.id, { title: "新規", updatedAt: OLD });
    await insertRow({ targetType: "guide", targetId: retry.id, status: "failed", updatedAt: T0 });

    await processPendingTranslations(asDb(), {
      translate: fakeTranslate(),
      now: at(FAILED_RETRY_MS + 60_000),
      limit: 1,
    });
    expect((await rowFor("guide", retry.id)).status).toBe("ready");
    expect(await rowFor("guide", fresh.id)).toBeUndefined();
  });

  it("結果の件数: 翻訳関数が失敗を返した対象は failed に数える", async () => {
    await seedBioUser({ updatedAt: OLD });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await processPendingTranslations(asDb(), { translate: failingTranslate(), now: T0 });
    expect(result).toEqual({ processed: 1, translated: 0, upToDate: 0, failed: 1, skipped: 0, removed: 0 });
  });

  it("timeBudgetMs を使い切っていたら新しい対象に着手しない", async () => {
    await seedBioUser({ updatedAt: OLD });
    const translate = fakeTranslate();
    const result = await processPendingTranslations(asDb(), { translate, now: T0, timeBudgetMs: 0 });
    expect(result.processed).toBe(0);
    expect(translate).not.toHaveBeenCalled();
  });
});
