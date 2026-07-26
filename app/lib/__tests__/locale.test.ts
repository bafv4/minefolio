// ロケール決定と文言フォールバックの検証。
//
// ここが誤ると「英語利用者に日本語が出る」「日本語利用者が勝手に英語になる」という
// 全ページに波及する不具合になるため、判定の分岐を実値で押さえる。
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCALE,
  isLocale,
  localeCookieValue,
  localeFromMatches,
  parseAcceptLanguage,
  parseLocaleCookie,
  resolveLocale,
} from "../locale";
import { t, PAGES_JA, PAGES_EN } from "../messages";

/** ネストしたメッセージ定義を "a.b.c" のドットパス一覧へ潰す */
function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : flattenKeys(value, path);
  });
}

function request(headers: Record<string, string>): Request {
  return new Request("https://minefolio.app/", { headers });
}

describe("isLocale", () => {
  it("対応ロケールだけを受け入れる", () => {
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe("parseLocaleCookie", () => {
  it("Cookie から選択済みロケールを取り出す", () => {
    expect(parseLocaleCookie("minefolio_locale=en")).toBe("en");
    expect(parseLocaleCookie("theme=dark; minefolio_locale=ja; other=1")).toBe("ja");
  });

  it("名前が部分一致する別 Cookie を拾わない", () => {
    // 旧実装は /minefolio_locale=([^;]+)/ で照合していたため、これを en と誤読していた
    expect(parseLocaleCookie("xxxminefolio_locale=en")).toBeNull();
    expect(parseLocaleCookie("my_minefolio_locale=en; theme=dark")).toBeNull();
  });

  it("未対応の値・欠損は null", () => {
    expect(parseLocaleCookie("minefolio_locale=fr")).toBeNull();
    expect(parseLocaleCookie("theme=dark")).toBeNull();
    expect(parseLocaleCookie(null)).toBeNull();
  });
});

describe("parseAcceptLanguage", () => {
  it("q 値の高い言語を優先する", () => {
    // 旧実装は includes("ja") で見ていたため、英語優先でも日本語と判定していた
    expect(parseAcceptLanguage("en-US,en;q=0.9,ja;q=0.5")).toBe("en");
    expect(parseAcceptLanguage("ja-JP,ja;q=0.9,en;q=0.5")).toBe("ja");
  });

  it("地域つきタグを主部分で判定する", () => {
    expect(parseAcceptLanguage("en-GB")).toBe("en");
    expect(parseAcceptLanguage("ja-JP")).toBe("ja");
  });

  it("q 値が同じなら記述順を優先する", () => {
    expect(parseAcceptLanguage("en,ja")).toBe("en");
    expect(parseAcceptLanguage("ja,en")).toBe("ja");
  });

  it("q=0 の言語は選ばない", () => {
    expect(parseAcceptLanguage("ja;q=0,en;q=0.5")).toBe("en");
  });

  it("未対応言語しか無ければ null", () => {
    expect(parseAcceptLanguage("fr-FR,de;q=0.8")).toBeNull();
    expect(parseAcceptLanguage("")).toBeNull();
    expect(parseAcceptLanguage(null)).toBeNull();
  });

  it("ワイルドカードは既定にする", () => {
    expect(parseAcceptLanguage("*")).toBe(DEFAULT_LOCALE);
  });
});

describe("resolveLocale", () => {
  it("Cookie が Accept-Language より優先される（利用者の明示的な選択）", () => {
    expect(
      resolveLocale(
        request({ Cookie: "minefolio_locale=ja", "Accept-Language": "en-US,en;q=0.9" }),
      ),
    ).toBe("ja");
    expect(
      resolveLocale(
        request({ Cookie: "minefolio_locale=en", "Accept-Language": "ja-JP,ja;q=0.9" }),
      ),
    ).toBe("en");
  });

  it("Cookie が無ければ Accept-Language を見る", () => {
    expect(resolveLocale(request({ "Accept-Language": "en-US,en;q=0.9" }))).toBe("en");
  });

  it("どちらも無ければ既定（日本語）", () => {
    expect(resolveLocale(request({}))).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(request({ "Accept-Language": "fr-FR" }))).toBe(DEFAULT_LOCALE);
  });
});

describe("localeCookieValue", () => {
  it("パス全体・1年有効の Cookie を作る", () => {
    const value = localeCookieValue("en");
    expect(value).toContain("minefolio_locale=en");
    expect(value).toContain("Path=/");
    expect(value).toContain("SameSite=Lax");
  });
});

describe("localeFromMatches", () => {
  it("root ローダーの locale を取り出す（型付き meta の loaderData）", () => {
    expect(localeFromMatches([{ id: "root", loaderData: { locale: "en" } }])).toBe("en");
  });

  it("素の MetaFunction の data 形式にも対応する", () => {
    expect(localeFromMatches([{ id: "root", data: { locale: "en" } }])).toBe("en");
  });

  it("未解決の match が混ざっていても落ちない", () => {
    expect(
      localeFromMatches([undefined, { id: "root", loaderData: { locale: "en" } }, undefined]),
    ).toBe("en");
  });

  it("root が無い・値が不正なら既定", () => {
    expect(localeFromMatches([{ id: "routes/home", loaderData: {} }])).toBe(DEFAULT_LOCALE);
    expect(localeFromMatches([{ id: "root", loaderData: { locale: "fr" } }])).toBe(DEFAULT_LOCALE);
    expect(localeFromMatches(undefined)).toBe(DEFAULT_LOCALE);
  });
});

// 日本語が全キーの基準。英語は現在すべて揃っているが、新しい文言は
// 日本語だけ先に足されることがあるため、フォールバック機構も生かしておく。
describe("t（ロケールとフォールバック）", () => {
  it("英語訳があれば英語を返す", () => {
    expect(t("nav.browse", undefined, "en")).toBe("Browse");
    expect(t("nav.browse", undefined, "ja")).toBe("探す");
  });

  it("英語訳が無いキーは日本語へフォールバックする（キー名を出さない）", () => {
    // 実データは全訳済みなので、機構そのものを確かめるために一時的に欠落させる
    const nav = PAGES_EN.nav as Record<string, string>;
    const saved = nav.browse;
    delete nav.browse;
    try {
      const value = t("nav.browse", undefined, "en");
      expect(value).toBe("探す");
      expect(value).not.toBe("nav.browse");
    } finally {
      nav.browse = saved;
    }
  });

  it("空文字の訳を「未翻訳」と誤判定しない", () => {
    // 日本語の助数詞「人」は英語では付けないため、意図的に空文字にしている
    expect(t("common.peopleUnit", undefined, "ja")).toBe("人");
    expect(t("common.peopleUnit", undefined, "en")).toBe("");
  });

  it("パラメータを補間する（英語・日本語とも）", () => {
    expect(t("likes.countAria", { count: 3 }, "en")).toBe("3 likes");
    expect(t("likes.countAria", { count: 3 }, "ja")).toBe("いいね3件");
  });

  it("locale 省略時は日本語", () => {
    expect(t("nav.browse")).toBe("探す");
  });

  it("存在しないキーはキー名を返す（開発時に気づけるように）", () => {
    // @ts-expect-error 型では弾かれるキーを実行時挙動として確認する
    expect(t("nope.missing", undefined, "en")).toBe("nope.missing");
  });
});

// 日本語だけにキーを足すとフォールバックで日本語が英語UIに混ざる。
// 型では検出できない（pages-en.ts は部分集合を許す型）ため、ここで数える。
describe("翻訳カバレッジ", () => {
  it("日本語の全キーに英語訳がある", () => {
    const jaKeys = flattenKeys(PAGES_JA);
    const enKeys = new Set(flattenKeys(PAGES_EN));
    const missing = jaKeys.filter((key) => !enKeys.has(key));

    expect(jaKeys.length).toBeGreaterThan(1000); // 走査対象が壊れていないことの確認
    expect(missing).toEqual([]);
  });

  it("日本語に存在しないキーが英語側に残っていない（キー名の打ち間違い・削除漏れ）", () => {
    const jaKeys = new Set(flattenKeys(PAGES_JA));
    const extra = flattenKeys(PAGES_EN).filter((key) => !jaKeys.has(key));

    expect(extra).toEqual([]);
  });
});
