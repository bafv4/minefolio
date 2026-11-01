// 利用者コンテンツ（プロフィール bio / ガイド）の自動翻訳: 保存・読み取り・実行・スケジュール。
// 仕様は docs/translation.md。エンジン本体（配列 in/out）は translate.server.ts、
// ガイド本文の HTML 加工は guide-translate-html.server.ts、用語集は translation-glossary.ts。
//
// 規約:
// - **読み取りは「sourceHash 一致 かつ glossaryVersion 一致 かつ status = ready」かつ原文ロケール≠閲覧ロケール、
//   かつ機能有効・オプトアウトでない**ときだけ訳文を返し、それ以外は null（呼び出し側は原文を使う）
// - 失敗は例外にしない。翻訳の失敗でページ・保存 action を壊さない
// - 対象ごとに原文ロケールは 1 つ（bio は bio+shortBio、ガイドは title+summary+本文を連結して判定）
//
// 列の割り当て（content_translations）:
//   userBio: content = bio（Markdown）, summary = shortBio, title = 未使用
//   guide:   title / summary / content = ガイドの同名列（content は HTML）
//
// sourceHash は**原文フィールドそのもの**から作る（bio+shortBio / title+summary+content の生 HTML）。
// HTML 抽出後の配列からは作らない。一覧ページで全ガイドの本文をパースせずに失効判定するため。
import { waitUntil } from "@vercel/functions";
import { and, asc, eq, gt, inArray, lt, ne, notExists, or, sql } from "drizzle-orm";
import type { Database } from "./db";
import { contentTranslations, guides, users } from "./schema";
import { SUPPORTED_LOCALES, type Locale } from "./locale";
import { GLOSSARY_VERSION } from "./translation-glossary";
import {
  MAX_INPUT_CHARS,
  TRANSLATION_ENGINE,
  isTranslationEnabled,
  sourceHash,
  translateTexts,
} from "./translate.server";
import { chunkTexts, extractGuideHtmlTexts } from "./guide-translate-html.server";
import { sanitizeGuideHtml } from "./guide-sanitize.server";
import { deleteTranslationsForGuide, deleteTranslationsForUser } from "./content-cleanup.server";

// ============================================
// 原文ロケールの判定・翻訳先の決定（純関数）
// ============================================

/** ひらがな・カタカナ・漢字（CJK 統合漢字と拡張A）・半角カナ */
const JAPANESE_CHAR_RE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

/** 原文の言語を文字種で判定する。日本語の文字（ひらがな・カタカナ・漢字）を含めば "ja"、含まなければ "en" */
export function detectSourceLocale(text: string): Locale {
  return JAPANESE_CHAR_RE.test(text) ? "ja" : "en";
}

/** 翻訳先ロケール = 対応ロケールのうち原文ロケール以外のすべて（同じロケールへは翻訳しない） */
export function translationTargetLocales(source: Locale): Locale[] {
  return SUPPORTED_LOCALES.filter((locale) => locale !== source);
}

export interface UserBioSource {
  bio: string | null;
  shortBio: string | null;
}

export interface GuideSource {
  title: string;
  summary: string | null;
  content: string;
}

/** bio の翻訳対象テキスト（[bio, shortBio]。無いものは空文字）。sourceHash の入力でもある */
export function userBioSourceTexts(user: UserBioSource): string[] {
  return [user.bio ?? "", user.shortBio ?? ""];
}

/** ガイドの翻訳対象テキスト（[title, summary, content の生 HTML]）。sourceHash の入力でもある */
export function guideSourceTexts(guide: GuideSource): string[] {
  return [guide.title, guide.summary ?? "", guide.content];
}

/** bio の原文ロケール（bio+shortBio を連結して 1 つ判定） */
export function userBioSourceLocale(user: UserBioSource): Locale {
  return detectSourceLocale(userBioSourceTexts(user).join("\n"));
}

/** ガイドの原文ロケール（title+summary+本文のテキストを連結して 1 つ判定。タグ・属性は除く） */
export function guideSourceLocale(guide: GuideSource): Locale {
  const [title, summary, content] = guideSourceTexts(guide);
  return detectSourceLocale([title, summary, content.replace(/<[^>]*>/g, " ")].join("\n"));
}

function isBioBlank(user: UserBioSource): boolean {
  return (user.bio ?? "").trim() === "" && (user.shortBio ?? "").trim() === "";
}

// ============================================
// 読み取り
// ============================================

export interface TranslatedBio {
  bio: string | null;
  shortBio: string | null;
  /** 原文のロケール（「原文（日本語）を表示」の表記用） */
  sourceLocale: Locale;
}

export interface TranslatedGuide {
  title: string;
  summary: string | null;
  /** サニタイズ済み HTML */
  content: string;
  sourceLocale: Locale;
}

/** 一覧用（本文は読まない） */
export interface TranslatedGuideSummary {
  title: string;
  summary: string | null;
  sourceLocale: Locale;
}

interface ReadyRow {
  targetId: string;
  sourceHash: string;
  title: string | null;
  summary: string | null;
  content: string | null;
}

/** 閲覧ロケールの「ready かつ用語集バージョン一致」の行を引く（ハッシュの照合は呼び出し側） */
async function selectReadyRows(
  db: Database,
  targetType: "userBio" | "guide",
  ids: string[],
  locale: Locale,
  includeContent: boolean,
): Promise<ReadyRow[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      targetId: contentTranslations.targetId,
      sourceHash: contentTranslations.sourceHash,
      title: contentTranslations.title,
      summary: contentTranslations.summary,
      content: includeContent ? contentTranslations.content : sql<string | null>`null`,
    })
    .from(contentTranslations)
    .where(
      and(
        eq(contentTranslations.targetType, targetType),
        inArray(contentTranslations.targetId, ids),
        eq(contentTranslations.locale, locale),
        eq(contentTranslations.status, "ready"),
        eq(contentTranslations.glossaryVersion, GLOSSARY_VERSION),
      ),
    );
}

function nullIfEmpty(value: string | null): string | null {
  return value === null || value === "" ? null : value;
}

function toTranslatedBio(
  row: ReadyRow,
  user: UserBioSource,
  viewerLocale: Locale,
): TranslatedBio | null {
  if (row.sourceHash !== sourceHash(userBioSourceTexts(user))) return null;
  const sourceLocale = userBioSourceLocale(user);
  if (sourceLocale === viewerLocale) return null;
  return { bio: nullIfEmpty(row.content), shortBio: nullIfEmpty(row.summary), sourceLocale };
}

/**
 * 1 ユーザーの bio / shortBio の訳文を返す。訳文を使えないときは null（原文を表示する）。
 * ローダーが既に読んでいる**現在の原文**とオプトアウト状態を渡す。
 */
export async function getUserBioTranslation(
  db: Database,
  user: UserBioSource & { id: string; allowAutoTranslation: boolean; profileVisibility: string | null },
  viewerLocale: Locale,
): Promise<TranslatedBio | null> {
  // 非公開プロフィールの bio は翻訳しない（残存行があっても返さない）
  if (!isTranslationEnabled() || !user.allowAutoTranslation || user.profileVisibility === "private") return null;
  const [row] = await selectReadyRows(db, "userBio", [user.id], viewerLocale, true);
  return row ? toTranslatedBio(row, user, viewerLocale) : null;
}

/**
 * 複数ユーザーの bio / shortBio の訳文をまとめて引く（一覧用・N+1 にしない）。
 * 訳文のある行だけ現在の原文を読み直して照合する（原文を持っていない一覧でも使える）。
 * オプトアウト中・非公開プロフィールのユーザーは返さない。
 * @returns userId → 訳文（訳文を使えないユーザーはキーに含まれない）
 */
export async function getUserBioTranslations(
  db: Database,
  userIds: string[],
  viewerLocale: Locale,
): Promise<Map<string, TranslatedBio>> {
  const result = new Map<string, TranslatedBio>();
  if (!isTranslationEnabled() || userIds.length === 0) return result;

  const rows = await selectReadyRows(db, "userBio", [...new Set(userIds)], viewerLocale, true);
  if (rows.length === 0) return result;

  const sources = await db
    .select({ id: users.id, bio: users.bio, shortBio: users.shortBio })
    .from(users)
    .where(
      and(
        inArray(
          users.id,
          rows.map((r) => r.targetId),
        ),
        eq(users.allowAutoTranslation, true),
        ne(users.profileVisibility, "private"),
      ),
    );
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  for (const row of rows) {
    const source = sourceById.get(row.targetId);
    if (!source) continue;
    const translated = toTranslatedBio(row, source, viewerLocale);
    if (translated) result.set(row.targetId, translated);
  }
  return result;
}

function toTranslatedGuide(
  row: ReadyRow,
  guide: GuideSource,
  viewerLocale: Locale,
): TranslatedGuideSummary | null {
  if (row.sourceHash !== sourceHash(guideSourceTexts(guide))) return null;
  const sourceLocale = guideSourceLocale(guide);
  if (sourceLocale === viewerLocale) return null;
  // title は原文に必ずあるので、訳文が空なら使わない（壊れた行を表示しない）
  if (!row.title) return null;
  return { title: row.title, summary: nullIfEmpty(row.summary), sourceLocale };
}

/**
 * 1 ガイドの訳文を返す。訳文を使えないときは null（原文を表示する）。
 * ローダーが既に読んでいる**公開版**の現在の原文を渡す。ドラフトのプレビュー（?draft=1）では呼ばないこと
 * （ドラフトは翻訳しないため、公開版の訳文を重ねると食い違う）。未公開ガイドの訳文は返さない。
 */
export async function getGuideTranslation(
  db: Database,
  guide: GuideSource & { id: string; isPublished: boolean; allowAutoTranslation: boolean },
  viewerLocale: Locale,
): Promise<TranslatedGuide | null> {
  if (!isTranslationEnabled() || !guide.isPublished || !guide.allowAutoTranslation) return null;
  const [row] = await selectReadyRows(db, "guide", [guide.id], viewerLocale, true);
  if (!row) return null;
  const base = toTranslatedGuide(row, guide, viewerLocale);
  if (!base || !row.content) return null;
  return { ...base, content: sanitizeGuideHtml(row.content) };
}

/**
 * 複数ガイドの title / summary の訳文をまとめて引く（一覧用・N+1 にしない）。
 * 一覧は本文を読んでいないので、訳文のある行についてだけ現在の原文（本文含む）を読み直して照合する。
 * 非公開・オプトアウト中のガイドは返さない。
 * @returns guideId → 訳文（訳文を使えないガイドはキーに含まれない）
 */
export async function getGuideTranslations(
  db: Database,
  guideIds: string[],
  viewerLocale: Locale,
): Promise<Map<string, TranslatedGuideSummary>> {
  const result = new Map<string, TranslatedGuideSummary>();
  if (!isTranslationEnabled() || guideIds.length === 0) return result;

  const rows = await selectReadyRows(db, "guide", [...new Set(guideIds)], viewerLocale, false);
  if (rows.length === 0) return result;

  const sources = await db
    .select({ id: guides.id, title: guides.title, summary: guides.summary, content: guides.content })
    .from(guides)
    .where(
      and(
        inArray(
          guides.id,
          rows.map((r) => r.targetId),
        ),
        eq(guides.isPublished, true),
        eq(guides.allowAutoTranslation, true),
      ),
    );
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  for (const row of rows) {
    const source = sourceById.get(row.targetId);
    if (!source) continue;
    const translated = toTranslatedGuide(row, source, viewerLocale);
    if (translated) result.set(row.targetId, translated);
  }
  return result;
}

// ============================================
// オプトアウト時の削除
// ============================================

/** 自動翻訳をオフにしたとき（users.allowAutoTranslation = false）に呼ぶ。bio の翻訳行を全ロケール削除する */
export async function removeUserBioTranslations(db: Database, userId: string): Promise<void> {
  await deleteTranslationsForUser(db, userId, []);
}

/** 自動翻訳をオフにしたとき（guides.allowAutoTranslation = false）に呼ぶ。ガイドの翻訳行を全ロケール削除する */
export async function removeGuideTranslations(db: Database, guideId: string): Promise<void> {
  await deleteTranslationsForGuide(db, guideId);
}

// ============================================
// 書き込み（翻訳の実行）
// ============================================

export type TranslateOutcome =
  /** 翻訳を実行して保存した */
  | "translated"
  /** 既に最新の訳文がある（何もしなかった） */
  | "upToDate"
  /** 翻訳に失敗した（行は failed。表示は原文のまま） */
  | "failed"
  /** 対象外（機能無効・対象なし・未公開など）。何も書いていない */
  | "skipped"
  /** オプトアウト済み、または原文が空なので翻訳行を削除した */
  | "removed";

export interface TranslateRunOptions {
  /** テスト用に翻訳関数を差し替える（既定は translateTexts） */
  translate?: typeof translateTexts;
}

/** 1 リクエストに載せる文字数（本文を分割する単位）。出力トークン上限に余裕を持たせるため MAX_INPUT_CHARS より小さい */
const CHUNK_CHARS = Math.min(8000, MAX_INPUT_CHARS);

const BIO_CONTEXT =
  "a user's profile on a speedrunning portfolio site: element 0 is the self-introduction (Markdown; keep the Markdown syntax and leave the contents of code fences untouched), element 1 is a short tagline (plain text, max 50 characters)";
const GUIDE_CONTEXT =
  "a speedrunning guide article: element 0 is the title, element 1 is the summary, the rest are text fragments of the article body in document order";

interface ChunkedResult {
  texts: string[];
  model: string;
}

/** 配列を上限内のチャンクに分けて順に翻訳する。1 チャンクでも失敗したら全体を null（失敗）にする */
async function translateChunked(
  texts: string[],
  from: Locale,
  to: Locale,
  context: string,
  translate: typeof translateTexts,
): Promise<ChunkedResult | null> {
  const out: string[] = [];
  const models = new Set<string>();
  for (const [start, end] of chunkTexts(texts, CHUNK_CHARS)) {
    const result = await translate(texts.slice(start, end), { from, to, context });
    if (!result) return null;
    out.push(...result.texts);
    models.add(result.model);
  }
  if (out.length !== texts.length) return null;
  return { texts: out, model: [...models].join(",") };
}

interface TranslatedValues {
  title: string | null;
  summary: string | null;
  content: string | null;
}

interface TranslateTargetArgs {
  targetType: "userBio" | "guide";
  targetId: string;
  to: Locale;
  from: Locale;
  hash: string;
  /** 原文の最終更新時刻。既存の最新訳文より新しければ updatedAt だけ更新する（Cron の再検出を止める） */
  sourceUpdatedAt: Date;
  texts: string[];
  context: string;
  /** 翻訳済み配列 → 保存する列。失敗したら例外 */
  build: (translated: string[]) => TranslatedValues;
  /**
   * 書き込み直前の再確認。DB を読み直し、原文が書き換わっていない・自動翻訳の許可が true のまま・
   * bio なら非公開でない／ガイドなら公開中、のすべてを満たすときだけ true。false なら結果を捨てる
   * （API 応答待ちの間にオフ・非公開化されて削除済みの訳文行を復活させないため）
   */
  canWriteResult: () => Promise<boolean>;
  translate: typeof translateTexts;
}

async function upsertTranslation(
  db: Database,
  args: Pick<TranslateTargetArgs, "targetType" | "targetId" | "to" | "hash">,
  values: Partial<typeof contentTranslations.$inferInsert> & { status: "pending" | "ready" | "failed" },
): Promise<void> {
  const now = new Date();
  const set = { sourceHash: args.hash, glossaryVersion: GLOSSARY_VERSION, updatedAt: now, ...values };
  await db
    .insert(contentTranslations)
    .values({
      targetType: args.targetType,
      targetId: args.targetId,
      locale: args.to,
      createdAt: now,
      ...set,
    })
    .onConflictDoUpdate({
      target: [contentTranslations.targetType, contentTranslations.targetId, contentTranslations.locale],
      set,
    });
}

/** 1 つの翻訳先ロケールについて「最新なら何もしない／なければ翻訳して保存」を行う */
async function translateIntoLocale(
  db: Database,
  args: TranslateTargetArgs,
): Promise<"translated" | "upToDate" | "failed"> {
  const [existing] = await db
    .select({
      sourceHash: contentTranslations.sourceHash,
      glossaryVersion: contentTranslations.glossaryVersion,
      status: contentTranslations.status,
      updatedAt: contentTranslations.updatedAt,
    })
    .from(contentTranslations)
    .where(
      and(
        eq(contentTranslations.targetType, args.targetType),
        eq(contentTranslations.targetId, args.targetId),
        eq(contentTranslations.locale, args.to),
      ),
    );

  if (
    existing &&
    existing.status === "ready" &&
    existing.sourceHash === args.hash &&
    existing.glossaryVersion === GLOSSARY_VERSION
  ) {
    if (existing.updatedAt < args.sourceUpdatedAt) {
      // 原文の更新時刻は進んだが内容は同じ（無関係な列の更新）。Cron に再検出させないよう時刻だけ進める
      await db
        .update(contentTranslations)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(contentTranslations.targetType, args.targetType),
            eq(contentTranslations.targetId, args.targetId),
            eq(contentTranslations.locale, args.to),
          ),
        );
    }
    return "upToDate";
  }

  await upsertTranslation(db, args, {
    status: "pending",
    title: null,
    summary: null,
    content: null,
    engine: null,
    model: null,
    error: null,
  });

  let failure: string | null = null;
  let values: TranslatedValues | null = null;
  let model: string | null = null;
  try {
    const result = await translateChunked(args.texts, args.from, args.to, args.context, args.translate);
    if (!result) {
      failure = "translation failed (API error, mismatched response, or input too large)";
    } else {
      values = args.build(result.texts);
      model = result.model;
    }
  } catch (error) {
    failure = `translation failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  // 翻訳中に原文が編集された／許可がオフにされた／非公開化された場合は結果を捨てる（新しい原文の翻訳は
  // 別の呼び出し／Cron が担う。オフ・非公開化の時点で訳文行は削除済みなので、ここで書くと復活してしまう）。
  // チェックと書き込みの間の極小の競合は Cron の掃除（processPendingTranslations）が拾う
  if (!(await args.canWriteResult())) return "failed";

  if (failure !== null || values === null) {
    console.error(`[content-translation] ${args.targetType}:${args.targetId} -> ${args.to}: ${failure}`);
    await upsertTranslation(db, args, { status: "failed", error: failure ?? "unknown error" });
    return "failed";
  }

  await upsertTranslation(db, args, {
    status: "ready",
    title: values.title,
    summary: values.summary,
    content: values.content,
    engine: TRANSLATION_ENGINE,
    model,
    error: null,
  });
  return "translated";
}

/** 翻訳先ロケールごとの結果を 1 つにまとめる */
function summarize(outcomes: Array<"translated" | "upToDate" | "failed">): TranslateOutcome {
  if (outcomes.includes("failed")) return "failed";
  if (outcomes.includes("translated")) return "translated";
  return "upToDate";
}

/** 原文ロケールと同じロケールの行など、翻訳先でなくなったロケールの行を消す */
async function deleteRowsOutsideLocales(
  db: Database,
  targetType: "userBio" | "guide",
  targetId: string,
  keep: Locale[],
): Promise<void> {
  const all = SUPPORTED_LOCALES.filter((l) => !keep.includes(l));
  if (all.length === 0) return;
  await db
    .delete(contentTranslations)
    .where(
      and(
        eq(contentTranslations.targetType, targetType),
        eq(contentTranslations.targetId, targetId),
        inArray(contentTranslations.locale, all),
      ),
    );
}

/**
 * ユーザーの bio / shortBio を翻訳して保存する。
 * - 機能無効なら何もしない（"skipped"）。オプトアウト済み／**非公開プロフィール（profileVisibility = "private"）**／
 *   bio も shortBio も空なら API を呼ばず翻訳行を削除する（"removed"）。限定公開（unlisted）は対象
 * - 既に最新の訳文があれば API を呼ばない（"upToDate"）
 * - 失敗しても例外は投げない（"failed"。行は failed で、表示は原文のまま）
 */
export async function translateUserBio(
  db: Database,
  userId: string,
  options: TranslateRunOptions = {},
): Promise<TranslateOutcome> {
  const translate = options.translate ?? translateTexts;
  if (!options.translate && !isTranslationEnabled()) return "skipped";

  const load = () =>
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        id: true,
        bio: true,
        shortBio: true,
        allowAutoTranslation: true,
        profileVisibility: true,
        updatedAt: true,
      },
    });
  const user = await load();
  if (!user) return "skipped";

  // 非公開プロフィールの bio は表示されないので翻訳に送らない（Cron も除外しており、経路で扱いを揃える）
  if (!user.allowAutoTranslation || user.profileVisibility === "private" || isBioBlank(user)) {
    await removeUserBioTranslations(db, userId);
    return "removed";
  }

  const texts = userBioSourceTexts(user);
  const hash = sourceHash(texts);
  const from = userBioSourceLocale(user);
  const targets = translationTargetLocales(from);
  await deleteRowsOutsideLocales(db, "userBio", userId, targets);

  const outcomes: Array<"translated" | "upToDate" | "failed"> = [];
  for (const to of targets) {
    outcomes.push(
      await translateIntoLocale(db, {
        targetType: "userBio",
        targetId: userId,
        to,
        from,
        hash,
        sourceUpdatedAt: user.updatedAt,
        texts,
        context: BIO_CONTEXT,
        build: ([bio, shortBio]) => ({
          title: null,
          summary: user.shortBio ? shortBio : null,
          content: user.bio ? bio : null,
        }),
        canWriteResult: async () => {
          const latest = await load();
          return (
            !!latest &&
            latest.allowAutoTranslation &&
            latest.profileVisibility !== "private" &&
            sourceHash(userBioSourceTexts(latest)) === hash
          );
        },
        translate,
      }),
    );
  }
  return summarize(outcomes);
}

/**
 * ガイドの公開版（title / summary / 本文 HTML）を翻訳して保存する。
 * - 機能無効なら何もしない（"skipped"）。**未公開（ドラフト）は翻訳しない**（"skipped"）
 * - オプトアウト済みなら翻訳行を削除する（"removed"）
 * - 本文はテキストノードだけを抽出して往復し（guide-translate-html.server.ts）、書き戻した HTML を
 *   sanitizeGuideHtml() に通して保存する。上限超過に備えてチャンク分割し、1 チャンクでも失敗したら全体を failed にする
 * - 既に最新の訳文があれば API を呼ばない（"upToDate"）。失敗しても例外は投げない（"failed"）
 */
export async function translateGuide(
  db: Database,
  guideId: string,
  options: TranslateRunOptions = {},
): Promise<TranslateOutcome> {
  const translate = options.translate ?? translateTexts;
  if (!options.translate && !isTranslationEnabled()) return "skipped";

  const load = () =>
    db.query.guides.findFirst({
      where: eq(guides.id, guideId),
      columns: {
        id: true,
        title: true,
        summary: true,
        content: true,
        isPublished: true,
        allowAutoTranslation: true,
        updatedAt: true,
      },
    });
  const guide = await load();
  if (!guide) return "skipped";

  if (!guide.allowAutoTranslation) {
    await removeGuideTranslations(db, guideId);
    return "removed";
  }
  if (!guide.isPublished) return "skipped";

  const hash = sourceHash(guideSourceTexts(guide));
  const from = guideSourceLocale(guide);
  const targets = translationTargetLocales(from);
  await deleteRowsOutsideLocales(db, "guide", guideId, targets);

  // [title, summary, ...本文のテキストノード]。往復後に本文へ書き戻す
  const extracted = extractGuideHtmlTexts(guide.content);
  const texts = [guide.title, guide.summary ?? "", ...extracted.texts];

  const outcomes: Array<"translated" | "upToDate" | "failed"> = [];
  for (const to of targets) {
    outcomes.push(
      await translateIntoLocale(db, {
        targetType: "guide",
        targetId: guideId,
        to,
        from,
        hash,
        sourceUpdatedAt: guide.updatedAt,
        texts,
        context: GUIDE_CONTEXT,
        build: (translated) => ({
          title: translated[0],
          summary: guide.summary ? translated[1] : null,
          content: sanitizeGuideHtml(extracted.apply(translated.slice(2))),
        }),
        canWriteResult: async () => {
          const latest = await load();
          return (
            !!latest &&
            latest.allowAutoTranslation &&
            latest.isPublished &&
            sourceHash(guideSourceTexts(latest)) === hash
          );
        },
        translate,
      }),
    );
  }
  return summarize(outcomes);
}

// ============================================
// 公開・保存後のスケジュール
// ============================================

export type TranslationTarget = { type: "userBio" | "guide"; id: string };

/**
 * レスポンスを返した後に翻訳を走らせる。action の末尾（保存・公開が成功したあと）で呼ぶ。
 * Vercel では `waitUntil()` でリクエストのライフタイムを延長する（`void translate()` は
 * serverless ではレスポンス後に打ち切られる）。Vercel 外（ローカル）では waitUntil が
 * 何もしないだけで、起動済みの Promise がそのまま完了まで走る。
 *
 * 機能無効（ANTHROPIC_API_KEY 未設定）なら何もしない。絶対に throw しない・await 不要。
 */
export function scheduleTranslation(db: Database, target: TranslationTarget): void {
  if (!isTranslationEnabled()) return;
  const task = (target.type === "guide" ? translateGuide(db, target.id) : translateUserBio(db, target.id)).catch(
    (error) => {
      console.error(`[content-translation] background translation failed (${target.type}:${target.id}):`, error);
    },
  );
  try {
    waitUntil(task);
  } catch (error) {
    console.error("[content-translation] waitUntil call failed:", error);
  }
}

export function scheduleUserBioTranslation(db: Database, userId: string): void {
  scheduleTranslation(db, { type: "userBio", id: userId });
}

export function scheduleGuideTranslation(db: Database, guideId: string): void {
  scheduleTranslation(db, { type: "guide", id: guideId });
}

// ============================================
// Cron: 取りこぼしの掃除
// ============================================

/** pending のまま止まっている行を再試行するまでの猶予（実行中の翻訳と衝突しないため） */
export const PENDING_RETRY_MS = 10 * 60 * 1000;
/** failed の行を再試行するまでの間隔（失敗し続ける対象で API を叩き潰さないため） */
export const FAILED_RETRY_MS = 6 * 60 * 60 * 1000;
/** 1 回の Cron が処理する対象数の既定上限 */
export const DEFAULT_CRON_LIMIT = 10;

export interface ProcessTranslationsOptions {
  /** 処理する対象（ガイド 1 本・bio 1 人 = 1）の上限。既定 DEFAULT_CRON_LIMIT */
  limit?: number;
  /** この時間（ms）を超えたら新しい対象に着手しない（関数のタイムアウト対策）。未指定なら無制限 */
  timeBudgetMs?: number;
  /** テスト用 */
  now?: Date;
  translate?: typeof translateTexts;
}

export interface ProcessTranslationsResult {
  /** 着手した対象数 */
  processed: number;
  translated: number;
  upToDate: number;
  failed: number;
  skipped: number;
  removed: number;
}

/**
 * 取りこぼしの翻訳を掃除する（Cron 用）。同期処理で、`limit` 件の対象まで順に翻訳する。
 *
 * 対象（優先順）:
 *   0. 掃除: 翻訳が許されなくなった対象（自動翻訳オフ・非公開プロフィールの bio・未公開ガイド）に残っている
 *      訳文行を削除する（API は呼ばない）。翻訳中のオフ操作との極小の競合や、非公開化・非公開への戻しで
 *      取りこぼした行を拾う。1 対象 = 1 件として `processed` / `removed` に数え、上限（limit）を共有する
 *   1. 再試行すべき行: pending（10 分以上経過）／failed（6 時間以上経過）／ready だが用語集バージョン不一致
 *   2. 原文が更新された可能性のある ready 行（原文の updatedAt > 翻訳行の updatedAt。ハッシュ照合は翻訳関数側）
 *   3. 翻訳行がまだ無い翻訳対象（公開ガイド・空でない bio。非公開プロフィールの bio は除く）
 * いずれも公開済みかつオプトアウトでないものに限る。全件走査はせず、各段階を `limit` 件で打ち切る。
 * 機能無効なら何もしない。
 */
export async function processPendingTranslations(
  db: Database,
  options: ProcessTranslationsOptions = {},
): Promise<ProcessTranslationsResult> {
  const result: ProcessTranslationsResult = {
    processed: 0,
    translated: 0,
    upToDate: 0,
    failed: 0,
    skipped: 0,
    removed: 0,
  };
  if (!options.translate && !isTranslationEnabled()) return result;

  const limit = Math.max(0, options.limit ?? DEFAULT_CRON_LIMIT);
  const now = options.now ?? new Date();
  const pendingCutoff = new Date(now.getTime() - PENDING_RETRY_MS);
  const failedCutoff = new Date(now.getTime() - FAILED_RETRY_MS);

  const startedAt = Date.now();
  const guideIds = new Set<string>();
  const userIds = new Set<string>();
  let swept = 0;
  const remaining = () => limit - guideIds.size - userIds.size - swept;

  const retryable = or(
    and(eq(contentTranslations.status, "pending"), lt(contentTranslations.updatedAt, pendingCutoff)),
    and(eq(contentTranslations.status, "failed"), lt(contentTranslations.updatedAt, failedCutoff)),
    and(eq(contentTranslations.status, "ready"), ne(contentTranslations.glossaryVersion, GLOSSARY_VERSION)),
  );
  const guideTarget = and(eq(guides.isPublished, true), eq(guides.allowAutoTranslation, true));
  const userTarget = and(eq(users.allowAutoTranslation, true), ne(users.profileVisibility, "private"));

  // 0. 翻訳が許されなくなった対象に残っている訳文行を掃除する（削除のみ・API 不使用）
  if (remaining() > 0 && !(options.timeBudgetMs !== undefined && Date.now() - startedAt >= options.timeBudgetMs)) {
    const staleGuides = await db
      .selectDistinct({ id: guides.id })
      .from(contentTranslations)
      .innerJoin(guides, eq(guides.id, contentTranslations.targetId))
      .where(
        and(
          eq(contentTranslations.targetType, "guide"),
          or(eq(guides.allowAutoTranslation, false), eq(guides.isPublished, false)),
        ),
      )
      .limit(remaining());
    if (staleGuides.length > 0) {
      await db.delete(contentTranslations).where(
        and(
          eq(contentTranslations.targetType, "guide"),
          inArray(
            contentTranslations.targetId,
            staleGuides.map((r) => r.id),
          ),
        ),
      );
      swept += staleGuides.length;
    }
  }
  if (remaining() > 0 && !(options.timeBudgetMs !== undefined && Date.now() - startedAt >= options.timeBudgetMs)) {
    const staleUsers = await db
      .selectDistinct({ id: users.id })
      .from(contentTranslations)
      .innerJoin(users, eq(users.id, contentTranslations.targetId))
      .where(
        and(
          eq(contentTranslations.targetType, "userBio"),
          or(eq(users.allowAutoTranslation, false), eq(users.profileVisibility, "private")),
        ),
      )
      .limit(remaining());
    if (staleUsers.length > 0) {
      await db.delete(contentTranslations).where(
        and(
          eq(contentTranslations.targetType, "userBio"),
          inArray(
            contentTranslations.targetId,
            staleUsers.map((r) => r.id),
          ),
        ),
      );
      swept += staleUsers.length;
    }
  }
  result.processed += swept;
  result.removed += swept;

  // 1. 再試行すべき行
  if (remaining() > 0) {
    const rows = await db
      .selectDistinct({ id: guides.id })
      .from(contentTranslations)
      .innerJoin(guides, eq(guides.id, contentTranslations.targetId))
      .where(and(eq(contentTranslations.targetType, "guide"), guideTarget, retryable))
      .limit(remaining());
    rows.forEach((r) => guideIds.add(r.id));
  }
  if (remaining() > 0) {
    const rows = await db
      .selectDistinct({ id: users.id })
      .from(contentTranslations)
      .innerJoin(users, eq(users.id, contentTranslations.targetId))
      .where(and(eq(contentTranslations.targetType, "userBio"), userTarget, retryable))
      .limit(remaining());
    rows.forEach((r) => userIds.add(r.id));
  }

  // 2. 原文が更新された可能性のある ready 行
  if (remaining() > 0) {
    const rows = await db
      .selectDistinct({ id: guides.id })
      .from(contentTranslations)
      .innerJoin(guides, eq(guides.id, contentTranslations.targetId))
      .where(
        and(
          eq(contentTranslations.targetType, "guide"),
          guideTarget,
          eq(contentTranslations.status, "ready"),
          gt(guides.updatedAt, contentTranslations.updatedAt),
        ),
      )
      .limit(remaining());
    rows.forEach((r) => guideIds.add(r.id));
  }
  if (remaining() > 0) {
    const rows = await db
      .selectDistinct({ id: users.id })
      .from(contentTranslations)
      .innerJoin(users, eq(users.id, contentTranslations.targetId))
      .where(
        and(
          eq(contentTranslations.targetType, "userBio"),
          userTarget,
          eq(contentTranslations.status, "ready"),
          gt(users.updatedAt, contentTranslations.updatedAt),
        ),
      )
      .limit(remaining());
    rows.forEach((r) => userIds.add(r.id));
  }

  // 3. 翻訳行がまだ無い対象
  if (remaining() > 0) {
    const rows = await db
      .select({ id: guides.id })
      .from(guides)
      .where(
        and(
          guideTarget,
          notExists(
            db
              .select({ one: sql`1` })
              .from(contentTranslations)
              .where(and(eq(contentTranslations.targetType, "guide"), eq(contentTranslations.targetId, guides.id))),
          ),
        ),
      )
      .orderBy(asc(guides.updatedAt))
      .limit(remaining());
    rows.forEach((r) => guideIds.add(r.id));
  }
  if (remaining() > 0) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          userTarget,
          or(
            sql`trim(coalesce(${users.bio}, '')) <> ''`,
            sql`trim(coalesce(${users.shortBio}, '')) <> ''`,
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(contentTranslations)
              .where(and(eq(contentTranslations.targetType, "userBio"), eq(contentTranslations.targetId, users.id))),
          ),
        ),
      )
      .orderBy(asc(users.updatedAt))
      .limit(remaining());
    rows.forEach((r) => userIds.add(r.id));
  }

  const queue: Array<() => Promise<TranslateOutcome>> = [
    ...[...guideIds].map((id) => () => translateGuide(db, id, { translate: options.translate })),
    ...[...userIds].map((id) => () => translateUserBio(db, id, { translate: options.translate })),
  ];
  for (const run of queue) {
    if (options.timeBudgetMs !== undefined && Date.now() - startedAt >= options.timeBudgetMs) break;
    let outcome: TranslateOutcome;
    try {
      outcome = await run();
    } catch (error) {
      console.error("[content-translation] cron item failed:", error);
      outcome = "failed";
    }
    result.processed++;
    result[outcome]++;
  }
  return result;
}
