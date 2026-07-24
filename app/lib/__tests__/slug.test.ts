import { describe, it, expect } from "vitest";
import {
  generateSlug,
  isGeneratedSlug,
  getDisplayName,
  getMentionDisplay,
} from "../slug";

describe("generateSlug", () => {
  it("MCID がある場合は MCID をそのまま slug にする", () => {
    expect(generateSlug("Dream", "123456789")).toBe("Dream");
  });

  it("MCID が null の場合は @{discordId} を返す", () => {
    expect(generateSlug(null, "123456789")).toBe("@123456789");
  });

  it("MCID が空文字（falsy）の場合も @{discordId} を返す", () => {
    expect(generateSlug("", "999")).toBe("@999");
  });
});

describe("isGeneratedSlug", () => {
  it("@ プレフィックス付き（MCID 未登録）は自動生成と判定する", () => {
    expect(isGeneratedSlug("@123456789")).toBe(true);
  });

  it("MCID そのままの slug は自動生成ではない", () => {
    expect(isGeneratedSlug("Dream")).toBe(false);
  });
});

describe("getDisplayName", () => {
  it("displayName があれば最優先で返す", () => {
    expect(getDisplayName("ドリーム", "Dream", "Dream")).toBe("ドリーム");
  });

  it("displayName が null なら mcid を返す", () => {
    expect(getDisplayName(null, "Dream", "@123")).toBe("Dream");
  });

  it("displayName・mcid がどちらも null/空なら slug を返す", () => {
    expect(getDisplayName(null, null, "@123")).toBe("@123");
    expect(getDisplayName("", "", "@123")).toBe("@123");
  });
});

describe("getMentionDisplay", () => {
  it("MCID があれば @{mcid} を返す", () => {
    expect(getMentionDisplay("Dream", "Dream")).toBe("@Dream");
  });

  it("MCID が null なら slug（既に @ 付き）をそのまま返す", () => {
    expect(getMentionDisplay(null, "@123456789")).toBe("@123456789");
  });
});
