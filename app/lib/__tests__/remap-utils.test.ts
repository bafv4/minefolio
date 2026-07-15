import { describe, it, expect } from "vitest";
import { simulateRemapOutput, getActualKeyInfos, type RemapInfo } from "../remap-utils";

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
    const result = simulateRemapOutput("KeyA", REMAPS);
    expect(result.output).toBe("a");
    expect(result.isRemapped).toBe(false);
  });

  it("Shift + 印字可能キーは大文字を出力する", () => {
    const result = simulateRemapOutput("Shift+KeyB", REMAPS);
    expect(result.output).toBe("B");
    expect(result.isRemapped).toBe(false);
  });

  it("単一キーのリマップを適用する", () => {
    const result = simulateRemapOutput("Semicolon", REMAPS);
    expect(result.output).toBe("e");
    expect(result.isRemapped).toBe(true);
  });

  it("修飾キー込みの完全一致リマップを優先する", () => {
    const result = simulateRemapOutput("Shift+KeyW", REMAPS);
    expect(result.output).toBe("a");
    expect(result.isRemapped).toBe(true);
  });

  it("Shift + 単一キーリマップは出力を大文字化する", () => {
    const result = simulateRemapOutput("Shift+Semicolon", REMAPS);
    expect(result.output).toBe("E");
    expect(result.isRemapped).toBe(true);
  });

  it("無効化されたキーは出力なし", () => {
    const result = simulateRemapOutput("KeyQ", REMAPS);
    expect(result.output).toBeNull();
    expect(result.isRemapped).toBe(true);
  });

  it("文字出力ターゲットはそのまま出力する", () => {
    const result = simulateRemapOutput("Slash", REMAPS);
    expect(result.output).toBe("-");
    expect(result.isRemapped).toBe(true);
  });

  it("印字不能キーは出力なし", () => {
    const result = simulateRemapOutput("F3", REMAPS);
    expect(result.output).toBeNull();
    expect(result.isRemapped).toBe(false);
  });

  it("未定義の Ctrl 組み合わせは出力なし", () => {
    const result = simulateRemapOutput("Ctrl+KeyC", REMAPS);
    expect(result.output).toBeNull();
    expect(result.isRemapped).toBe(false);
  });

  it("スペースキーは空白を出力する", () => {
    const result = simulateRemapOutput("Space", REMAPS);
    expect(result.output).toBe(" ");
    // 可視1文字でないキーは getKeyLabel() のラベル
    expect(result.pressedLabel).toBe("Space");
  });

  it("記号キーは文字を出力する（keyCode名ではなく）", () => {
    expect(simulateRemapOutput("Minus", REMAPS).output).toBe("-");
    expect(simulateRemapOutput("Comma", REMAPS).output).toBe(",");
    expect(simulateRemapOutput("Period", REMAPS).output).toBe(".");
  });

  it("Shift + 記号/数字キーはシフト後の文字を出力する（US配列基準）", () => {
    expect(simulateRemapOutput("Shift+Minus", REMAPS).output).toBe("_");
    expect(simulateRemapOutput("Shift+Digit1", REMAPS).output).toBe("!");
  });

  it("JIS の Shift+IntlRo はアンダースコアを出力する", () => {
    expect(simulateRemapOutput("Shift+IntlRo", REMAPS).output).toBe("_");
  });

  it("キー出力ターゲットが記号キーの場合も文字を出力する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyB", targetKey: "Space" }];
    expect(simulateRemapOutput("KeyB", remaps).output).toBe(" ");
    const remaps2: RemapInfo[] = [{ sourceKey: "KeyC", targetKey: "Minus" }];
    expect(simulateRemapOutput("KeyC", remaps2).output).toBe("-");
  });

  it("修飾キー単独のリマップは完全一致で解決する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "ShiftLeft", targetKey: "KeyE" }];
    const result = simulateRemapOutput("ShiftLeft", remaps);
    expect(result.output).toBe("e");
    expect(result.isRemapped).toBe(true);
  });

  it("outputKeyCode: リマップのキー出力先を返す（Backspace 検知用）", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyQ", targetKey: "Backspace" }];
    expect(simulateRemapOutput("KeyQ", remaps).outputKeyCode).toBe("Backspace");
  });

  it("outputKeyCode: リマップなしの物理キーは押したキー自体を返す", () => {
    expect(simulateRemapOutput("Backspace", REMAPS).outputKeyCode).toBe("Backspace");
    expect(simulateRemapOutput("KeyA", REMAPS).outputKeyCode).toBe("KeyA");
  });

  it("outputKeyCode: 文字出力ターゲット・無効化は null", () => {
    // Slash → "-"（文字出力）, KeyQ → null（無効化）
    expect(simulateRemapOutput("Slash", REMAPS).outputKeyCode).toBeNull();
    expect(simulateRemapOutput("KeyQ", REMAPS).outputKeyCode).toBeNull();
  });
});

describe("getActualKeyInfos のスペース処理", () => {
  it("スペース文字は Space キーとして解決し、バッジラベルも Space になる（空バッジにならない）", () => {
    const infos = getActualKeyInfos(" s ", REMAPS);
    expect(infos).toHaveLength(3);
    expect(infos[0].keyCode).toBe("Space");
    expect(infos[0].displayLabel).toBe("Space");
    expect(infos[1].displayLabel).toBe("S");
    expect(infos[2].keyCode).toBe("Space");
    expect(infos[2].displayLabel).toBe("Space");
  });

  it("Space が変換元のリマップも Space ラベルで表示する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "Space", targetKey: "KeyB" }];
    const infos = getActualKeyInfos("b", remaps);
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
    const infos = getActualKeyInfos("hm", LAYERED_REMAPS);
    expect(infos.map((i) => i.keyCode)).toEqual(["KeyE", "KeyW"]);
    expect(infos.map((i) => i.displayLabel)).toEqual(["E", "W"]);
    expect(infos.every((i) => !i.needsShift)).toBe(true);
  });

  it("配列の並び順に関係なく修飾キーなしのソースが勝つ", () => {
    const reversed = [...LAYERED_REMAPS].reverse();
    const infos = getActualKeyInfos("hm", reversed);
    expect(infos.map((i) => i.keyCode)).toEqual(["KeyE", "KeyW"]);
  });

  it("修飾キー付きしかない文字は従来どおり修飾キー付きで解決する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "Shift+KeyS", targetKey: "KeyH" }];
    const infos = getActualKeyInfos("h", remaps);
    expect(infos[0].keyCode).toBe("Shift+KeyS");
    expect(infos[0].displayLabel).toBe("⇧+S");
  });

  it("shiftHeld 時は Shift+X 完全一致で逆引きする（HM → W, E）", () => {
    const infos = getActualKeyInfos("HM", LAYERED_REMAPS, { shiftHeld: true });
    expect(infos.map((i) => i.keyCode)).toEqual(["KeyW", "KeyE"]);
    expect(infos.map((i) => i.displayLabel)).toEqual(["W", "E"]);
  });
});

describe("getActualKeyInfos の shiftHeld モード（Shiftを押しながらクラフト）", () => {
  it("英字ターゲットのリマップは通常時と同じキーに解決する（大文字小文字は区別しない）", () => {
    const infos = getActualKeyInfos("e", REMAPS, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("Semicolon");
    expect(infos[0].isRemapped).toBe(true);
    expect(infos[0].needsShift).toBe(false);
  });

  it("記号ターゲットのリマップはシフト後の文字を優先して逆引きする", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyA", targetKey: "Semicolon" }];
    // Shift 押下中に A を押すと ":" が出力される
    const infos = getActualKeyInfos(":", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("KeyA");
    expect(infos[0].isRemapped).toBe(true);
    expect(infos[0].displayLabel).toBe("A");
    expect(infos[0].needsShift).toBe(false);
  });

  it("Shift+X ソースの完全一致リマップは X 単独のバッジになる（⇧ なし）", () => {
    // 通常時は ⇧+W だが、Shift 押しっぱなしなので W だけ押せばよい
    const normal = getActualKeyInfos("a", REMAPS);
    expect(normal[0].displayLabel).toBe("⇧+W");
    expect(normal[0].needsShift).toBe(true);

    const shifted = getActualKeyInfos("a", REMAPS, { shiftHeld: true });
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
    expect(getActualKeyInfos("e", remaps, { shiftHeld: true })[0].keyCode).toBe("KeyK");
    // ":" は K では出せないため、非リマップの Semicolon キーに解決する
    expect(getActualKeyInfos(":", remaps, { shiftHeld: true })[0].keyCode).toBe("Semicolon");
  });

  it("文字出力ターゲットは Shift の影響を受けずそのまま逆引きする", () => {
    const infos = getActualKeyInfos("-", REMAPS, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("Slash");
    expect(infos[0].isRemapped).toBe(true);
  });

  it("非リマップのシフト記号は物理キーに逆引きする", () => {
    const infos = getActualKeyInfos("_", REMAPS, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("Minus");
    expect(infos[0].isRemapped).toBe(false);
    expect(infos[0].needsShift).toBe(false);
  });

  it("非リマップの英字・スペースは基底キーのまま解決する", () => {
    const infos = getActualKeyInfos("b ", REMAPS, { shiftHeld: true });
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
    const infos = getActualKeyInfos("e", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("KeyE");
    expect(infos[0].isRemapped).toBe(false);
  });

  it("shiftHeld では Shift 込みで無効化されたキーに解決しない", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyK", targetKey: "Semicolon" },
      { sourceKey: "Shift+KeyK", targetKey: null },
    ];
    // Shift押下中の K は無効化されており何も出力しない
    const infos = getActualKeyInfos(";", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).not.toBe("KeyK");
  });

  it("shiftHeld では Ctrl 組み合わせリマップにフォールバックしない", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "Ctrl+KeyC", targetKey: "KeyE" }];
    const infos = getActualKeyInfos("e", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).toBe("KeyE");
    expect(infos[0].isRemapped).toBe(false);
  });

  it("シフト記号の逆引き先キー自体がリマップ済みの場合は使わない", () => {
    // Shift+Slash はリマップ（Slash→"-"）により "-" を出すため、"?" を Slash に解決してはいけない
    const remaps: RemapInfo[] = [{ sourceKey: "Slash", targetKey: "-" }];
    const infos = getActualKeyInfos("?", remaps, { shiftHeld: true });
    expect(infos[0].keyCode).not.toBe("Slash");
  });

  it("shiftHeld で逆引きしたキーを Shift 込みで順方向適用すると元の文字に戻る", () => {
    const remaps: RemapInfo[] = [
      { sourceKey: "KeyA", targetKey: "Semicolon" },
      { sourceKey: "Shift+KeyW", targetKey: "KeyA" },
    ];
    const searchStr = "a: e_";
    const infos = getActualKeyInfos(searchStr, remaps, { shiftHeld: true });
    const roundTrip = infos
      .map((info) => {
        const combo = info.keyCode.includes("+") ? info.keyCode : `Shift+${info.keyCode}`;
        return simulateRemapOutput(combo, remaps).output;
      })
      .join("");
    expect(roundTrip.toLowerCase()).toBe(searchStr.toLowerCase());
  });
});

describe("simulateRemapOutput と getActualKeyInfos の整合性", () => {
  it("逆引きで得たキーを順方向に適用すると元の文字に戻る", () => {
    const searchStr = "sea";
    const keyInfos = getActualKeyInfos(searchStr, REMAPS);
    const roundTrip = keyInfos
      .map((info) => simulateRemapOutput(info.keyCode, REMAPS).output)
      .join("");
    expect(roundTrip).toBe(searchStr);
  });

  it("先頭・末尾スペースを含む文字列も逆引き→順方向で元に戻る", () => {
    const searchStr = " sea ";
    const keyInfos = getActualKeyInfos(searchStr, REMAPS);
    const roundTrip = keyInfos
      .map((info) => simulateRemapOutput(info.keyCode, REMAPS).output)
      .join("");
    expect(roundTrip).toBe(searchStr);
  });
});
