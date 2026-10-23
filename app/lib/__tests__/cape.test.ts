// resolveCapeProps（マント表示の props 解決）の回帰テスト。
// 優先順位: customCapeUrl → uuid（/api/cape 経由）→ なし。capeDisplay は出所に関係なく適用する。
import { describe, it, expect } from "vitest";
import { CAPE_DISPLAY_OPTIONS, resolveCapeProps } from "../cape";

const CUSTOM_URL = "https://store123.public.blob.vercel-storage.com/capes/u1/cape-abc.png";
const UUID = "0123456789abcdef0123456789abcdef";
const MOJANG_CAPE_URL = `/api/cape?uuid=${UUID}`;

describe("resolveCapeProps - 出所の優先順位", () => {
  it("customCapeUrl があればそれを使う", () => {
    expect(resolveCapeProps({ customCapeUrl: CUSTOM_URL })).toEqual({
      capeUrl: CUSTOM_URL,
      backEquipment: "cape",
    });
  });

  it("customCapeUrl が無く uuid があれば /api/cape?uuid=... を使う", () => {
    expect(resolveCapeProps({ uuid: UUID })).toEqual({
      capeUrl: MOJANG_CAPE_URL,
      backEquipment: "cape",
    });
  });

  it("uuid と customCapeUrl の両方があればカスタム側が優先される", () => {
    const result = resolveCapeProps({ uuid: UUID, customCapeUrl: CUSTOM_URL });
    expect(result.capeUrl).toBe(CUSTOM_URL);
  });

  it("どちらも無ければ {}（マント無し）", () => {
    expect(resolveCapeProps({})).toEqual({});
    expect(resolveCapeProps({ uuid: null, customCapeUrl: null })).toEqual({});
  });

  it("空文字は未設定として扱う", () => {
    expect(resolveCapeProps({ uuid: "", customCapeUrl: "" })).toEqual({});
    expect(resolveCapeProps({ uuid: UUID, customCapeUrl: "" }).capeUrl).toBe(MOJANG_CAPE_URL);
  });

  it("uuid は URL エンコードされる", () => {
    expect(resolveCapeProps({ uuid: "a b&c" }).capeUrl).toBe("/api/cape?uuid=a%20b%26c");
  });
});

describe("resolveCapeProps - capeDisplay", () => {
  it("hidden なら出所があっても {}", () => {
    expect(resolveCapeProps({ uuid: UUID, customCapeUrl: CUSTOM_URL, capeDisplay: "hidden" })).toEqual({});
    expect(resolveCapeProps({ uuid: UUID, capeDisplay: "hidden" })).toEqual({});
  });

  it("elytra なら同じテクスチャで backEquipment が elytra（カスタム）", () => {
    expect(resolveCapeProps({ customCapeUrl: CUSTOM_URL, capeDisplay: "elytra" })).toEqual({
      capeUrl: CUSTOM_URL,
      backEquipment: "elytra",
    });
  });

  it("elytra なら同じテクスチャで backEquipment が elytra（Mojang）", () => {
    expect(resolveCapeProps({ uuid: UUID, capeDisplay: "elytra" })).toEqual({
      capeUrl: MOJANG_CAPE_URL,
      backEquipment: "elytra",
    });
  });

  it.each([
    ["cape", "cape"],
    ["null", null],
    ["undefined", undefined],
  ])("capeDisplay=%s は cape 扱い", (_label, capeDisplay) => {
    expect(resolveCapeProps({ uuid: UUID, capeDisplay }).backEquipment).toBe("cape");
  });

  it("未知の値も cape 扱いにフォールバックする（hidden / elytra 以外）", () => {
    expect(resolveCapeProps({ uuid: UUID, capeDisplay: "unknown" }).backEquipment).toBe("cape");
  });

  it("出所が無ければ elytra でも {}", () => {
    expect(resolveCapeProps({ capeDisplay: "elytra" })).toEqual({});
  });
});

describe("CAPE_DISPLAY_OPTIONS", () => {
  it("UI の並び順は cape / elytra / hidden", () => {
    expect([...CAPE_DISPLAY_OPTIONS]).toEqual(["cape", "elytra", "hidden"]);
  });
});
