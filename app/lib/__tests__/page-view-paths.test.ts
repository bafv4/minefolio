// Vercel Web Analytics の requestPath 解釈（parseAnalyticsPath）の検証。
//
// ここが緩いと集計が別ページへ混ざり（例: /player/:slug/stats をプロフィール本体として数える）、
// 逆に厳しすぎると実際に踏まれた URL（クエリ付き・末尾スラッシュ・エンコード済み）を
// 取りこぼして「人気順が常に 0」になる。どちらも SQL エラーにならず表に出ないため、
// 分岐ごとに期待値を固定しておく。
import { describe, it, expect } from "vitest";
import { parseAnalyticsPath } from "../page-view-paths";

describe("parseAnalyticsPath - プロフィール", () => {
  it("/player/:slug をプロフィールとして解釈し、slug は小文字化する", () => {
    expect(parseAnalyticsPath("/player/Abc")).toEqual({ type: "profile", slugLower: "abc" });
    expect(parseAnalyticsPath("/player/abc")).toEqual({ type: "profile", slugLower: "abc" });
  });

  it("下層ページ（3 セグメント）は対象外", () => {
    expect(parseAnalyticsPath("/player/abc/stats")).toBeNull();
    expect(parseAnalyticsPath("/player/abc/keybindings")).toBeNull();
  });

  it("slug の無い /player 単体は対象外", () => {
    expect(parseAnalyticsPath("/player")).toBeNull();
    expect(parseAnalyticsPath("/player/")).toBeNull();
  });
});

describe("parseAnalyticsPath - ガイド", () => {
  it("/guides/:authorSlug/:guideSlug をガイドとして解釈する（著者 slug のみ小文字化）", () => {
    expect(parseAnalyticsPath("/guides/Author/My-Guide")).toEqual({
      type: "guide",
      authorSlugLower: "author",
      guideSlug: "My-Guide",
    });
  });

  it("ガイド slug は原文のまま保持する（DB とは完全一致で引くため）", () => {
    const parsed = parseAnalyticsPath("/guides/author/AbC-DeF");
    expect(parsed).toEqual({
      type: "guide",
      authorSlugLower: "author",
      guideSlug: "AbC-DeF",
    });
  });

  it("著者別一覧（2 セグメント）とガイド一覧は対象外", () => {
    expect(parseAnalyticsPath("/guides/author")).toBeNull();
    expect(parseAnalyticsPath("/guides")).toBeNull();
  });

  it("テンプレート個別ページ（/guides/templates/:id）はガイドではない", () => {
    expect(parseAnalyticsPath("/guides/templates/abc123")).toBeNull();
  });

  it("4 セグメント以上は対象外", () => {
    expect(parseAnalyticsPath("/guides/author/my-guide/edit")).toBeNull();
  });
});

describe("parseAnalyticsPath - URL の揺れの吸収", () => {
  it("クエリ文字列を除去して解釈する", () => {
    expect(parseAnalyticsPath("/player/abc?ref=1")).toEqual({
      type: "profile",
      slugLower: "abc",
    });
    expect(parseAnalyticsPath("/guides/author/my-guide?utm_source=x&utm_medium=y")).toEqual({
      type: "guide",
      authorSlugLower: "author",
      guideSlug: "my-guide",
    });
  });

  it("フラグメントを除去して解釈する", () => {
    expect(parseAnalyticsPath("/player/abc#top")).toEqual({ type: "profile", slugLower: "abc" });
    expect(parseAnalyticsPath("/player/abc?ref=1#top")).toEqual({
      type: "profile",
      slugLower: "abc",
    });
  });

  it("末尾スラッシュを除去して解釈する", () => {
    expect(parseAnalyticsPath("/player/abc/")).toEqual({ type: "profile", slugLower: "abc" });
    expect(parseAnalyticsPath("/guides/author/my-guide/")).toEqual({
      type: "guide",
      authorSlugLower: "author",
      guideSlug: "my-guide",
    });
  });

  it("パーセントエンコードをデコードして解釈する", () => {
    expect(parseAnalyticsPath("/player/%41bc")).toEqual({ type: "profile", slugLower: "abc" });
    // 日本語スラッグはブラウザから常にエンコード済みで届く
    expect(parseAnalyticsPath("/guides/author/%E3%81%82")).toEqual({
      type: "guide",
      authorSlugLower: "author",
      guideSlug: "あ",
    });
  });

  it("壊れたパーセントエンコードは復元できないので対象外", () => {
    expect(parseAnalyticsPath("/player/%zz")).toBeNull();
    expect(parseAnalyticsPath("/guides/author/%E3%81")).toBeNull();
  });
});

describe("parseAnalyticsPath - 対象外の入力", () => {
  it("集約行 Others のように / で始まらない行は対象外", () => {
    expect(parseAnalyticsPath("Others")).toBeNull();
    expect(parseAnalyticsPath("player/abc")).toBeNull();
  });

  it("空文字・ルートは対象外", () => {
    expect(parseAnalyticsPath("")).toBeNull();
    expect(parseAnalyticsPath("/")).toBeNull();
  });

  it("空セグメントを含むパスは正規形でないので対象外", () => {
    expect(parseAnalyticsPath("/player//")).toBeNull();
    expect(parseAnalyticsPath("/player//abc")).toBeNull();
    expect(parseAnalyticsPath("/guides//my-guide")).toBeNull();
  });

  it("プロフィール・ガイド以外のページは対象外", () => {
    expect(parseAnalyticsPath("/browse")).toBeNull();
    expect(parseAnalyticsPath("/rankings/any")).toBeNull();
  });

  it("文字列でない値を渡されても落ちない（API 応答の型は保証されない）", () => {
    expect(parseAnalyticsPath(null as unknown as string)).toBeNull();
    expect(parseAnalyticsPath(undefined as unknown as string)).toBeNull();
    expect(parseAnalyticsPath(42 as unknown as string)).toBeNull();
  });
});
