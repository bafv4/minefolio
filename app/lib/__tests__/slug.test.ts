import { describe, it, expect } from "vitest";
import {
  generateSlug,
  isGeneratedSlug,
  getDisplayName,
  getLocalizedDisplayName,
  getMentionDisplay,
  pickDisplayName,
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

describe("pickDisplayName", () => {
  const user = { displayName: "ドリーム", displayNameAlphabet: "Dream JP" };

  it("ja ではアルファベット表記があっても displayName を返す", () => {
    expect(pickDisplayName(user, "ja")).toBe("ドリーム");
  });

  it("en ではアルファベット表記を優先する", () => {
    expect(pickDisplayName(user, "en")).toBe("Dream JP");
  });

  it("en でもアルファベット表記が未入力なら displayName にフォールバックする", () => {
    expect(pickDisplayName({ displayName: "ドリーム", displayNameAlphabet: null }, "en")).toBe("ドリーム");
    expect(pickDisplayName({ displayName: "ドリーム", displayNameAlphabet: "" }, "en")).toBe("ドリーム");
  });

  it("クエリで displayNameAlphabet を選んでいない（undefined）場合も落ちない", () => {
    expect(pickDisplayName({ displayName: "ドリーム" }, "en")).toBe("ドリーム");
  });

  it("displayName も無ければ null を返す（mcid/slug へのフォールバックは呼び出し側）", () => {
    expect(pickDisplayName({ displayName: null, displayNameAlphabet: null }, "ja")).toBeNull();
  });
});

describe("getLocalizedDisplayName", () => {
  it("en ではアルファベット表記 > displayName > mcid > slug の順で解決する", () => {
    const base = { mcid: "Dream", slug: "Dream" };
    expect(
      getLocalizedDisplayName({ ...base, displayName: "ドリーム", displayNameAlphabet: "Dream JP" }, "en"),
    ).toBe("Dream JP");
    expect(
      getLocalizedDisplayName({ ...base, displayName: "ドリーム", displayNameAlphabet: null }, "en"),
    ).toBe("ドリーム");
    expect(
      getLocalizedDisplayName({ ...base, displayName: null, displayNameAlphabet: null }, "en"),
    ).toBe("Dream");
    expect(
      getLocalizedDisplayName({ mcid: null, slug: "@123", displayName: null, displayNameAlphabet: null }, "en"),
    ).toBe("@123");
  });

  it("ja ではアルファベット表記を使わない", () => {
    expect(
      getLocalizedDisplayName(
        { mcid: "Dream", slug: "Dream", displayName: "ドリーム", displayNameAlphabet: "Dream JP" },
        "ja",
      ),
    ).toBe("ドリーム");
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
