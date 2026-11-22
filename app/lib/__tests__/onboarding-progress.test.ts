// 初期設定ウィザードの再開位置の推定（estimateOnboardingResumeStep）。
// 規則は onboarding-progress.ts の JSDoc: 入力の痕跡がある最も後のステップの「次」から再開する。
import { describe, it, expect } from "vitest";
import {
  estimateOnboardingResumeStep,
  ONBOARDING_LINK_PLATFORMS,
  ONBOARDING_TOTAL_STEPS,
  type OnboardingProgressInput,
} from "../onboarding-progress";

const DISCORD_NAME = "Runner";

/** 「はじめる」直後の状態（表示名には Discord の表示名が入っている） */
function fresh(overrides: Partial<OnboardingProgressInput> = {}): OnboardingProgressInput {
  return {
    displayName: DISCORD_NAME,
    shortBio: null,
    bio: null,
    location: null,
    pronouns: null,
    mcid: null,
    bedrockMcid: null,
    customSkinUrl: null,
    customCapeUrl: null,
    linkPlatforms: [],
    ...overrides,
  };
}

describe("estimateOnboardingResumeStep", () => {
  it("何も入力していなければ最初のステップ", () => {
    expect(estimateOnboardingResumeStep(fresh(), DISCORD_NAME)).toBe(1);
    expect(estimateOnboardingResumeStep(fresh({ displayName: null }), DISCORD_NAME)).toBe(1);
  });

  it.each<[string, Partial<OnboardingProgressInput>, string | null | undefined, number]>([
    // ステップ1（プロフィール）の痕跡 → 2
    ["表示名が Discord の表示名と違う", { displayName: "別の名前" }, DISCORD_NAME, 2],
    ["Discord の表示名が無く、表示名がある", { displayName: "Runner" }, null, 2],
    ["Discord の表示名が undefined で、表示名がある", { displayName: "Runner" }, undefined, 2],
    ["ひとこと", { shortBio: "よろしく" }, DISCORD_NAME, 2],
    ["自己紹介", { bio: "自己紹介" }, DISCORD_NAME, 2],
    ["所在地", { location: "Tokyo" }, DISCORD_NAME, 2],
    ["代名詞", { pronouns: "he/him" }, DISCORD_NAME, 2],
    // ステップ2（Minecraft）の痕跡 → 3
    ["Java版 MCID", { mcid: "Steve" }, DISCORD_NAME, 3],
    ["Bedrock版 MCID", { bedrockMcid: "Gamertag" }, DISCORD_NAME, 3],
    // ステップ3（スキン）の痕跡 → 4
    ["カスタムスキン", { customSkinUrl: "https://example.com/skin.png" }, DISCORD_NAME, 4],
    ["カスタムマント", { customCapeUrl: "https://example.com/cape.png" }, DISCORD_NAME, 4],
    // ステップ4（連携）の痕跡 → 5
    ...ONBOARDING_LINK_PLATFORMS.map(
      (platform) =>
        [`連携リンク（${platform}）`, { linkPlatforms: [platform] }, DISCORD_NAME, 5] as [
          string,
          Partial<OnboardingProgressInput>,
          string,
          number,
        ],
    ),
  ])("%s があれば、その次のステップ", (_label, overrides, discordName, expected) => {
    expect(estimateOnboardingResumeStep(fresh(overrides), discordName)).toBe(expected);
  });

  it.each<[string, Partial<OnboardingProgressInput>, string | null]>([
    ["表示名が Discord の表示名と同じ", { displayName: DISCORD_NAME }, DISCORD_NAME],
    ["前後の空白だけ違う表示名", { displayName: `  ${DISCORD_NAME} ` }, ` ${DISCORD_NAME}`],
    ["空白だけの表示名（Discord 名なし）", { displayName: "   " }, null],
    ["空白だけのひとこと・自己紹介・所在地・代名詞", { shortBio: " ", bio: "\n", location: "\t", pronouns: "  " }, DISCORD_NAME],
    ["空白だけの MCID", { mcid: "  ", bedrockMcid: " " }, DISCORD_NAME],
    ["空白だけのスキン・マント", { customSkinUrl: " ", customCapeUrl: " " }, DISCORD_NAME],
    ["連携ステップで扱わないプラットフォームのリンク", { linkPlatforms: ["discord", "other"] }, DISCORD_NAME],
  ])("%s は痕跡に数えない", (_label, overrides, discordName) => {
    expect(estimateOnboardingResumeStep(fresh(overrides), discordName)).toBe(1);
  });

  it("途中を飛ばしても、痕跡がある最も後のステップの次から再開する", () => {
    // ステップ1・2 を空のまま進み、ステップ3 でスキンだけ入れた
    expect(
      estimateOnboardingResumeStep(fresh({ customSkinUrl: "https://example.com/skin.png" }), DISCORD_NAME),
    ).toBe(4);
    // ステップ1 だけ入れて、ステップ2〜 を飛ばしリンクを入れた
    expect(
      estimateOnboardingResumeStep(fresh({ shortBio: "hi", linkPlatforms: ["twitch"] }), DISCORD_NAME),
    ).toBe(5);
  });

  it("全部入力済みなら最後のステップ（公開範囲）", () => {
    const all = fresh({
      displayName: "別の名前",
      shortBio: "hi",
      bio: "bio",
      location: "Tokyo",
      pronouns: "they",
      mcid: "Steve",
      bedrockMcid: "Gamertag",
      customSkinUrl: "https://example.com/skin.png",
      customCapeUrl: "https://example.com/cape.png",
      linkPlatforms: [...ONBOARDING_LINK_PLATFORMS],
    });
    expect(estimateOnboardingResumeStep(all, DISCORD_NAME)).toBe(ONBOARDING_TOTAL_STEPS);
    expect(ONBOARDING_TOTAL_STEPS).toBe(5);
  });
});
