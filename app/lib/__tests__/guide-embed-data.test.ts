// 埋め込みのデータの選び方（公開ページとエディタの要約で共有）と、エディタの要約。
import { describe, it, expect } from "vitest";
import {
  findEmbedPreset,
  listEmbedPresetNames,
  summarizeKeybindEmbed,
  summarizeSearchCraftEmbed,
  type EmbedUserData,
} from "../guide-embed-data";

function craft(timing: string | null, idx: number) {
  return {
    id: `c${idx}`,
    sequence: idx,
    items: '["minecraft:stone"]',
    searchStr: "st",
    comment: null,
    timing,
    variations: [{ str: "st", withShift: false }],
  };
}

const remap = (sourceKey: string, remapType?: string) => ({
  sourceKey,
  targetKey: "KeyA",
  software: null,
  outputMode: null,
  outputCharacter: null,
  remapType,
});

const user: EmbedUserData = {
  slug: "runner",
  displayName: "走者",
  displayNameAlphabet: null,
  mcid: "Runner",
  keybindings: [],
  keyRemaps: [remap("KeyQ"), remap("KeyE", "trigger")],
  playerConfig: { keyboardLayout: "JIS", fingerAssignments: null },
  searchCrafts: [craft("bastion", 0), craft("ow", 1), craft("ow", 2), craft(null, 3), craft("weird", 4)],
  searchCraftLoops: [],
  presets: [
    {
      name: "大会用",
      isActive: false,
      keybindingsData: null,
      remapsData: JSON.stringify([remap("KeyZ"), remap("KeyX"), remap("KeyC")]),
      playerConfigData: JSON.stringify({ keyboardLayout: "US" }),
      searchCraftsData: JSON.stringify([{ items: '["minecraft:dirt"]', searchStr: "di", timing: "fortress", sequence: 0 }]),
      searchCraftLoopsData: null,
    },
    {
      name: "大会用",
      isActive: false,
      keybindingsData: null,
      remapsData: "[]",
      playerConfigData: null,
      searchCraftsData: "[]",
      searchCraftLoopsData: null,
    },
    {
      name: "壊れたデータ",
      isActive: false,
      keybindingsData: null,
      remapsData: "{not json",
      playerConfigData: "{not json",
      searchCraftsData: null,
      searchCraftLoopsData: null,
    },
  ],
};

describe("findEmbedPreset / listEmbedPresetNames", () => {
  it("同じ名前は先に見つかったもの（公開ページの find と同じ）。一覧は重複を除く", () => {
    expect(findEmbedPreset(user, "大会用")?.searchCraftsData).toContain("fortress");
    expect(findEmbedPreset(user, null)).toBeNull();
    expect(findEmbedPreset(user, "無い")).toBeNull();
    expect(listEmbedPresetNames(user)).toEqual(["大会用", "壊れたデータ"]);
  });
});

describe("summarizeSearchCraftEmbed", () => {
  it("既定の表示は一覧と同じ順（指定なし → OW → Bastion → … → その他）で数える", () => {
    expect(summarizeSearchCraftEmbed(user, null)).toEqual({
      total: 5,
      groups: [
        { timing: null, count: 1 },
        { timing: "ow", count: 2 },
        { timing: "bastion", count: 1 },
        { timing: "other", count: 1 },
      ],
    });
  });

  it("プリセットを指定すればそのスナップショットで数える", () => {
    expect(summarizeSearchCraftEmbed(user, "大会用")).toEqual({
      total: 1,
      groups: [{ timing: "fortress", count: 1 }],
    });
  });

  it("サーチクラフトの無いプリセットは既定の表示に戻る（公開ページと同じ）", () => {
    expect(summarizeSearchCraftEmbed(user, "壊れたデータ").total).toBe(5);
  });
});

describe("summarizeKeybindEmbed", () => {
  it("Trigger 種別のリマップは数えない", () => {
    expect(summarizeKeybindEmbed(user, null)).toEqual({ remapCount: 1, layout: "JIS" });
  });

  it("プリセットのリマップと配列を使う", () => {
    expect(summarizeKeybindEmbed(user, "大会用")).toEqual({ remapCount: 3, layout: "US" });
  });

  it("壊れた JSON は落とさず既定の表示に戻る", () => {
    expect(summarizeKeybindEmbed(user, "壊れたデータ")).toEqual({ remapCount: 1, layout: "JIS" });
  });
});
