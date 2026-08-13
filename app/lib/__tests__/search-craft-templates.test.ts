import { describe, it, expect } from "vitest";
import { createTranslator } from "../messages";

// エラーメッセージは表示ロケールに依存するため、テストでは日本語で固定する
const t = createTranslator("ja");
import {
  parseTemplateCrafts,
  parseTemplateRemapData,
  parseTemplateRemaps,
  serializeTemplateCrafts,
  serializeTemplateRemaps,
  parseEditorSubmission,
  parseTemplateLoops,
  serializeTemplateLoops,
  MAX_TEMPLATE_LOOPS,
  MAX_LOOP_STEPS,
  type TemplateCraft,
  type TemplateLoop,
} from "../search-craft-templates";
import { MAX_SEARCH_VARIATIONS } from "../search-craft-variations";

describe("parseTemplateCrafts", () => {
  it("PresetSearchCraftData[] 形式のJSONをデコードする（items は二重エンコード）", () => {
    const craftsData = JSON.stringify([
      {
        sequence: 2,
        items: JSON.stringify(["minecraft:bucket"]),
        keys: "[]",
        searchStr: "buc",
        comment: null,
        timing: "fortress",
      },
      {
        sequence: 1,
        items: JSON.stringify(["minecraft:crafting_table", "minecraft:chest"]),
        keys: "[]",
        searchStr: "cra",
        comment: "最初に作る",
        timing: null,
      },
    ]);

    const crafts = parseTemplateCrafts(craftsData);
    expect(crafts).toHaveLength(2);
    // sequence 順にソートされる
    expect(crafts[0].variations).toEqual([{ str: "cra", withShift: false }]);
    expect(crafts[0].items).toEqual(["minecraft:crafting_table", "minecraft:chest"]);
    expect(crafts[0].comment).toBe("最初に作る");
    expect(crafts[1].timing).toBe("fortress");
  });

  it("旧形式（variations 列なし、searchStr/withShift スカラーのみ）のスナップショットは1件のバリエーションに合成する", () => {
    const craftsData = JSON.stringify([
      { sequence: 1, items: "[]", keys: "[]", searchStr: "en", comment: null, withShift: true },
    ]);
    const crafts = parseTemplateCrafts(craftsData);
    expect(crafts[0].variations).toEqual([{ str: "en", withShift: true }]);
  });

  it("variations 列があればそれを正準として採用する（searchStr/withShift はミラーとして無視）", () => {
    const craftsData = JSON.stringify([
      {
        sequence: 1,
        items: "[]",
        keys: "[]",
        searchStr: "en",
        withShift: false,
        comment: null,
        variations: [
          { str: "en", withShift: false },
          { str: "er", withShift: true },
        ],
      },
    ]);
    const crafts = parseTemplateCrafts(craftsData);
    expect(crafts[0].variations).toEqual([
      { str: "en", withShift: false },
      { str: "er", withShift: true },
    ]);
  });

  it("不正なJSONや null は空配列を返す", () => {
    expect(parseTemplateCrafts(null)).toEqual([]);
    expect(parseTemplateCrafts("not json")).toEqual([]);
    expect(parseTemplateCrafts('{"a":1}')).toEqual([]);
  });

  it("items が壊れているエントリは空アイテムとして扱う", () => {
    const craftsData = JSON.stringify([
      { sequence: 1, items: "broken", keys: "[]", searchStr: "x", comment: null },
    ]);
    const crafts = parseTemplateCrafts(craftsData);
    expect(crafts).toHaveLength(1);
    expect(crafts[0].items).toEqual([]);
  });

  it("不明な timing は null に正規化する", () => {
    const craftsData = JSON.stringify([
      { sequence: 1, items: "[]", keys: "[]", searchStr: "x", comment: null, timing: "invalid" },
    ]);
    expect(parseTemplateCrafts(craftsData)[0].timing).toBeNull();
  });
});

describe("parseTemplateRemapData / parseTemplateRemaps", () => {
  it("PresetRemapData[] をパースする", () => {
    const remapsData = JSON.stringify([
      { sourceKey: "Semicolon", targetKey: "KeyE", software: "AHK", notes: null },
    ]);
    const data = parseTemplateRemapData(remapsData);
    expect(data).toHaveLength(1);
    expect(data[0].sourceKey).toBe("Semicolon");
  });

  it("sourceKey のないエントリと不正JSONを除外する", () => {
    expect(parseTemplateRemapData(null)).toEqual([]);
    expect(parseTemplateRemapData("oops")).toEqual([]);
    const remapsData = JSON.stringify([{ targetKey: "KeyE" }, { sourceKey: "KeyA", targetKey: null }]);
    expect(parseTemplateRemapData(remapsData)).toHaveLength(1);
  });

  it("文字出力モードは outputCharacter を出力先として扱う", () => {
    const remapsData = JSON.stringify([
      {
        sourceKey: "Slash",
        targetKey: "KeyX",
        software: null,
        notes: null,
        outputMode: "character",
        outputCharacter: "-",
      },
    ]);
    const remaps = parseTemplateRemaps(remapsData);
    expect(remaps[0].targetKey).toBe("-");
  });
});

describe("serializeTemplateCrafts / serializeTemplateRemaps（Playground保存用の逆変換）", () => {
  it("serializeTemplateCrafts → parseTemplateCrafts で内容が往復する", () => {
    const crafts: TemplateCraft[] = [
      {
        items: ["minecraft:crafting_table", "minecraft:chest"],
        comment: "最初に作る",
        timing: null,
        variations: [{ str: "cra", withShift: false }],
      },
      {
        items: ["minecraft:golden_carrot"],
        comment: null,
        timing: "bastion",
        variations: [{ str: "go_c", withShift: true }],
      },
    ];
    const roundTripped = parseTemplateCrafts(serializeTemplateCrafts(crafts));
    expect(roundTripped).toEqual(crafts);
  });

  it("複数バリエーションも往復する（第1バリエーションが searchStr/withShift のミラーになる）", () => {
    const crafts: TemplateCraft[] = [
      {
        items: ["minecraft:ender_eye"],
        comment: null,
        timing: null,
        variations: [
          { str: "en", withShift: false },
          { str: "er", withShift: true },
        ],
      },
    ];
    const json = serializeTemplateCrafts(crafts);
    const raw = JSON.parse(json);
    expect(raw[0].searchStr).toBe("en");
    expect(raw[0].withShift).toBe(false);
    expect(raw[0].variations).toEqual(crafts[0].variations);
    expect(parseTemplateCrafts(json)).toEqual(crafts);
  });

  it("serializeTemplateCrafts は sequence を配列順（1始まり）で振り直す", () => {
    const json = serializeTemplateCrafts([
      { items: [], comment: null, timing: null, variations: [{ str: "a", withShift: false }] },
      { items: [], comment: null, timing: null, variations: [{ str: "b", withShift: false }] },
    ]);
    const raw = JSON.parse(json);
    expect(raw.map((r: { sequence: number }) => r.sequence)).toEqual([1, 2]);
  });

  it("withShift の指定なし（旧データ）は false として往復する", () => {
    const json = JSON.stringify([
      { sequence: 1, items: "[]", keys: "[]", searchStr: "a", comment: null, timing: null },
    ]);
    expect(parseTemplateCrafts(json)[0].variations[0].withShift).toBe(false);
  });

  it("serializeTemplateRemaps → parseTemplateRemaps で内容が往復する（key出力）", () => {
    const remaps = [{ sourceKey: "Semicolon", targetKey: "KeyE", software: null, notes: null }];
    const roundTripped = parseTemplateRemaps(serializeTemplateRemaps(remaps));
    // remapType はテンプレートに保存されないため unset に正規化される
    expect(roundTripped).toEqual([
      { sourceKey: "Semicolon", targetKey: "KeyE", software: null, notes: null, remapType: "unset" },
    ]);
  });

  it("serializeTemplateRemaps は無効化（targetKey: null）を保持する", () => {
    const remaps = [{ sourceKey: "KeyQ", targetKey: null, software: null, notes: null }];
    const roundTripped = parseTemplateRemaps(serializeTemplateRemaps(remaps));
    expect(roundTripped[0].targetKey).toBeNull();
  });
});

describe("parseEditorSubmission（テンプレートエディタの送信検証）", () => {
  const buildForm = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  const validCrafts = JSON.stringify([
    { items: ["minecraft:crafting_table"], searchStr: "cra", comment: "memo", timing: "bastion" },
  ]);

  it("正常な送信をDB保存形式に変換する", () => {
    const result = parseEditorSubmission(t, 
      buildForm({
        title: "  テスト  ",
        description: "説明",
        gameLanguage: "ja_jp",
        crafts: validCrafts,
        remaps: JSON.stringify([
          { id: "x", sourceKey: "Semicolon", targetKey: "KeyE" },
          { id: "y", sourceKey: "KeyQ", targetKey: null },
        ]),
      }),
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.title).toBe("テスト");
    expect(result.gameLanguage).toBe("ja_jp");
    const crafts = parseTemplateCrafts(result.craftsData);
    expect(crafts[0].variations).toEqual([{ str: "cra", withShift: false }]);
    expect(crafts[0].timing).toBe("bastion");
    const remaps = parseTemplateRemaps(result.remapsData);
    expect(remaps).toHaveLength(2);
    expect(remaps[1].targetKey).toBeNull();
  });

  it("withShift を検証して保持する（未指定・不正値は false）", () => {
    const result = parseEditorSubmission(t,
      buildForm({
        title: "テスト",
        crafts: JSON.stringify([
          { items: ["minecraft:chest"], searchStr: "che", comment: null, timing: null, withShift: true },
          { items: ["minecraft:chest"], searchStr: "che", comment: null, timing: null },
          { items: ["minecraft:chest"], searchStr: "che", comment: null, timing: null, withShift: "yes" },
        ]),
        remaps: "[]",
      }),
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const crafts = parseTemplateCrafts(result.craftsData);
    expect(crafts.map((c) => c.variations[0].withShift)).toEqual([true, false, false]);
  });

  it("サーチ文字列の先頭・末尾スペースを保存値に保持する（trim は空判定のみ）", () => {
    const result = parseEditorSubmission(t,
      buildForm({
        title: "a",
        crafts: JSON.stringify([
          { items: ["minecraft:chest"], searchStr: " che ", comment: null, timing: null },
        ]),
        remaps: "[]",
      }),
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const crafts = parseTemplateCrafts(result.craftsData);
    expect(crafts[0].variations[0].str).toBe(" che ");
  });

  it("複数バリエーション（variations 配列）の送信を受理し、先頭以外も先頭末尾スペースを保持する", () => {
    const result = parseEditorSubmission(t,
      buildForm({
        title: "a",
        crafts: JSON.stringify([
          {
            items: ["minecraft:ender_eye"],
            comment: null,
            timing: null,
            variations: [
              { str: "en", withShift: false },
              { str: " er ", withShift: true },
            ],
          },
        ]),
        remaps: "[]",
      }),
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const crafts = parseTemplateCrafts(result.craftsData);
    expect(crafts[0].variations).toEqual([
      { str: "en", withShift: false },
      { str: " er ", withShift: true },
    ]);
  });

  it(`variations が ${MAX_SEARCH_VARIATIONS} 件を超える送信は拒否する`, () => {
    const tooMany = Array.from({ length: MAX_SEARCH_VARIATIONS + 1 }, (_, i) => ({
      str: `s${i}`,
      withShift: false,
    }));
    const result = parseEditorSubmission(t,
      buildForm({
        title: "a",
        crafts: JSON.stringify([
          { items: ["minecraft:chest"], comment: null, timing: null, variations: tooMany },
        ]),
        remaps: "[]",
      }),
    );
    expect(result).toHaveProperty("error");
  });

  it("variations 内に空文字列（trim後）のバリエーションが含まれる場合は拒否する", () => {
    const result = parseEditorSubmission(t,
      buildForm({
        title: "a",
        crafts: JSON.stringify([
          {
            items: ["minecraft:chest"],
            comment: null,
            timing: null,
            variations: [
              { str: "che", withShift: false },
              { str: "   ", withShift: false },
            ],
          },
        ]),
        remaps: "[]",
      }),
    );
    expect(result).toHaveProperty("error");
  });

  it("スペースのみのサーチ文字列は拒否する", () => {
    expect(
      parseEditorSubmission(t,
        buildForm({
          title: "a",
          crafts: JSON.stringify([{ items: ["minecraft:chest"], searchStr: "   " }]),
          remaps: "[]",
        }),
      ),
    ).toHaveProperty("error");
  });

  it("タイトル未入力・クラフト0件・アイテムなし・サーチ文字列なしを拒否する", () => {
    expect(
      parseEditorSubmission(t, buildForm({ title: "", crafts: validCrafts, remaps: "[]" })),
    ).toHaveProperty("error");
    expect(
      parseEditorSubmission(t, buildForm({ title: "a", crafts: "[]", remaps: "[]" })),
    ).toHaveProperty("error");
    expect(
      parseEditorSubmission(t, 
        buildForm({
          title: "a",
          crafts: JSON.stringify([{ items: [], searchStr: "x" }]),
          remaps: "[]",
        }),
      ),
    ).toHaveProperty("error");
    expect(
      parseEditorSubmission(t, 
        buildForm({
          title: "a",
          crafts: JSON.stringify([{ items: ["minecraft:chest"], searchStr: "" }]),
          remaps: "[]",
        }),
      ),
    ).toHaveProperty("error");
  });

  it("未入力のリマップ行と重複sourceKeyを除外し、空なら remapsData を null にする", () => {
    const result = parseEditorSubmission(t, 
      buildForm({
        title: "a",
        crafts: validCrafts,
        remaps: JSON.stringify([
          { sourceKey: "", targetKey: "KeyE" }, // 変換元未入力
          { sourceKey: "KeyA", targetKey: "" }, // 変更先入力待ち
          { sourceKey: "KeyB", targetKey: "KeyC" },
          { sourceKey: "KeyB", targetKey: "KeyD" }, // 重複（先勝ち）
        ]),
      }),
    );
    if ("error" in result) throw new Error("unexpected error");
    const remaps = parseTemplateRemaps(result.remapsData);
    expect(remaps).toHaveLength(1);
    expect(remaps[0].targetKey).toBe("KeyC");

    const empty = parseEditorSubmission(t, 
      buildForm({ title: "a", crafts: validCrafts, remaps: "[]" }),
    );
    if ("error" in empty) throw new Error("unexpected error");
    expect(empty.remapsData).toBeNull();
  });

  it("不正なJSONを拒否する", () => {
    expect(
      parseEditorSubmission(t, buildForm({ title: "a", crafts: "oops", remaps: "[]" })),
    ).toHaveProperty("error");
  });
});

describe("serializeTemplateLoops / parseTemplateLoops", () => {
  it("serializeTemplateLoops → parseTemplateLoops で内容が往復する", () => {
    const loops: TemplateLoop[] = [
      {
        steps: [
          { craftIndex: 0, transition: null, variationIndex: 0 },
          { craftIndex: 1, transition: { type: "backspace", bsCount: 1 }, variationIndex: 0 },
        ],
        comment: "メモ",
        timing: "bastion",
      },
    ];
    const roundTripped = parseTemplateLoops(serializeTemplateLoops(loops), 2);
    expect(roundTripped).toEqual(loops);
  });

  it("serializeTemplateLoops → parseTemplateLoops で arrowLeft transition も往復する", () => {
    const loops: TemplateLoop[] = [
      {
        steps: [
          { craftIndex: 0, transition: null, variationIndex: 0 },
          { craftIndex: 1, transition: { type: "arrowLeft", arrowCount: 2 }, variationIndex: 0 },
        ],
        comment: null,
        timing: null,
      },
    ];
    const roundTripped = parseTemplateLoops(serializeTemplateLoops(loops), 2);
    expect(roundTripped).toEqual(loops);
  });

  it("variationIndex を含むステップも往復する（0 はシリアライズ時に省略される）", () => {
    const loops: TemplateLoop[] = [
      {
        steps: [
          { craftIndex: 0, transition: null, variationIndex: 0 },
          { craftIndex: 1, transition: { type: "selectAll" }, variationIndex: 2 },
        ],
        comment: null,
        timing: null,
      },
    ];
    const json = serializeTemplateLoops(loops);
    const raw = JSON.parse(json);
    // 0 は省略、非0は明示される
    expect(raw[0].steps[0]).not.toHaveProperty("variationIndex");
    expect(raw[0].steps[1].variationIndex).toBe(2);
    expect(parseTemplateLoops(json, 2)).toEqual(loops);
  });

  it("craftSeq が crafts の範囲外を指すステップは除去し、2件未満になった Loop は除去する", () => {
    const loopsData = JSON.stringify([
      {
        sequence: 1,
        steps: [
          { craftSeq: 1, transition: null },
          { craftSeq: 5, transition: { type: "backspace", bsCount: 1 } }, // craftCount=2 なので範囲外
        ],
        comment: null,
        timing: null,
      },
      {
        sequence: 2,
        steps: [
          { craftSeq: 1, transition: null },
          { craftSeq: 2, transition: { type: "selectAll" } },
        ],
        comment: null,
        timing: null,
      },
    ]);
    const loops = parseTemplateLoops(loopsData, 2);
    // 1件目は範囲外ステップ除去で1件になり丸ごと除去され、2件目のみ残る
    expect(loops).toHaveLength(1);
    expect(loops[0].steps).toEqual([
      { craftIndex: 0, transition: null, variationIndex: 0 },
      { craftIndex: 1, transition: { type: "selectAll" }, variationIndex: 0 },
    ]);
  });

  it("loopsData が null・破損JSONの場合は空配列を返す", () => {
    expect(parseTemplateLoops(null, 2)).toEqual([]);
    expect(parseTemplateLoops("not json", 2)).toEqual([]);
    expect(parseTemplateLoops('{"a":1}', 2)).toEqual([]);
  });
});

describe("parseEditorSubmission - loops（繋ぎ方）", () => {
  const twoCrafts = JSON.stringify([
    { items: ["minecraft:blaze_powder"], searchStr: "er", comment: null, timing: null },
    { items: ["minecraft:ender_eye"], searchStr: "en", comment: null, timing: null },
  ]);

  const buildLoopForm = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("正常な loops をDB保存形式（craftSeq参照）に変換する", () => {
    const loops = [
      {
        steps: [
          { craftIndex: 0, transition: null },
          { craftIndex: 1, transition: { type: "backspace", bsCount: 1 } },
        ],
        comment: "コメント",
        timing: null,
      },
    ];
    const result = parseEditorSubmission(t,
      buildLoopForm({
        title: "テスト",
        crafts: twoCrafts,
        remaps: "[]",
        loops: JSON.stringify(loops),
      }),
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.loopsData).not.toBeNull();
    expect(parseTemplateLoops(result.loopsData, 2)).toEqual([
      {
        steps: [
          { craftIndex: 0, transition: null, variationIndex: 0 },
          { craftIndex: 1, transition: { type: "backspace", bsCount: 1 }, variationIndex: 0 },
        ],
        comment: "コメント",
        timing: null,
      },
    ]);
  });

  it("variationIndex を指定した loops もDB保存形式に変換して往復する", () => {
    const loops = [
      {
        steps: [
          { craftIndex: 0, transition: null, variationIndex: 0 },
          { craftIndex: 1, transition: { type: "selectAll" }, variationIndex: 1 },
        ],
        comment: null,
        timing: null,
      },
    ];
    const result = parseEditorSubmission(t,
      buildLoopForm({
        title: "テスト",
        crafts: twoCrafts,
        remaps: "[]",
        loops: JSON.stringify(loops),
      }),
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(parseTemplateLoops(result.loopsData, 2)).toEqual(loops);
  });

  it("loops フィールド省略時は loopsData が null", () => {
    const result = parseEditorSubmission(t,
      buildLoopForm({ title: "テスト", crafts: twoCrafts, remaps: "[]" }),
    );
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.loopsData).toBeNull();
  });

  it("loops が非配列の場合は拒否する", () => {
    const result = parseEditorSubmission(t,
      buildLoopForm({
        title: "テスト",
        crafts: twoCrafts,
        remaps: "[]",
        loops: JSON.stringify({ not: "array" }),
      }),
    );
    expect(result).toHaveProperty("error");
  });

  it("steps の craftIndex が範囲外の場合は拒否する", () => {
    const badLoops = [
      {
        steps: [
          { craftIndex: 0, transition: null },
          { craftIndex: 99, transition: { type: "selectAll" } },
        ],
        comment: null,
        timing: null,
      },
    ];
    const result = parseEditorSubmission(t,
      buildLoopForm({ title: "テスト", crafts: twoCrafts, remaps: "[]", loops: JSON.stringify(badLoops) }),
    );
    expect(result).toHaveProperty("error");
  });

  it("MAX_TEMPLATE_LOOPS を超えるループ数は拒否する", () => {
    const tooManyLoops = Array.from({ length: MAX_TEMPLATE_LOOPS + 1 }, () => ({
      steps: [
        { craftIndex: 0, transition: null },
        { craftIndex: 1, transition: { type: "selectAll" } },
      ],
      comment: null,
      timing: null,
    }));
    const result = parseEditorSubmission(t,
      buildLoopForm({ title: "テスト", crafts: twoCrafts, remaps: "[]", loops: JSON.stringify(tooManyLoops) }),
    );
    expect(result).toHaveProperty("error");
  });

  it("MAX_LOOP_STEPS を超えるステップ数は拒否する", () => {
    const tooManySteps = [
      {
        steps: [
          { craftIndex: 0, transition: null },
          ...Array.from({ length: MAX_LOOP_STEPS }, () => ({
            craftIndex: 1,
            transition: { type: "selectAll" },
          })),
        ],
        comment: null,
        timing: null,
      },
    ];
    const result = parseEditorSubmission(t,
      buildLoopForm({ title: "テスト", crafts: twoCrafts, remaps: "[]", loops: JSON.stringify(tooManySteps) }),
    );
    expect(result).toHaveProperty("error");
  });
});
