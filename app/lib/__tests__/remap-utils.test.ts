import { describe, it, expect } from "vitest";
import { createTranslator } from "../messages";

// ラベル生成は表示ロケールに依存するため、テストでは日本語で固定する
const t = createTranslator("ja");
import {
  simulateRemapOutput,
  getActualKeyInfos,
  getActualControlKeyInfo,
  filterRemapsForChat,
  filterRemapsForTrigger,
  findRemapConflict,
  type RemapInfo,
} from "../remap-utils";

const REMAPS: RemapInfo[] = [
  // 単一キーのリマップ
  { sourceKey: "Semicolon", targetKey: "KeyE" },
  // 修飾キー組み合わせのリマップ
  { sourceKey: "Shift+KeyW", targetKey: "KeyA" },
  // 無効化
  { sourceKey: "KeyQ", targetKey: null },
  // 文字出力（キーコード以外のターゲット）
  { sourceKey: "Slash", targetKey: "-" },
];

describe("simulateRemapOutput", () => {
  it("リマップなしの印字可能キーはそのままの文字を出力する", () => {
    const result = simulateRemapOutput(t, "KeyA", REMAPS);
    expect(result.output).toBe("a");
    expect(result.isRemapped).toBe(false);
  });

  it("Shift + 印字可能キーは大文字を出力する", () => {
    const result = simulateRemapOutput(t, "Shift+KeyB", REMAPS);
    expect(result.output).toBe("B");
    expect(result.isRemapped).toBe(false);
  });

  it("単一キーのリマップを適用する", () => {
    const result = simulateRemapOutput(t, "Semicolon", REMAPS);
    expect(result.output).toBe("e");
    expect(result.isRemapped).toBe(true);
  });

  it("修飾キー込みの完全一致リマップを優先する", () => {
    const result = simulateRemapOutput(t, "Shift+KeyW", REMAPS);
    expect(result.output).toBe("a");
    expect(result.isRemapped).toBe(true);
  });

  it("Shift + 単一キーリマップは出力を大文字化する", () => {
    const result = simulateRemapOutput(t, "Shift+Semicolon", REMAPS);
    expect(result.output).toBe("E");
    expect(result.isRemapped).toBe(true);
  });

  it("無効化されたキーは出力なし", () => {
    const result = simulateRemapOutput(t, "KeyQ", REMAPS);
    expect(result.output).toBeNull();
    expect(result.isRemapped).toBe(true);
  });

  it("文字出力ターゲットはそのまま出力する", () => {
    const result = simulateRemapOutput(t, "Slash", REMAPS);
    expect(result.output).toBe("-");
    expect(result.isRemapped).toBe(true);
  });

  it("印字不能キーは出力なし", () => {
    const result = simulateRemapOutput(t, "F3", REMAPS);
    expect(result.output).toBeNull();
    expect(result.isRemapped).toBe(false);
  });

  it("未定義の Ctrl 組み合わせは出力なし", () => {
    const result = simulateRemapOutput(t, "Ctrl+KeyC", REMAPS);
    expect(result.output).toBeNull();
    expect(result.isRemapped).toBe(false);
  });

  it("スペースキーは空白を出力する", () => {
    const result = simulateRemapOutput(t, "Space", REMAPS);
    expect(result.output).toBe(" ");
    // 可視1文字でないキーは getKeyLabel(t, ) のラベル
    expect(result.pressedLabel).toBe("Space");
  });

  it("記号キーは文字を出力する（keyCode名ではなく）", () => {
    expect(simulateRemapOutput(t, "Minus", REMAPS).output).toBe("-");
    expect(simulateRemapOutput(t, "Comma", REMAPS).output).toBe(",");
    expect(simulateRemapOutput(t, "Period", REMAPS).output).toBe(".");
  });

  it("Shift + 記号/数字キーはシフト後の文字を出力する（US配列基準）", () => {
    expect(simulateRemapOutput(t, "Shift+Minus", REMAPS).output).toBe("_");
    expect(simulateRemapOutput(t, "Shift+Digit1", REMAPS).output).toBe("!");
  });

  it("JIS の Shift+IntlRo はアンダースコアを出力する", () => {
    expect(simulateRemapOutput(t, "Shift+IntlRo", REMAPS).output).toBe("_");
  });

  it("キー出力ターゲットが記号キーの場合も文字を出力する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyB", targetKey: "Space" }];
    expect(simulateRemapOutput(t, "KeyB", remaps).output).toBe(" ");
    const remaps2: RemapInfo[] = [{ sourceKey: "KeyC", targetKey: "Minus" }];
    expect(simulateRemapOutput(t, "KeyC", remaps2).output).toBe("-");
  });

  it("修飾キー単独のリマップは完全一致で解決する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "ShiftLeft", targetKey: "KeyE" }];
    const result = simulateRemapOutput(t, "ShiftLeft", remaps);
    expect(result.output).toBe("e");
    expect(result.isRemapped).toBe(true);
  });

  it("outputKeyCode: リマップのキー出力先を返す（Backspace 検知用）", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyQ", targetKey: "Backspace" }];
    expect(simulateRemapOutput(t, "KeyQ", remaps).outputKeyCode).toBe("Backspace");
  });

  it("outputKeyCode: リマップなしの物理キーは押したキー自体を返す", () => {
    expect(simulateRemapOutput(t, "Backspace", REMAPS).outputKeyCode).toBe("Backspace");
    expect(simulateRemapOutput(t, "KeyA", REMAPS).outputKeyCode).toBe("KeyA");
  });

  it("outputKeyCode: 文字出力ターゲット・無効化は null", () => {
    // Slash → "-"（文字出力）, KeyQ → null（無効化）
    expect(simulateRemapOutput(t, "Slash", REMAPS).outputKeyCode).toBeNull();
    expect(simulateRemapOutput(t, "KeyQ", REMAPS).outputKeyCode).toBeNull();
  });
});

describe("getActualKeyInfos のスペース処理", () => {
  it("スペース文字は Space キーとして解決し、バッジラベルも Space になる（空バッジにならない）", () => {
    const infos = getActualKeyInfos(t, " s ", REMAPS);
    expect(infos).toHaveLength(3);
    expect(infos[0].keyCode).toBe("Space");
    expect(infos[0].displayLabel).toBe("Space");
    expect(infos[1].displayLabel).toBe("S");
    expect(infos[2].keyCode).toBe("Space");
    expect(infos[2].displayLabel).toBe("Space");
  });

  it("Space が変換元のリマップも Space ラベルで表示する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "Space", targetKey: "KeyB" }];
    const infos = getActualKeyInfos(t, "b", remaps);
    expect(infos[0].isRemapped).toBe(true);
    expect(infos[0].keyCode).toBe("Space");
    expect(infos[0].displayLabel).toBe("Space");
  });
});

describe("getActualKeyInfos の逆引き優先順位（修飾キーなしソース優先）", () => {
  // 実際の設定例: W→m / ⇧W→H / E→h / ⇧E→M / ⇧S→h / ⇧D→m
  const LAYERED_REMAPS: RemapInfo[] = [
    { sourceKey: "KeyW", targetKey: "KeyM" },
    { sourceKey: "Shift+KeyW", targetKey: "KeyH" },
    { sourceKey: "KeyE", targetKey: "KeyH" },
    { sourceKey: "Shift+KeyE", targetKey: "KeyM" },
    { sourceKey: "Shift+KeyS", targetKey: "KeyH" },
    { sourceKey: "Shift+KeyD", targetKey: "KeyM" },
  ];

  it("同じ文字を出せる場合、修飾キーなしのソースを優先する（hm → E, W）", () => {
    const infos = getActualKeyInfos(t, "hm", LAYERED_REMAPS);
    expect(infos.map((i) => i.keyCode)).toEqual(["KeyE", "KeyW"]);
    expect(infos.map((i) => i.displayLabel)).toEqual(["E", "W"]);
    expect(infos.every((i) => !i.needsShift)).toBe(true);
  });

  it("配列の並び順に関係なく修飾キーなしのソースが勝つ", () => {
    const reversed = [...LAYERED_REMAPS].reverse();
    const infos = getActualKeyInfos(t, "hm", reversed);
    expect(infos.map((i) => i.keyCode)).toEqual(["KeyE", "KeyW"]);
  });

  it("修飾キー付きしかない文字は従来どおり修飾キー付きで解決する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "Shift+KeyS", targetKey: "KeyH" }];
    const infos = getActualKeyInfos(t, "h", remaps);
    expect(infos[0].keyCode).toBe("Shift+KeyS");
    expect(infos[0].displayLabel).toBe("⇧+S");
  });

  it("shiftHeld 時は Shift+X 完全一致で逆引きする（HM → W, E）", () => {
    const infos = getActualKeyInfos(t, "HM", LAYERED_REMAPS, { shiftHeld: true });
    expect(infos.map((i) => i.keyCode)).toEqual(["KeyW", "KeyE"]);
    expect(infos.map((i) => i.displayLabel)).toEqual(["W", "E"]);
  });
});

describe("getActualKeyInfos の shiftHeld モード（Shiftを押しながらクラフト）", () => {
  it("英字ターゲットのリマップは通常時と同じキーに解決する（大文字小文字は区別しない）", () => {
    const infos = getActualKeyInfos(t, "e", REMAPS, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("Semicolon");
    expect(infos[0].isRemapped).toBe(true);
    expect(infos[0].needsShift).toBe(false);
  });

  it("記号ターゲットのリマップはシフト後の文字を優先して逆引きする", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyA", targetKey: "Semicolon" }];
    // Shift 押下中に A を押すと ":" が出力される
    const infos = getActualKeyInfos(t, ":", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("KeyA");
    expect(infos[0].isRemapped).toBe(true);
    expect(infos[0].displayLabel).toBe("A");
    expect(infos[0].needsShift).toBe(false);
  });

  it("Shift+X ソースの完全一致リマップは X 単独のバッジになる（⇧ なし）", () => {
    // 通常時は ⇧+W だが、Shift 押しっぱなしなので W だけ押せばよい
    const normal = getActualKeyInfos(t, "a", REMAPS);
    expect(normal[0].displayLabel).toBe("⇧+W");
    expect(normal[0].needsShift).toBe(true);

    const shifted = getActualKeyInfos(t, "a", REMAPS, { shiftHeld: true });
    expect(shifted[0].keyCode).toBe("KeyW");
    expect(shifted[0].displayLabel).toBe("W");
    expect(shifted[0].needsShift).toBe(false);
  });

  it("Shift+同キーの完全一致リマップがある基底キーはシフト文字化しない", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyK", targetKey: "Semicolon" },
      { sourceKey: "Shift+KeyK", targetKey: "KeyE" },
    ];
    // Shift 押下中に K を押すと Shift+KeyK が発動して "e" が出る（":" ではない）
    expect(getActualKeyInfos(t, "e", remaps, { shiftHeld: true })[0].keyCode).toBe("KeyK");
    // ":" は K では出せないため、非リマップの Semicolon キーに解決する
    expect(getActualKeyInfos(t, ":", remaps, { shiftHeld: true })[0].keyCode).toBe("Semicolon");
  });

  it("文字出力ターゲットは Shift の影響を受けずそのまま逆引きする", () => {
    const infos = getActualKeyInfos(t, "-", REMAPS, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("Slash");
    expect(infos[0].isRemapped).toBe(true);
  });

  it("非リマップのシフト記号は物理キーに逆引きする", () => {
    const infos = getActualKeyInfos(t, "_", REMAPS, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("Minus");
    expect(infos[0].isRemapped).toBe(false);
    expect(infos[0].needsShift).toBe(false);
  });

  it("非リマップの英字・スペースは基底キーのまま解決する", () => {
    const infos = getActualKeyInfos(t, "b ", REMAPS, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("KeyB");
    expect(infos[0].displayLabel).toBe("B");
    expect(infos[0].needsShift).toBe(false);
    expect(infos[1].keyCode).toBe("Space");
    expect(infos[1].displayLabel).toBe("Space");
  });

  it("shiftHeld では通常マップにフォールバックしない（完全一致リマップが別の文字を出すため）", () => {
    // Shift押下中の Semicolon は Shift+Semicolon の完全一致で "x" を出すため、
    // "e" は非リマップの E キー（Shift+E = "E"、大文字小文字は区別しない）で入力する
    const remaps: RemapInfo[] = [
      { sourceKey: "Semicolon", targetKey: "KeyE" },
      { sourceKey: "Shift+Semicolon", targetKey: "KeyX" },
    ];
    const infos = getActualKeyInfos(t, "e", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("KeyE");
    expect(infos[0].isRemapped).toBe(false);
  });

  it("shiftHeld では Shift 込みで無効化されたキーに解決しない", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyK", targetKey: "Semicolon" },
      { sourceKey: "Shift+KeyK", targetKey: null },
    ];
    // Shift押下中の K は無効化されており何も出力しない
    const infos = getActualKeyInfos(t, ";", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).not.toBe("KeyK");
  });

  it("shiftHeld では Ctrl 組み合わせリマップにフォールバックしない", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "Ctrl+KeyC", targetKey: "KeyE" }];
    const infos = getActualKeyInfos(t, "e", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("KeyE");
    expect(infos[0].isRemapped).toBe(false);
  });

  it("シフト記号の逆引き先キー自体がリマップ済みの場合は使わない", () => {
    // Shift+Slash はリマップ（Slash→"-"）により "-" を出すため、"?" を Slash に解決してはいけない
    const remaps: RemapInfo[] = [{ sourceKey: "Slash", targetKey: "-" }];
    const infos = getActualKeyInfos(t, "?", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).not.toBe("Slash");
  });

  it("shiftHeld で逆引きしたキーを Shift 込みで順方向適用すると元の文字に戻る", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyA", targetKey: "Semicolon" },
      { sourceKey: "Shift+KeyW", targetKey: "KeyA" },
    ];
    const searchStr = "a: e_";
    const infos = getActualKeyInfos(t, searchStr, remaps, { shiftHeld: true });
    const roundTrip = infos
      .map((info) => {
        const combo = info.keyCode.includes("+") ? info.keyCode : `Shift+${info.keyCode}`;
        return simulateRemapOutput(t, combo, remaps).output;
      })
      .join("");
    expect(roundTrip.toLowerCase()).toBe(searchStr.toLowerCase());
  });
});

describe("simulateRemapOutput と getActualKeyInfos の整合性", () => {
  it("逆引きで得たキーを順方向に適用すると元の文字に戻る", () => {
    const searchStr = "sea";
    const keyInfos = getActualKeyInfos(t, searchStr, REMAPS);
    const roundTrip = keyInfos
      .map((info) => simulateRemapOutput(t, info.keyCode, REMAPS).output)
      .join("");
    expect(roundTrip).toBe(searchStr);
  });

  it("先頭・末尾スペースを含む文字列も逆引き→順方向で元に戻る", () => {
    const searchStr = " sea ";
    const keyInfos = getActualKeyInfos(t, searchStr, REMAPS);
    const roundTrip = keyInfos
      .map((info) => simulateRemapOutput(t, info.keyCode, REMAPS).output)
      .join("");
    expect(roundTrip).toBe(searchStr);
  });
});

describe("filterRemapsForChat / filterRemapsForTrigger（種別による絞り込み）", () => {
  const TYPED_REMAPS: RemapInfo[] = [
    { sourceKey: "KeyE", targetKey: "KeyO", remapType: "trigger" },
    { sourceKey: "KeyA", targetKey: "KeyB", remapType: "chat" },
    { sourceKey: "KeyC", targetKey: "KeyD", remapType: "all" },
    { sourceKey: "KeyF", targetKey: "KeyG", remapType: "unset" },
  ];

  it("chat 文脈では trigger 種別の行を除外する", () => {
    const result = filterRemapsForChat(TYPED_REMAPS);
    expect(result.map((r) => r.sourceKey)).toEqual(["KeyA", "KeyC", "KeyF"]);
  });

  it("trigger 文脈では chat 種別の行を除外する", () => {
    const result = filterRemapsForTrigger(TYPED_REMAPS);
    expect(result.map((r) => r.sourceKey)).toEqual(["KeyE", "KeyC", "KeyF"]);
  });

  it("同一 sourceKey は 文脈一致 > all > unset の優先度で1行に解決する", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyE", targetKey: "KeyU", remapType: "unset" },
      { sourceKey: "KeyE", targetKey: "KeyA", remapType: "all" },
      { sourceKey: "KeyE", targetKey: "KeyC", remapType: "chat" },
    ];
    const chat = filterRemapsForChat(remaps);
    expect(chat).toHaveLength(1);
    expect(chat[0].targetKey).toBe("KeyC");
    // trigger 文脈では chat 行が除外され、all が unset に勝つ
    const trigger = filterRemapsForTrigger(remaps);
    expect(trigger).toHaveLength(1);
    expect(trigger[0].targetKey).toBe("KeyA");
  });

  it("同順位の行は先勝ち", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyE", targetKey: "KeyA", remapType: "chat" },
      { sourceKey: "KeyE", targetKey: "KeyB", remapType: "chat" },
    ];
    const result = filterRemapsForChat(remaps);
    expect(result).toHaveLength(1);
    expect(result[0].targetKey).toBe("KeyA");
  });

  it("大文字レガシー表記の sourceKey は同一キーとして統合する", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KEYE", targetKey: "KeyA", remapType: "unset" },
      { sourceKey: "KeyE", targetKey: "KeyB", remapType: "chat" },
    ];
    const result = filterRemapsForChat(remaps);
    expect(result).toHaveLength(1);
    expect(result[0].targetKey).toBe("KeyB");
  });

  it("出力順は入力の初出順を維持する（優先度で置き換わっても位置は初出のまま）", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyA", targetKey: "KeyX", remapType: "unset" },
      { sourceKey: "KeyB", targetKey: "KeyY", remapType: "chat" },
      { sourceKey: "KeyA", targetKey: "KeyZ", remapType: "chat" },
    ];
    const result = filterRemapsForChat(remaps);
    expect(result.map((r) => r.sourceKey)).toEqual(["KeyA", "KeyB"]);
    expect(result[0].targetKey).toBe("KeyZ");
  });

  it("冪等: 2回適用しても結果が変わらない", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyE", targetKey: "KeyU" },
      { sourceKey: "KeyE", targetKey: "KeyC", remapType: "chat" },
      { sourceKey: "KeyT", targetKey: "KeyX", remapType: "trigger" },
      { sourceKey: "KeyA", targetKey: "KeyY", remapType: "all" },
    ];
    const chatOnce = filterRemapsForChat(remaps);
    expect(filterRemapsForChat(chatOnce)).toEqual(chatOnce);
    const triggerOnce = filterRemapsForTrigger(remaps);
    expect(filterRemapsForTrigger(triggerOnce)).toEqual(triggerOnce);
  });

  it("remapType 欠落の行（旧データ）は unset として扱う", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyE", targetKey: "KeyA" },
      { sourceKey: "KeyE", targetKey: "KeyB", remapType: "chat" },
      { sourceKey: "KeyF", targetKey: "KeyG" },
    ];
    const chat = filterRemapsForChat(remaps);
    expect(chat.map((r) => r.targetKey)).toEqual(["KeyB", "KeyG"]);
    // trigger 文脈では chat 行が除外され、欠落行が unset として有効
    const trigger = filterRemapsForTrigger(remaps);
    expect(trigger.map((r) => r.targetKey)).toEqual(["KeyA", "KeyG"]);
  });
});

describe("getActualKeyInfos の種別フィルタ（chat 文脈）", () => {
  it("trigger 行は逆引きに使われず、同一 sourceKey の chat 行が優先される", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyE", targetKey: "KeyO", remapType: "trigger" },
      { sourceKey: "KeyE", targetKey: "KeyH", remapType: "chat" },
    ];
    const infos = getActualKeyInfos(t, "ho", remaps);
    // "h" は chat 行（E→h）で KeyE に逆引きされる
    expect(infos[0].keyCode).toBe("KeyE");
    expect(infos[0].isRemapped).toBe(true);
    // "o" を出す trigger 行は chat 文脈で無効なので KeyO 直押し
    expect(infos[1].keyCode).toBe("KeyO");
    expect(infos[1].isRemapped).toBe(false);
  });

  it("shiftHeld: trigger 種別の単一キー行が混在してもシフト記号の逆引きを汚染しない", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "Minus", targetKey: "KeyR", remapType: "trigger" },
      { sourceKey: "KeyA", targetKey: "KeyB", remapType: "chat" },
    ];
    // trigger 行は chat 文脈で除外されるため、Minus は非リマップキーとして "_" に解決できる
    const infos = getActualKeyInfos(t, "_", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("Minus");
    expect(infos[0].isRemapped).toBe(false);
    expect(infos[0].needsShift).toBe(false);
  });
});

describe("simulateRemapOutput の種別フィルタ（chat 文脈）", () => {
  it("trigger 行が配列先頭にあっても同一 sourceKey の chat 行の出力を選ぶ", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyE", targetKey: "KeyO", remapType: "trigger" },
      { sourceKey: "KeyE", targetKey: "KeyH", remapType: "chat" },
    ];
    const result = simulateRemapOutput(t, "KeyE", remaps);
    expect(result.output).toBe("h");
    expect(result.isRemapped).toBe(true);
  });
});

describe("findRemapConflict（保存前バリデーション）", () => {
  it("同一 (sourceKey, 種別) の完全重複を検出する", () => {
    expect(
      findRemapConflict([
        { sourceKey: "KeyE", remapType: "chat" },
        { sourceKey: "KeyE", remapType: "chat" },
      ]),
    ).toEqual({ kind: "duplicate", sourceKey: "KeyE", remapType: "chat" });
    // remapType 欠落同士も unset の重複として検出する
    expect(findRemapConflict([{ sourceKey: "KeyA" }, { sourceKey: "KeyA" }])).toEqual({
      kind: "duplicate",
      sourceKey: "KeyA",
      remapType: "unset",
    });
  });

  it("all 行と trigger 行の同一キー共存を検出する（両方向）", () => {
    expect(
      findRemapConflict([
        { sourceKey: "KeyE", remapType: "all" },
        { sourceKey: "KeyE", remapType: "trigger" },
      ]),
    ).toEqual({ kind: "allConflict", sourceKey: "KeyE", remapType: "trigger" });
    expect(
      findRemapConflict([
        { sourceKey: "KeyE", remapType: "trigger" },
        { sourceKey: "KeyE", remapType: "all" },
      ]),
    ).toEqual({ kind: "allConflict", sourceKey: "KeyE", remapType: "all" });
  });

  it("all 行と unset 行（remapType 欠落含む）の同一キー共存を検出する（両方向）", () => {
    expect(
      findRemapConflict([
        { sourceKey: "KeyE", remapType: "all" },
        { sourceKey: "KeyE" },
      ]),
    ).toEqual({ kind: "allConflict", sourceKey: "KeyE", remapType: "unset" });
    expect(
      findRemapConflict([
        { sourceKey: "KeyE" },
        { sourceKey: "KeyE", remapType: "all" },
      ]),
    ).toEqual({ kind: "allConflict", sourceKey: "KeyE", remapType: "all" });
  });

  it("修飾キー付きは別キー扱い（Shift+KeyW と KeyW は非衝突）", () => {
    expect(
      findRemapConflict([
        { sourceKey: "Shift+KeyW", remapType: "all" },
        { sourceKey: "KeyW", remapType: "all" },
      ]),
    ).toBeNull();
  });

  it("大文字小文字違いの sourceKey は同一キーとして衝突する", () => {
    expect(
      findRemapConflict([
        { sourceKey: "KEYE", remapType: "chat" },
        { sourceKey: "KeyE", remapType: "chat" },
      ]),
    ).toEqual({ kind: "duplicate", sourceKey: "KeyE", remapType: "chat" });
  });

  it("all を含まない異種別の共存は衝突しない", () => {
    expect(
      findRemapConflict([
        { sourceKey: "KeyE", remapType: "trigger" },
        { sourceKey: "KeyE", remapType: "chat" },
      ]),
    ).toBeNull();
    expect(
      findRemapConflict([
        { sourceKey: "KeyE" },
        { sourceKey: "KeyE", remapType: "chat" },
      ]),
    ).toBeNull();
  });
});

describe("getActualControlKeyInfo（制御キーの逆引き。Loop の ControlKeyBadge 用）", () => {
  it("リマップ無しなら物理キーそのまま（isRemapped: false）", () => {
    expect(getActualControlKeyInfo(t, "Backspace", [])).toEqual({
      keyCode: "Backspace",
      displayLabel: "BS",
      tooltipLabel: "BS",
      isRemapped: false,
      remapDetails: [],
    });
    expect(getActualControlKeyInfo(t, "ArrowLeft", [])).toEqual({
      keyCode: "ArrowLeft",
      displayLabel: "←",
      tooltipLabel: "←",
      isRemapped: false,
      remapDetails: [],
    });
    expect(getActualControlKeyInfo(t, "Home", [])).toEqual({
      keyCode: "Home",
      displayLabel: "Home",
      tooltipLabel: "Home",
      isRemapped: false,
      remapDetails: [],
    });
  });

  it("KeyR → Backspace のリマップを逆引きする", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyR", targetKey: "Backspace" }];
    const info = getActualControlKeyInfo(t, "Backspace", remaps);
    expect(info.keyCode).toBe("KeyR");
    expect(info.displayLabel).toBe("R");
    expect(info.isRemapped).toBe(true);
  });

  it("修飾キーなしソースを優先する（Shift+KeyS→Backspace と KeyE→Backspace が両方あるとき KeyE に解決）", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "Shift+KeyS", targetKey: "Backspace" },
      { sourceKey: "KeyE", targetKey: "Backspace" },
    ];
    expect(getActualControlKeyInfo(t, "Backspace", remaps).keyCode).toBe("KeyE");
    // 配列の並び順に関係なく修飾キーなしのソースが勝つ
    expect(getActualControlKeyInfo(t, "Backspace", [...remaps].reverse()).keyCode).toBe("KeyE");
  });

  it("同クラス内（修飾キーなし同士）は後勝ち（getActualKeyInfos と同規則）", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyA", targetKey: "Backspace" },
      { sourceKey: "KeyB", targetKey: "Backspace" },
    ];
    expect(getActualControlKeyInfo(t, "Backspace", remaps).keyCode).toBe("KeyB");
  });

  it("chat 文脈フィルタ: trigger 種別のリマップは無視される", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyR", targetKey: "Backspace", remapType: "trigger" }];
    const info = getActualControlKeyInfo(t, "Backspace", remaps);
    expect(info.isRemapped).toBe(false);
    expect(info.keyCode).toBe("Backspace");
  });

  it("chat 種別の行があれば trigger 種別の同一出力より優先して解決する", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyR", targetKey: "Backspace", remapType: "trigger" },
      { sourceKey: "KeyF", targetKey: "Backspace", remapType: "chat" },
    ];
    expect(getActualControlKeyInfo(t, "Backspace", remaps).keyCode).toBe("KeyF");
  });

  describe("shiftHeld: true（⇧Home 用。Shift成分とHome成分をそれぞれ独立に逆引きして合成する）", () => {
    it("両成分とも非リマップ → 物理キーのまま合成される（⇧+Home）", () => {
      const info = getActualControlKeyInfo(t, "Home", [], { shiftHeld: true });
      expect(info.keyCode).toBe("ShiftLeft+Home");
      expect(info.displayLabel).toBe("⇧+Home");
      expect(info.isRemapped).toBe(false);
    });

    it("Shift成分・Home成分ともにリマップがある → それぞれのソースキーを合成する（R+T）", () => {
      const remaps: RemapInfo[] = [
        { sourceKey: "KeyR", targetKey: "ShiftLeft" },
        { sourceKey: "KeyT", targetKey: "Home" },
      ];
      const info = getActualControlKeyInfo(t, "Home", remaps, { shiftHeld: true });
      expect(info.keyCode).toBe("KeyR+KeyT");
      expect(info.displayLabel).toBe("R+T");
      expect(info.isRemapped).toBe(true);
    });

    it("Shift成分のみリマップ → Home成分は物理のまま合成される（R+Home）", () => {
      const remaps: RemapInfo[] = [{ sourceKey: "KeyR", targetKey: "ShiftLeft" }];
      const info = getActualControlKeyInfo(t, "Home", remaps, { shiftHeld: true });
      expect(info.keyCode).toBe("KeyR+Home");
      expect(info.displayLabel).toBe("R+Home");
      expect(info.isRemapped).toBe(true);
    });

    it("Home成分のみリマップ → Shift成分は物理のまま合成される（⇧+T）", () => {
      const remaps: RemapInfo[] = [{ sourceKey: "KeyT", targetKey: "Home" }];
      const info = getActualControlKeyInfo(t, "Home", remaps, { shiftHeld: true });
      expect(info.keyCode).toBe("ShiftLeft+KeyT");
      expect(info.displayLabel).toBe("⇧+T");
      expect(info.isRemapped).toBe(true);
    });

    it("Shift成分は ShiftLeft を出力するリマップを優先する（ShiftRight より）", () => {
      const remaps: RemapInfo[] = [
        { sourceKey: "KeyA", targetKey: "ShiftRight" },
        { sourceKey: "KeyB", targetKey: "ShiftLeft" },
      ];
      const info = getActualControlKeyInfo(t, "Home", remaps, { shiftHeld: true });
      expect(info.keyCode).toBe("KeyB+Home");
      expect(info.displayLabel).toBe("B+Home");
      expect(info.isRemapped).toBe(true);
    });

    it("物理 ShiftLeft が奪われていなければ ShiftRight 側のリマップは見ず、物理 Shift のまま解決する", () => {
      // ShiftLeft 自体を出力するリマップは無いが、物理 ShiftLeft も別出力に奪われていないため、
      // KeyA → ShiftRight のリマップは無視され物理 ⇧ になる
      const remaps: RemapInfo[] = [{ sourceKey: "KeyA", targetKey: "ShiftRight" }];
      const info = getActualControlKeyInfo(t, "Home", remaps, { shiftHeld: true });
      expect(info.keyCode).toBe("ShiftLeft+Home");
      expect(info.displayLabel).toBe("⇧+Home");
      expect(info.isRemapped).toBe(false);
    });

    it("物理 ShiftLeft が奪われている場合のみ ShiftRight を出力するリマップに進む", () => {
      const remaps: RemapInfo[] = [
        { sourceKey: "ShiftLeft", targetKey: "KeyZ" },
        { sourceKey: "KeyA", targetKey: "ShiftRight" },
      ];
      const info = getActualControlKeyInfo(t, "Home", remaps, { shiftHeld: true });
      expect(info.keyCode).toBe("KeyA+Home");
      expect(info.displayLabel).toBe("A+Home");
      expect(info.isRemapped).toBe(true);
    });

    it("物理 ShiftLeft が奪われており、ShiftRight を出力するリマップも無ければ物理 ShiftRight になる", () => {
      const remaps: RemapInfo[] = [{ sourceKey: "ShiftLeft", targetKey: "KeyZ" }];
      const info = getActualControlKeyInfo(t, "Home", remaps, { shiftHeld: true });
      expect(info.keyCode).toBe("ShiftRight+Home");
      expect(info.displayLabel).toBe("⇧+Home");
      expect(info.isRemapped).toBe(false);
    });
  });

  it("既知の限界: 物理キーが別出力に奪われ、かつ対象キーを出力するリマップも無い場合は物理キーのまま", () => {
    // Backspace 自体は KeyZ を出力するようリマップされているが、
    // Backspace を出力するリマップは存在しない
    const remaps: RemapInfo[] = [{ sourceKey: "Backspace", targetKey: "KeyZ" }];
    const info = getActualControlKeyInfo(t, "Backspace", remaps);
    expect(info.keyCode).toBe("Backspace");
    expect(info.isRemapped).toBe(false);
  });
});
