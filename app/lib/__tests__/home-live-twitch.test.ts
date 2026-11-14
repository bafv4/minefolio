import { describe, expect, it } from "vitest";
import { countLiveStages, isMinecraftStream, liveEntrySplit, pickTwitchOnlyStreams, twitchLoginFromUrl } from "../home-live";
import type { PaceManLiveRun } from "../paceman";

function s(login: string, slug: string, game: { game_id?: string; game_name?: string } = { game_id: "27471" }) {
  return { stream: { user_login: login, ...game }, slug };
}

describe("isMinecraftStream", () => {
  it("game_id か game_name のどちらかが一致すれば true", () => {
    expect(isMinecraftStream({ game_id: "27471" })).toBe(true);
    expect(isMinecraftStream({ game_name: "Minecraft" })).toBe(true);
    expect(isMinecraftStream({ game_id: "509658", game_name: "Just Chatting" })).toBe(false);
    expect(isMinecraftStream({})).toBe(false);
  });
});

describe("twitchLoginFromUrl", () => {
  it("Twitch URL からログイン名を小文字で返す", () => {
    expect(twitchLoginFromUrl("https://www.twitch.tv/FooBar")).toBe("foobar");
    expect(twitchLoginFromUrl("https://twitch.tv/foo/videos")).toBe("foo");
  });
  it("Twitch 以外・空・不正は null", () => {
    expect(twitchLoginFromUrl("https://example.com/foo")).toBeNull();
    expect(twitchLoginFromUrl("https://www.twitch.tv/")).toBeNull();
    expect(twitchLoginFromUrl(null)).toBeNull();
    expect(twitchLoginFromUrl("not a url")).toBeNull();
  });
});

describe("pickTwitchOnlyStreams", () => {
  const none = { slugs: [], logins: [] };

  it("Minecraft 以外のカテゴリを除く", () => {
    const list = [s("a", "a"), s("b", "b", { game_id: "509658", game_name: "Just Chatting" }), s("c", "c", { game_name: "Minecraft" })];
    expect(pickTwitchOnlyStreams(list, none).map((x) => x.slug)).toEqual(["a", "c"]);
  });

  it("PaceMan / Ranked に出ている slug を除く", () => {
    const list = [s("a", "a"), s("b", "b")];
    expect(pickTwitchOnlyStreams(list, { slugs: ["b", undefined], logins: [] }).map((x) => x.slug)).toEqual(["a"]);
  });

  it("Twitch ログイン名で照合して除く（大文字小文字を区別しない）", () => {
    const list = [s("Alpha", "a"), s("beta", "b")];
    expect(pickTwitchOnlyStreams(list, { slugs: [], logins: ["ALPHA", null] }).map((x) => x.slug)).toEqual(["b"]);
  });

  it("slug が空の配信は slug では除かず、ログイン名のみで照合する", () => {
    const list = [s("a", ""), s("b", "")];
    expect(pickTwitchOnlyStreams(list, { slugs: [""], logins: ["b"] }).map((x) => x.stream.user_login)).toEqual(["a"]);
  });

  it("入力の並びを保つ", () => {
    const list = [s("c", "c"), s("a", "a"), s("b", "b")];
    expect(pickTwitchOnlyStreams(list, none).map((x) => x.slug)).toEqual(["c", "a", "b"]);
  });
});

describe("liveEntrySplit / countLiveStages", () => {
  const pace = (...eventIds: string[]) => ({
    kind: "pace" as const,
    run: { eventList: eventIds.map((eventId) => ({ eventId, rta: 1, igt: 1 })) } as unknown as PaceManLiveRun,
  });
  const ranked = (split: string | null) => ({
    kind: "ranked" as const,
    match: { progress: split ? { stage: 1, split, timeMs: 1 } : null },
  });

  it("ペースは最新スプリット、Ranked は最新到達区間から段を返す", () => {
    expect(liveEntrySplit(pace("rsg.enter_nether", "rsg.enter_bastion"))).toEqual({ split: "Bastion", stage: 2 });
    expect(liveEntrySplit(ranked("Enter End"))).toEqual({ split: "Enter End", stage: 6 });
  });
  it("区間の無い項目（配信だけ・progress なし・イベントなし）は null", () => {
    expect(liveEntrySplit({ kind: "twitch" })).toBeNull();
    expect(liveEntrySplit(ranked(null))).toBeNull();
    expect(liveEntrySplit(pace())).toBeNull();
  });
  it("段ごとの人数を数える（7要素・区間の無い項目は数えない）", () => {
    const counts = countLiveStages([pace("rsg.enter_nether"), ranked("Enter Nether"), ranked("Bastion"), { kind: "twitch" }]);
    expect(counts).toEqual([2, 1, 0, 0, 0, 0, 0]);
  });
});
