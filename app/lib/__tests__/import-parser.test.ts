// ユーザーがアップロードする設定ファイル（options.txt / standardsettings.json /
// AutoHotkeyスクリプト）のパーサ。パース誤り＝保存される設定のサイレント破損になるため、
// 変換式・境界値・形式自動判定を実値で固定する。
import { describe, it, expect } from "vitest";
import {
  parseOptionsText,
  parseStandardSettings,
  parseAutoHotkeyScript,
  parseMinecraftSettings,
} from "../import-parser";

describe("parseOptionsText", () => {
  it("キーバインド行を取り込む（action/category はマップ経由、keyCode は normalizeKeyCode 経由）", () => {
    const result = parseOptionsText("key_key.forward:key.keyboard.w\nkey_key.attack:key.mouse.left");

    expect(result.keybindings).toEqual([
      { action: "forward", keyCode: "KeyW", category: "movement" },
      { action: "attack", keyCode: "Mouse0", category: "combat" },
    ]);
  });

  it("マップに無いキーは無視する", () => {
    const result = parseOptionsText("key_key.unknownAction:key.keyboard.w");
    expect(result.keybindings).toEqual([]);
  });

  it("fov は *40+70 の式で変換される（境界値 -1/0/1 → 30/70/110）", () => {
    expect(parseOptionsText("fov:-1.0").gameSettings.fov).toBe(30);
    expect(parseOptionsText("fov:0.0").gameSettings.fov).toBe(70);
    expect(parseOptionsText("fov:1.0").gameSettings.fov).toBe(110);
  });

  it("toggleCrouch は toggleSneak にマッピングされる（toggleCrouch というキー名自体は結果に残らない）", () => {
    const result = parseOptionsText("toggleCrouch:true");
    expect(result.gameSettings.toggleSneak).toBe(true);
    expect(result.gameSettings).not.toHaveProperty("toggleCrouch");
  });

  it("toggleCrouch:false は toggleSneak:false になる", () => {
    expect(parseOptionsText("toggleCrouch:false").gameSettings.toggleSneak).toBe(false);
  });

  it("その他のゲーム設定（toggleSprint/autoJump/guiScale/rawMouseInput/mouseSensitivity/lang）を取り込む", () => {
    const content = [
      "toggleSprint:true",
      "autoJump:false",
      "guiScale:2",
      "rawMouseInput:true",
      "mouseSensitivity:0.5",
      "lang:en_us",
    ].join("\n");

    const result = parseOptionsText(content);

    expect(result.gameSettings).toEqual({
      toggleSprint: true,
      autoJump: false,
      guiScale: 2,
      rawInput: true,
      mouseSensitivity: 0.5,
      gameLanguage: "en_us",
    });
  });

  it("boolean 値は文字列 'true' 判定のみで true になる（他の文字列は false 扱い）", () => {
    expect(parseOptionsText("toggleSprint:1").gameSettings.toggleSprint).toBe(false);
    expect(parseOptionsText("toggleSprint:True").gameSettings.toggleSprint).toBe(false);
  });

  it("コロンを含まない行・値が空文字の行は無視される（キー無しにはならない）", () => {
    const result = parseOptionsText("notAColonLine\nlang:");
    expect(result.gameSettings.gameLanguage).toBe("");
    expect(result.keybindings).toEqual([]);
  });

  it("空文字列の入力は空の結果を返す", () => {
    expect(parseOptionsText("")).toEqual({ keybindings: [], gameSettings: {} });
  });
});

describe("parseStandardSettings", () => {
  it("options 入れ子ありの JSON からキーバインドと設定を取り込む（値は文字列 'true'/'false'）", () => {
    const json = JSON.stringify({
      options: {
        "key_key.forward": "key.keyboard.w",
        toggleSprint: "true",
        fov: 0.5,
      },
    });

    const result = parseStandardSettings(json);

    expect(result.keybindings).toEqual([
      { action: "forward", keyCode: "KeyW", category: "movement" },
    ]);
    expect(result.gameSettings.toggleSprint).toBe(true);
    expect(result.gameSettings.fov).toBe(90); // 0.5*40+70
  });

  it("options 入れ子なし（ルート直下がそのまま options 扱い）でも取り込む", () => {
    const json = JSON.stringify({ "key_key.attack": "key.mouse.left" });
    const result = parseStandardSettings(json);
    expect(result.keybindings).toEqual([
      { action: "attack", keyCode: "Mouse0", category: "combat" },
    ]);
  });

  it("boolean 値が実際の真偽値（文字列でない）でも取り込む", () => {
    const json = JSON.stringify({ toggleSprint: true, autoJump: false });
    const result = parseStandardSettings(json);
    expect(result.gameSettings.toggleSprint).toBe(true);
    expect(result.gameSettings.autoJump).toBe(false);
  });

  it("数値/文字列どちらの型でも guiScale・mouseSensitivity・fov を同じ値に変換する", () => {
    const numeric = parseStandardSettings(JSON.stringify({ guiScale: 2, mouseSensitivity: 0.4, fov: 1 }));
    const stringified = parseStandardSettings(
      JSON.stringify({ guiScale: "2", mouseSensitivity: "0.4", fov: "1" }),
    );

    expect(numeric.gameSettings).toEqual(stringified.gameSettings);
    expect(numeric.gameSettings.guiScale).toBe(2);
    expect(numeric.gameSettings.mouseSensitivity).toBe(0.4);
    expect(numeric.gameSettings.fov).toBe(110);
  });

  it("lang はそのまま文字列として取り込まれる", () => {
    const result = parseStandardSettings(JSON.stringify({ lang: "ja_jp" }));
    expect(result.gameSettings.gameLanguage).toBe("ja_jp");
  });

  it("壊れた JSON は空の結果を返す（例外を投げない）", () => {
    expect(parseStandardSettings("{ not valid json")).toEqual({
      keybindings: [],
      gameSettings: {},
    });
  });

  it("空文字列も空の結果を返す", () => {
    expect(parseStandardSettings("")).toEqual({ keybindings: [], gameSettings: {} });
  });
});

describe("parseAutoHotkeyScript", () => {
  it("基本的な a::b 形式のリマップを抽出する", () => {
    const result = parseAutoHotkeyScript("a::b");
    expect(result).toEqual([
      { sourceKey: "KeyA", targetKey: "KeyB", software: "AutoHotkey", notes: undefined },
    ]);
  });

  it("CapsLock::Ctrl は CapsLock → ControlLeft に変換される", () => {
    const result = parseAutoHotkeyScript("CapsLock::Ctrl");
    expect(result).toEqual([
      { sourceKey: "CapsLock", targetKey: "ControlLeft", software: "AutoHotkey", notes: undefined },
    ]);
  });

  it("コメント行（;）と空行はスキップする", () => {
    const script = ["; this is a full-line comment", "", "a::b"].join("\n");
    const result = parseAutoHotkeyScript(script);
    expect(result).toHaveLength(1);
    expect(result[0].sourceKey).toBe("KeyA");
  });

  it("#ディレクティブ行はスキップする", () => {
    const script = ["#IfWinActive Minecraft", "#SingleInstance Force", "a::b"].join("\n");
    const result = parseAutoHotkeyScript(script);
    expect(result).toHaveLength(1);
  });

  it("行末コメントは notes として取得する", () => {
    const result = parseAutoHotkeyScript("a::b ; sprint key remap");
    expect(result[0].notes).toBe("sprint key remap");
  });

  it("行末コメントが無い場合 notes は undefined", () => {
    const result = parseAutoHotkeyScript("a::b");
    expect(result[0].notes).toBeUndefined();
  });

  it("複数行のリマップをまとめて抽出する", () => {
    const script = [
      "; Minefolio export",
      "#IfWinActive Minecraft",
      "CapsLock::Ctrl ; sneak toggle",
      "",
      "f::space",
    ].join("\n");

    const result = parseAutoHotkeyScript(script);

    expect(result).toEqual([
      { sourceKey: "CapsLock", targetKey: "ControlLeft", software: "AutoHotkey", notes: "sneak toggle" },
      { sourceKey: "KeyF", targetKey: "Space", software: "AutoHotkey", notes: undefined },
    ]);
  });

  it("リマップパターンを含まない行はスキップする", () => {
    expect(parseAutoHotkeyScript("SendInput, hello")).toEqual([]);
  });
});

describe("parseMinecraftSettings", () => {
  it("ファイル名が .json または standardsettings を含む場合は standardsettings 形式で解析する", () => {
    const json = JSON.stringify({ "key_key.forward": "key.keyboard.w" });
    const byExt = parseMinecraftSettings(json, "config.json");
    const byName = parseMinecraftSettings(json, "my_standardsettings.txt");

    expect(byExt.keybindings).toEqual([{ action: "forward", keyCode: "KeyW", category: "movement" }]);
    expect(byName.keybindings).toEqual([{ action: "forward", keyCode: "KeyW", category: "movement" }]);
  });

  it("ファイル名が options.txt または .txt の場合は options.txt 形式で解析する", () => {
    const content = "key_key.forward:key.keyboard.w";
    const byOptionsTxt = parseMinecraftSettings(content, "options.txt");
    const byTxtExt = parseMinecraftSettings(content, "settings.txt");

    expect(byOptionsTxt.keybindings).toEqual([{ action: "forward", keyCode: "KeyW", category: "movement" }]);
    expect(byTxtExt.keybindings).toEqual([{ action: "forward", keyCode: "KeyW", category: "movement" }]);
  });

  it("ファイル名未指定時は内容が { で始まれば standardsettings 形式として解析する", () => {
    const json = JSON.stringify({ "key_key.forward": "key.keyboard.w" });
    const result = parseMinecraftSettings(json);
    expect(result.keybindings).toEqual([{ action: "forward", keyCode: "KeyW", category: "movement" }]);
  });

  it("ファイル名未指定・内容が { で始まらない場合は options.txt 形式として解析する", () => {
    const result = parseMinecraftSettings("key_key.forward:key.keyboard.w");
    expect(result.keybindings).toEqual([{ action: "forward", keyCode: "KeyW", category: "movement" }]);
  });
});
