// /me/edit の下書き（draft）の純関数: dirty 判定・差分生成・並び替え・speedrun.com 連動。
import { describe, it, expect } from "vitest";
import {
  buildProfileChanges,
  buildProfileDraft,
  hasProfileChanges,
  moveDraftVideo,
  newDraftKey,
  resolveSpeedrunUsernameForSave,
  speedrunLinkIdentifier,
  type ProfileDraft,
} from "@/lib/profile-edit-draft";
import { SOCIAL_PLATFORMS } from "@/lib/profile-edit-validation";
import { socialLinks } from "@/lib/schema";

function base(): ProfileDraft {
  return buildProfileDraft({
    user: { mcid: "Runner", uuid: "uuid-1", bedrockMcid: null },
    links: [
      { id: "l1", platform: "twitch", identifier: "tw", customLabel: null, customUrl: null },
      { id: "l2", platform: "custom", identifier: "me", customLabel: "Blog", customUrl: "https://example.com" },
    ],
    videos: [
      { id: "v1", url: "https://youtu.be/aaaaaaaaaaa", title: "A", isPinned: false },
      { id: "v2", url: "https://youtu.be/bbbbbbbbbbb", title: null, isPinned: true },
      { id: "v3", url: "https://youtu.be/ccccccccccc", title: "C", isPinned: false },
    ],
  });
}

describe("buildProfileChanges / hasProfileChanges", () => {
  it("下書きが保存済みと同じなら差分なし（dirty ではない）", () => {
    const saved = base();
    expect(buildProfileChanges(saved, structuredClone(saved))).toEqual({});
    expect(hasProfileChanges(saved, structuredClone(saved))).toBe(false);
  });

  it("前後の空白だけの違いは差分にしない", () => {
    const saved = base();
    const draft = structuredClone(saved);
    draft.links[0].identifier = "  tw  ";
    draft.videos[0].title = " A ";
    expect(hasProfileChanges(saved, draft)).toBe(false);
  });

  it("MCID の set / remove / 元に戻す", () => {
    const saved = base();
    const changed = structuredClone(saved);
    changed.mcid = { value: "Other", uuid: "uuid-2" };
    expect(buildProfileChanges(saved, changed).mcid).toEqual({ op: "set", value: "Other" });

    changed.mcid = { value: null, uuid: null };
    expect(buildProfileChanges(saved, changed).mcid).toEqual({ op: "remove" });

    changed.mcid = saved.mcid;
    expect(buildProfileChanges(saved, changed).mcid).toBeUndefined();
  });

  it("Bedrock MCID の set / remove", () => {
    const saved = base();
    const draft = structuredClone(saved);
    draft.bedrockMcid = "Tag#1234";
    expect(buildProfileChanges(saved, draft).bedrockMcid).toEqual({ op: "set", value: "Tag#1234" });

    const saved2 = { ...saved, bedrockMcid: "Old" };
    expect(buildProfileChanges(saved2, { ...saved2, bedrockMcid: null }).bedrockMcid).toEqual({ op: "remove" });
  });

  it("リンクの追加（一時キー）・更新・削除を振り分ける。サーバーの id として一時キーは使わない", () => {
    const saved = base();
    const draft = structuredClone(saved);
    draft.links[0].identifier = "tw2"; // update
    draft.links.splice(1, 1); // delete l2
    draft.links.push({ key: "new-x", id: null, platform: "youtube", identifier: "yt", customLabel: "", customUrl: "" });

    const links = buildProfileChanges(saved, draft).links;
    expect(links?.update).toEqual([
      { id: "l1", platform: "twitch", identifier: "tw2", customLabel: null, customUrl: null },
    ]);
    expect(links?.delete).toEqual(["l2"]);
    expect(links?.create).toEqual([
      { key: "new-x", platform: "youtube", identifier: "yt", customLabel: null, customUrl: null },
    ]);
  });

  it("カスタム以外では customLabel/customUrl を差分比較・送信の対象にしない", () => {
    const saved = base();
    const draft = structuredClone(saved);
    draft.links[0].customLabel = "stale"; // twitch に残った古い値
    expect(hasProfileChanges(saved, draft)).toBe(false);
  });

  it("動画の並び替えのみでも差分になり、order に最終順が入る", () => {
    const saved = base();
    const draft = structuredClone(saved);
    draft.videos = moveDraftVideo(draft.videos, "v3", "up");

    const videos = buildProfileChanges(saved, draft).videos;
    expect(videos?.order).toEqual(["v1", "v3", "v2"]);
    expect(videos?.create).toBeUndefined();
    expect(videos?.update).toBeUndefined();
    expect(videos?.delete).toBeUndefined();
  });

  it("動画: 削除だけなら、残りの相対順は変わっていないので並び替え扱いにならないが delete は出る", () => {
    const saved = base();
    const draft = structuredClone(saved);
    draft.videos.splice(1, 1);

    const videos = buildProfileChanges(saved, draft).videos;
    expect(videos?.delete).toEqual(["v2"]);
    expect(videos?.order).toEqual(["v1", "v3"]);
  });

  it("動画: 新規は order に `new:<key>` で載る", () => {
    const saved = base();
    const draft = structuredClone(saved);
    draft.videos.unshift({ key: "new-k", id: null, url: "https://youtu.be/ddddddddddd", title: "", isPinned: false });

    const videos = buildProfileChanges(saved, draft).videos;
    expect(videos?.create).toEqual([
      { key: "new-k", url: "https://youtu.be/ddddddddddd", title: null, isPinned: false },
    ]);
    expect(videos?.order).toEqual(["new:new-k", "v1", "v2", "v3"]);
  });

  it("追加してから削除した（保存前に取り消した）項目は差分に残らない", () => {
    const saved = base();
    const draft = structuredClone(saved);
    draft.videos.push({ key: "new-t", id: null, url: "https://youtu.be/eeeeeeeeeee", title: "", isPinned: false });
    draft.videos = draft.videos.filter((v) => v.key !== "new-t");
    expect(hasProfileChanges(saved, draft)).toBe(false);
  });
});

describe("moveDraftVideo", () => {
  it("範囲外・未登録のキーは元の配列を返す", () => {
    const { videos } = base();
    expect(moveDraftVideo(videos, "v1", "up")).toBe(videos);
    expect(moveDraftVideo(videos, "v3", "down")).toBe(videos);
    expect(moveDraftVideo(videos, "nope", "up")).toBe(videos);
  });

  it("元の配列を破壊せず隣と入れ替える", () => {
    const { videos } = base();
    const moved = moveDraftVideo(videos, "v1", "down");
    expect(moved.map((v) => v.key)).toEqual(["v2", "v1", "v3"]);
    expect(videos.map((v) => v.key)).toEqual(["v1", "v2", "v3"]);
  });
});

describe("その他", () => {
  it("newDraftKey は呼ぶたびに異なる new- 接頭辞のキー", () => {
    const a = newDraftKey();
    expect(a.startsWith("new-")).toBe(true);
    expect(newDraftKey()).not.toBe(a);
  });

  it("speedrunLinkIdentifier は speedrun.com リンクの識別子（無ければ null）", () => {
    const d = base();
    expect(speedrunLinkIdentifier(d.links)).toBeNull();
    d.links.push({ key: "s", id: null, platform: "speedruncom", identifier: " Name ", customLabel: "", customUrl: "" });
    expect(speedrunLinkIdentifier(d.links)).toBe("Name");
  });

  it("クライアント側のプラットフォーム一覧が schema の enum と一致する", () => {
    expect([...SOCIAL_PLATFORMS]).toEqual([...socialLinks.platform.enumValues]);
  });
});

describe("resolveSpeedrunUsernameForSave", () => {
  function withSr() {
    const saved = base();
    saved.links.push({ key: "sr", id: "sr", platform: "speedruncom", identifier: "A", customLabel: "", customUrl: "" });
    return saved;
  }

  it("speedrun.com リンクを変えたら、フォームの手入力値ではなくリンクの下書きの値を使う", () => {
    const saved = withSr();
    const draft = structuredClone(saved);
    draft.links.find((l) => l.key === "sr")!.identifier = "B";
    expect(resolveSpeedrunUsernameForSave(saved, draft, "C")).toBe("B");
  });

  it("speedrun.com リンクを削除したら空文字、作成したらその identifier", () => {
    const saved = withSr();
    const removed = structuredClone(saved);
    removed.links = removed.links.filter((l) => l.key !== "sr");
    expect(resolveSpeedrunUsernameForSave(saved, removed, "A")).toBe("");

    const plain = base();
    const created = structuredClone(plain);
    created.links.push({ key: "new-s", id: null, platform: "speedruncom", identifier: "New", customLabel: "", customUrl: "" });
    expect(resolveSpeedrunUsernameForSave(plain, created, "x")).toBe("New");
  });

  it("speedrun.com に関わらない変更・変更なしならフォームの値のまま", () => {
    const saved = withSr();
    const draft = structuredClone(saved);
    draft.links.find((l) => l.key === "l1")!.identifier = "tw2";
    expect(resolveSpeedrunUsernameForSave(saved, draft, "C")).toBe("C");
    expect(resolveSpeedrunUsernameForSave(saved, structuredClone(saved), "C")).toBe("C");
  });
});
