// /me/edit の「保存バーでの一括保存」で使う下書き（draft）の純関数群。
// MCID・リンク・動画は、保存バーを押すまでクライアントの下書きにだけ持ち、保存時に差分（ProfileChanges）として
// action へ1リクエストで送る。dirty 判定・差分生成・並び替えをここに集約し、コンポーネントから切り離してテストできるようにする。
import {
  NEW_VIDEO_ORDER_PREFIX,
  type LinkPayload,
  type ProfileChanges,
} from "@/lib/profile-edit-validation";

export type DraftLink = {
  /** ドラフト内の識別子。既存は id と同じ、新規はクライアント採番（サーバーの id としては使わない） */
  key: string;
  /** 既存リンクの id。未保存の新規は null */
  id: string | null;
  platform: string;
  identifier: string;
  customLabel: string;
  customUrl: string;
};

export type DraftVideo = {
  key: string;
  id: string | null;
  url: string;
  title: string;
  isPinned: boolean;
};

export type ProfileDraft = {
  /** Java 版 MCID。uuid は照合済みプレビュー用（保存時はサーバーが再照合する） */
  mcid: { value: string | null; uuid: string | null };
  bedrockMcid: string | null;
  links: DraftLink[];
  /** 配列順がそのまま表示順（保存時に displayOrder へ反映） */
  videos: DraftVideo[];
};

type SourceUser = { mcid: string | null; uuid: string | null; bedrockMcid: string | null };
type SourceLink = {
  id: string;
  platform: string;
  identifier: string;
  customLabel: string | null;
  customUrl: string | null;
};
type SourceVideo = { id: string; url: string; title: string | null; isPinned: boolean };

/** loader のデータから下書き（＝保存済み状態）を作る。videos は表示順に並んでいる前提 */
export function buildProfileDraft({
  user,
  links,
  videos,
}: {
  user: SourceUser;
  links: SourceLink[];
  videos: SourceVideo[];
}): ProfileDraft {
  return {
    mcid: { value: user.mcid, uuid: user.uuid },
    bedrockMcid: user.bedrockMcid,
    links: links.map((l) => ({
      key: l.id,
      id: l.id,
      platform: l.platform,
      identifier: l.identifier,
      customLabel: l.customLabel ?? "",
      customUrl: l.customUrl ?? "",
    })),
    videos: videos.map((v) => ({
      key: v.id,
      id: v.id,
      url: v.url,
      title: v.title ?? "",
      isPinned: v.isPinned,
    })),
  };
}

/** 新規項目のクライアント側キー（サーバーの id としては使われない） */
export function newDraftKey(): string {
  return `new-${globalThis.crypto.randomUUID()}`;
}

function linkPayload(l: DraftLink): LinkPayload {
  const custom = l.platform === "custom";
  return {
    platform: l.platform,
    identifier: l.identifier.trim(),
    customLabel: custom ? l.customLabel.trim() || null : null,
    customUrl: custom ? l.customUrl.trim() || null : null,
  };
}

function videoPayload(v: DraftVideo) {
  return { url: v.url.trim(), title: v.title.trim() || null, isPinned: v.isPinned };
}

/** 保存済み（saved）と下書き（draft）の差分。差分が無ければ空オブジェクト */
export function buildProfileChanges(saved: ProfileDraft, draft: ProfileDraft): ProfileChanges {
  const changes: ProfileChanges = {};

  if (draft.mcid.value !== saved.mcid.value) {
    changes.mcid = draft.mcid.value === null ? { op: "remove" } : { op: "set", value: draft.mcid.value };
  }
  if (draft.bedrockMcid !== saved.bedrockMcid) {
    changes.bedrockMcid =
      draft.bedrockMcid === null ? { op: "remove" } : { op: "set", value: draft.bedrockMcid };
  }

  // リンク
  const savedLinks = new Map(saved.links.map((l) => [l.id, l]));
  const draftLinkIds = new Set(draft.links.map((l) => l.id).filter((id): id is string => id !== null));
  const linkCreate = draft.links.filter((l) => l.id === null).map((l) => ({ key: l.key, ...linkPayload(l) }));
  const linkUpdate = draft.links
    .filter((l) => {
      if (l.id === null) return false;
      const before = savedLinks.get(l.id);
      return !before || JSON.stringify(linkPayload(before)) !== JSON.stringify(linkPayload(l));
    })
    .map((l) => ({ id: l.id as string, ...linkPayload(l) }));
  const linkDelete = saved.links.map((l) => l.id).filter((id): id is string => id !== null && !draftLinkIds.has(id));
  if (linkCreate.length || linkUpdate.length || linkDelete.length) {
    changes.links = {
      ...(linkCreate.length ? { create: linkCreate } : {}),
      ...(linkUpdate.length ? { update: linkUpdate } : {}),
      ...(linkDelete.length ? { delete: linkDelete } : {}),
    };
  }

  // 動画
  const savedVideos = new Map(saved.videos.map((v) => [v.id, v]));
  const draftVideoIds = new Set(draft.videos.map((v) => v.id).filter((id): id is string => id !== null));
  const videoCreate = draft.videos.filter((v) => v.id === null).map((v) => ({ key: v.key, ...videoPayload(v) }));
  const videoUpdate = draft.videos
    .filter((v) => {
      if (v.id === null) return false;
      const before = savedVideos.get(v.id);
      return !before || JSON.stringify(videoPayload(before)) !== JSON.stringify(videoPayload(v));
    })
    .map((v) => ({ id: v.id as string, ...videoPayload(v) }));
  const videoDelete = saved.videos.map((v) => v.id).filter((id): id is string => id !== null && !draftVideoIds.has(id));
  const draftExistingSeq = draft.videos.map((v) => v.id).filter((id): id is string => id !== null);
  const savedExistingSeq = saved.videos
    .map((v) => v.id)
    .filter((id): id is string => id !== null && draftVideoIds.has(id));
  const reordered = JSON.stringify(draftExistingSeq) !== JSON.stringify(savedExistingSeq);
  if (videoCreate.length || videoUpdate.length || videoDelete.length || reordered) {
    changes.videos = {
      ...(videoCreate.length ? { create: videoCreate } : {}),
      ...(videoUpdate.length ? { update: videoUpdate } : {}),
      ...(videoDelete.length ? { delete: videoDelete } : {}),
      order: draft.videos.map((v) => v.id ?? `${NEW_VIDEO_ORDER_PREFIX}${v.key}`),
    };
  }

  return changes;
}

/** 下書きに未保存の変更があるか */
export function hasProfileChanges(saved: ProfileDraft, draft: ProfileDraft): boolean {
  return Object.keys(buildProfileChanges(saved, draft)).length > 0;
}

/** 動画を1つ上/下へ動かす（範囲外・未登録の key は元の配列をそのまま返す） */
export function moveDraftVideo(videos: DraftVideo[], key: string, direction: "up" | "down"): DraftVideo[] {
  const index = videos.findIndex((v) => v.key === key);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= videos.length) return videos;
  const next = [...videos];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** speedrun.com リンクの identifier（無ければ null）。フォーム側の speedruncomUsername と同期させるために使う */
export function speedrunLinkIdentifier(links: DraftLink[]): string | null {
  return links.find((l) => l.platform === "speedruncom")?.identifier.trim() || null;
}

/**
 * 保存時に送る speedruncomUsername。同じ保存に speedrun.com に関わるリンクの変更（作成 / 更新 / 削除。
 * 更新は旧・新どちらかが speedruncom）があれば、サーバーはリンクを優先して列を決めるため、
 * クライアントもフォーム欄の手入力値ではなくリンクの下書きから決めた値を「保存済み」として扱う
 * （食い違うと次の保存で古いフォーム値が列とリンクへ逆同期される）。無ければフォームの値をそのまま使う
 */
export function resolveSpeedrunUsernameForSave(saved: ProfileDraft, draft: ProfileDraft, formUsername: string): string {
  const links = buildProfileChanges(saved, draft).links;
  if (!links) return formUsername;
  const savedById = new Map(saved.links.map((l) => [l.id, l]));
  const touchesSpeedrun =
    (links.create ?? []).some((l) => l.platform === "speedruncom") ||
    (links.update ?? []).some(
      (l) => l.platform === "speedruncom" || savedById.get(l.id)?.platform === "speedruncom",
    ) ||
    (links.delete ?? []).some((id) => savedById.get(id)?.platform === "speedruncom");
  return touchesSpeedrun ? (speedrunLinkIdentifier(draft.links) ?? "") : formUsername;
}
