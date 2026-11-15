// 保存ボタンの出し分け（公開版があるときだけ下書き保存）と、設定モーダルの「適用」で未保存にするかの判定。
import { describe, it, expect } from "vitest";
import {
  getPublishAction,
  getShortcutSaveMode,
  hasDraftSave,
  isSettingsChanged,
  PUBLISH_ACTION_MESSAGES,
  type GuideSettingsSnapshot,
} from "../use-guide-save";

describe("getPublishAction", () => {
  it("保存済みの公開状態と公開の設定の組で決まる", () => {
    expect(getPublishAction(false, true)).toBe("publish");
    expect(getPublishAction(true, true)).toBe("publishUpdate");
    expect(getPublishAction(true, false)).toBe("unpublish");
    expect(getPublishAction(false, false)).toBe("saveUnpublished");
  });

  it("どの組にも文言・説明・ピルの文言がある", () => {
    for (const live of [true, false]) {
      for (const setting of [true, false]) {
        const messages = PUBLISH_ACTION_MESSAGES[getPublishAction(live, setting)];
        expect(messages.label).toBeTruthy();
        expect(messages.hint).toBeTruthy();
        expect(messages.status).toBeTruthy();
      }
    }
  });
});

describe("hasDraftSave / getShortcutSaveMode", () => {
  it("公開中のガイドだけ下書き保存があり、Ctrl+S は下書き保存", () => {
    expect(hasDraftSave(true)).toBe(true);
    expect(getShortcutSaveMode(true)).toBe("draft");
  });

  it("公開版が無い（未公開・取り下げ済み）ガイドは保存ボタン1つで、Ctrl+S もそれ（publish モード）", () => {
    expect(hasDraftSave(false)).toBe(false);
    expect(getShortcutSaveMode(false)).toBe("publish");
  });
});

describe("isSettingsChanged", () => {
  const base: GuideSettingsSnapshot = {
    title: "タイトル",
    summary: "概要",
    tags: ["a", "b"],
    coverImageUrl: null,
    isPublished: false,
    slug: "guide",
    allowAutoTranslation: true,
  };

  it("同じ値なら変わっていない（タグは別の配列でも中身が同じなら同じ）", () => {
    expect(isSettingsChanged(base, { ...base, tags: [...base.tags] })).toBe(false);
  });

  it.each<[string, Partial<GuideSettingsSnapshot>]>([
    ["タイトル", { title: "別" }],
    ["概要", { summary: "" }],
    ["カバー画像", { coverImageUrl: "https://example.com/a.png" }],
    ["公開の設定", { isPublished: true }],
    ["スラッグ", { slug: "other" }],
    ["自動翻訳の許可", { allowAutoTranslation: false }],
    ["タグの追加", { tags: ["a", "b", "c"] }],
    ["タグの並び", { tags: ["b", "a"] }],
  ])("%s が変われば変わった", (_label, patch) => {
    expect(isSettingsChanged(base, { ...base, ...patch })).toBe(true);
  });
});
