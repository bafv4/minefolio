import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isTranslationEnabled,
  sourceHash,
  translateTexts,
  MAX_INPUT_CHARS,
  TRANSLATION_ENGINE,
} from "../translate.server";
import { GLOSSARY, GLOSSARY_VERSION, formatGlossary } from "../translation-glossary";

/** messages.create が受け取るもののうち、テストで検証する分だけ */
type CreateParams = {
  model: string;
  system: string;
  messages: Array<{ role: string; content: string }>;
};

/** options.client に差し込むモック（応答文字列を固定で返す） */
function mockClient(reply: string | (() => never)) {
  const create = vi.fn(async (_params: CreateParams) => {
    if (typeof reply === "function") reply();
    return { content: [{ type: "text", text: reply as string }] };
  });
  return { client: { create } as never, create };
}

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

describe("isTranslationEnabled", () => {
  it("API キーがあれば有効", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(isTranslationEnabled()).toBe(true);
  });

  it("API キーが無ければ無効（ローカル開発で必須にしない）", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isTranslationEnabled()).toBe(false);
  });
});

describe("sourceHash", () => {
  it("同じ入力からは同じハッシュになる", () => {
    expect(sourceHash(["a", "b"])).toBe(sourceHash(["a", "b"]));
  });

  it("要素の区切りが違えば別のハッシュになる（連結衝突を起こさない）", () => {
    expect(sourceHash(["ab", "c"])).not.toBe(sourceHash(["a", "bc"]));
  });

  it("順序が違えば別のハッシュになる", () => {
    expect(sourceHash(["a", "b"])).not.toBe(sourceHash(["b", "a"]));
  });

  it("空配列でも例外にならない", () => {
    expect(sourceHash([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("translateTexts - 無効・自明なケース", () => {
  it("API キーもクライアントも無ければ null（原文フォールバック）", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await translateTexts(["こんにちは"], { from: "ja", to: "en" })).toBeNull();
  });

  it("翻訳元と翻訳先が同じなら null", async () => {
    const { client } = mockClient('["x"]');
    expect(
      await translateTexts(["こんにちは"], { from: "ja", to: "ja", client }),
    ).toBeNull();
  });

  it("空配列は API を呼ばずに空を返す", async () => {
    const { client, create } = mockClient('["x"]');
    const result = await translateTexts([], { from: "ja", to: "en", client });
    expect(result?.texts).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("空白のみの要素しか無ければ API を呼ばずそのまま返す", async () => {
    const { client, create } = mockClient('["x"]');
    const result = await translateTexts(["", "   ", "\n"], {
      from: "ja",
      to: "en",
      client,
    });
    expect(result?.texts).toEqual(["", "   ", "\n"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("入力が上限文字数を超えたら null（呼び出し側で分割する）", async () => {
    const { client, create } = mockClient('["x"]');
    const huge = "あ".repeat(MAX_INPUT_CHARS + 1);
    expect(await translateTexts([huge], { from: "ja", to: "en", client })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("translateTexts - 正常系", () => {
  it("要素数と順序を保って訳文を返す", async () => {
    const { client } = mockClient('["Hello","World"]');
    const result = await translateTexts(["こんにちは", "世界"], {
      from: "ja",
      to: "en",
      client,
    });
    expect(result?.texts).toEqual(["Hello", "World"]);
    expect(result?.engine).toBe(TRANSLATION_ENGINE);
    expect(result?.glossaryVersion).toBe(GLOSSARY_VERSION);
  });

  it("空要素は API へ送らず、訳文は元の位置へ戻る", async () => {
    const { client, create } = mockClient('["Hello","World"]');
    const result = await translateTexts(["こんにちは", "", "世界"], {
      from: "ja",
      to: "en",
      client,
    });
    expect(result?.texts).toEqual(["Hello", "", "World"]);
    // API へ渡ったのは空要素を除いた 2 件
    const sent = JSON.parse(create.mock.calls[0]![0].messages[0]!.content);
    expect(sent).toEqual(["こんにちは", "世界"]);
  });

  it("コードフェンスや前置きが付いていても配列を取り出す", async () => {
    const { client } = mockClient('了解しました。\n```json\n["Hello"]\n```');
    const result = await translateTexts(["こんにちは"], { from: "ja", to: "en", client });
    expect(result?.texts).toEqual(["Hello"]);
  });

  it("短文は Haiku、長文は上位モデルへ回す", async () => {
    const short = mockClient('["a"]');
    const shortResult = await translateTexts(["短い"], {
      from: "ja",
      to: "en",
      client: short.client,
    });
    expect(shortResult?.model).toContain("haiku");

    const long = mockClient('["a"]');
    const longResult = await translateTexts(["あ".repeat(5000)], {
      from: "ja",
      to: "en",
      client: long.client,
    });
    expect(longResult?.model).toContain("sonnet");
  });

  it("プロンプトに用語集と文脈が載る", async () => {
    const { client, create } = mockClient('["a"]');
    await translateTexts(["詰め"], {
      from: "ja",
      to: "en",
      context: "ガイド記事の本文",
      client,
    });
    const system = create.mock.calls[0]![0].system;
    expect(system).toContain("ガイド記事の本文");
    expect(system).toContain("Random Seed Glitchless");
  });
});

describe("translateTexts - 壊れた応答は使わない", () => {
  it("要素数が足りなければ null（欠けたまま書き戻さない）", async () => {
    const { client } = mockClient('["Hello"]');
    expect(
      await translateTexts(["こんにちは", "世界"], { from: "ja", to: "en", client }),
    ).toBeNull();
  });

  it("要素数が多すぎても null", async () => {
    const { client } = mockClient('["Hello","World","!"]');
    expect(
      await translateTexts(["こんにちは", "世界"], { from: "ja", to: "en", client }),
    ).toBeNull();
  });

  it("配列でなければ null", async () => {
    const { client } = mockClient('{"text":"Hello"}');
    expect(await translateTexts(["こんにちは"], { from: "ja", to: "en", client })).toBeNull();
  });

  it("文字列以外が混ざっていれば null", async () => {
    const { client } = mockClient('["Hello", 42]');
    expect(
      await translateTexts(["こんにちは", "世界"], { from: "ja", to: "en", client }),
    ).toBeNull();
  });

  it("JSON として壊れていれば null", async () => {
    const { client } = mockClient('["Hello",');
    expect(await translateTexts(["こんにちは"], { from: "ja", to: "en", client })).toBeNull();
  });

  it("API が例外を投げても null を返す（呼び出し側は原文へ）", async () => {
    const { client } = mockClient(() => {
      throw new Error("rate limited");
    });
    expect(await translateTexts(["こんにちは"], { from: "ja", to: "en", client })).toBeNull();
  });
});

describe("用語集", () => {
  it("ja が重複していない（プロンプトで矛盾した指示にならない）", () => {
    const seen = new Set<string>();
    const duplicated: string[] = [];
    for (const entry of GLOSSARY) {
      if (seen.has(entry.ja)) duplicated.push(entry.ja);
      seen.add(entry.ja);
    }
    expect(duplicated).toEqual([]);
  });

  it("ja / en がどちらも空でない", () => {
    for (const entry of GLOSSARY) {
      expect(entry.ja.trim(), JSON.stringify(entry)).not.toBe("");
      expect(entry.en.trim(), JSON.stringify(entry)).not.toBe("");
    }
  });

  it("formatGlossary は 1 行 1 件で、note も載せる", () => {
    const lines = formatGlossary().split("\n");
    expect(lines).toHaveLength(GLOSSARY.length);
    const withNote = GLOSSARY.find((e) => e.note)!;
    expect(formatGlossary()).toContain(withNote.note!);
  });
});
