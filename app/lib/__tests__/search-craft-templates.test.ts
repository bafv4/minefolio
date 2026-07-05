import { describe, it, expect } from "vitest";
import {
  parseTemplateCrafts,
  parseTemplateRemapData,
  parseTemplateRemaps,
  serializeTemplateCrafts,
  serializeTemplateRemaps,
  parseEditorSubmission,
  type TemplateCraft,
} from "../search-craft-templates";

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
    expect(crafts[0].searchStr).toBe("cra");
    expect(crafts[0].items).toEqual(["minecraft:crafting_table", "minecraft:chest"]);
    expect(crafts[0].comment).toBe("最初に作る");
    expect(crafts[1].timing).toBe("fortress");
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
      { items: ["minecraft:crafting_table", "minecraft:chest"], searchStr: "cra", comment: "最初に作る", timing: null },
      { items: ["minecraft:golden_carrot"], searchStr: "go_c", comment: null, timing: "bastion" },
    ];
    const roundTripped = parseTemplateCrafts(serializeTemplateCrafts(crafts));
    expect(roundTripped).toEqual(crafts);
  });

  it("serializeTemplateCrafts は sequence を配列順（1始まり）で振り直す", () => {
    const json = serializeTemplateCrafts([
      { items: [], searchStr: "a", comment: null, timing: null },
      { items: [], searchStr: "b", comment: null, timing: null },
    ]);
    const raw = JSON.parse(json);
    expect(raw.map((r: { sequence: number }) => r.sequence)).toEqual([1, 2]);
  });

  it("serializeTemplateRemaps → parseTemplateRemaps で内容が往復する（key出力）", () => {
    const remaps = [{ sourceKey: "Semicolon", targetKey: "KeyE", software: null, notes: null }];
    const roundTripped = parseTemplateRemaps(serializeTemplateRemaps(remaps));
    expect(roundTripped).toEqual([{ sourceKey: "Semicolon", targetKey: "KeyE", software: null, notes: null }]);
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
    const result = parseEditorSubmission(
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
    expect(crafts[0].searchStr).toBe("cra");
    expect(crafts[0].timing).toBe("bastion");
    const remaps = parseTemplateRemaps(result.remapsData);
    expect(remaps).toHaveLength(2);
    expect(remaps[1].targetKey).toBeNull();
  });

  it("タイトル未入力・クラフト0件・アイテムなし・サーチ文字列なしを拒否する", () => {
    expect(
      parseEditorSubmission(buildForm({ title: "", crafts: validCrafts, remaps: "[]" })),
    ).toHaveProperty("error");
    expect(
      parseEditorSubmission(buildForm({ title: "a", crafts: "[]", remaps: "[]" })),
    ).toHaveProperty("error");
    expect(
      parseEditorSubmission(
        buildForm({
          title: "a",
          crafts: JSON.stringify([{ items: [], searchStr: "x" }]),
          remaps: "[]",
        }),
      ),
    ).toHaveProperty("error");
    expect(
      parseEditorSubmission(
        buildForm({
          title: "a",
          crafts: JSON.stringify([{ items: ["minecraft:chest"], searchStr: "" }]),
          remaps: "[]",
        }),
      ),
    ).toHaveProperty("error");
  });

  it("未入力のリマップ行と重複sourceKeyを除外し、空なら remapsData を null にする", () => {
    const result = parseEditorSubmission(
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

    const empty = parseEditorSubmission(
      buildForm({ title: "a", crafts: validCrafts, remaps: "[]" }),
    );
    if ("error" in empty) throw new Error("unexpected error");
    expect(empty.remapsData).toBeNull();
  });

  it("不正なJSONを拒否する", () => {
    expect(
      parseEditorSubmission(buildForm({ title: "a", crafts: "oops", remaps: "[]" })),
    ).toHaveProperty("error");
  });
});
