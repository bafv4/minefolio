// Mojang API連携

const MOJANG_API_BASE = "https://api.mojang.com";
const SESSION_SERVER_BASE = "https://sessionserver.mojang.com";

export interface MojangProfile {
  id: string; // ハイフンなしUUID
  name: string; // MCID
}

export interface MojangSessionProfile {
  id: string;
  name: string;
  properties: Array<{
    name: string;
    value: string;
  }>;
}

// MCIDからUUIDを取得
export async function fetchUuidFromMcid(mcid: string): Promise<string> {
  const response = await fetch(
    `${MOJANG_API_BASE}/users/profiles/minecraft/${encodeURIComponent(mcid)}`
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new MojangError("MCID_NOT_FOUND", "Minecraft ID not found");
    }
    throw new MojangError("API_ERROR", `Mojang API error: ${response.status}`);
  }

  const data: MojangProfile = await response.json();

  // ハイフン付きUUIDに変換
  const uuid = formatUuid(data.id);
  return uuid;
}

// UUIDからMCIDを取得（MCID同期用）
export async function fetchMcidFromUuid(uuid: string): Promise<string> {
  // ハイフンを除去
  const uuidWithoutHyphens = uuid.replace(/-/g, "");

  const response = await fetch(
    `${SESSION_SERVER_BASE}/session/minecraft/profile/${uuidWithoutHyphens}`
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 204) {
      throw new MojangError("UUID_NOT_FOUND", "UUID not found");
    }
    throw new MojangError("API_ERROR", `Session server error: ${response.status}`);
  }

  const data: MojangSessionProfile = await response.json();
  return data.name;
}

// MCIDの実在確認とUUID取得を同時に行う
export async function validateAndGetUuid(mcid: string): Promise<{
  mcid: string;
  uuid: string;
}> {
  const uuid = await fetchUuidFromMcid(mcid);

  return {
    mcid, // 入力されたMCID（大文字小文字は保持）
    uuid,
  };
}

// MCIDの変更を検出（Cron用）
export async function syncMcid(uuid: string, currentMcid: string): Promise<{
  changed: boolean;
  newMcid: string | null;
}> {
  try {
    const newMcid = await fetchMcidFromUuid(uuid);

    if (newMcid.toLowerCase() !== currentMcid.toLowerCase()) {
      return {
        changed: true,
        newMcid,
      };
    }

    return {
      changed: false,
      newMcid: null,
    };
  } catch (error) {
    // UUIDが見つからない場合はchanged: falseを返す
    if (error instanceof MojangError && error.code === "UUID_NOT_FOUND") {
      return {
        changed: false,
        newMcid: null,
      };
    }
    throw error;
  }
}

// スキンテクスチャURLを取得
export async function getSkinTextureUrl(uuid: string): Promise<string | null> {
  const uuidWithoutHyphens = uuid.replace(/-/g, "");

  const response = await fetch(
    `${SESSION_SERVER_BASE}/session/minecraft/profile/${uuidWithoutHyphens}`
  );

  if (!response.ok) {
    return null;
  }

  const data: MojangSessionProfile = await response.json();
  const texturesProperty = data.properties.find((p) => p.name === "textures");

  if (!texturesProperty) {
    return null;
  }

  try {
    const decoded = JSON.parse(atob(texturesProperty.value));
    return decoded?.textures?.SKIN?.url ?? null;
  } catch {
    return null;
  }
}

// Crafatar（頭のアバター画像）URLを生成
export function getCraftarAvatarUrl(
  uuid: string,
  size: number = 64,
  overlay: boolean = true
): string {
  const uuidWithoutHyphens = uuid.replace(/-/g, "");
  const params = new URLSearchParams({
    size: size.toString(),
    ...(overlay && { overlay: "true" }),
  });
  return `https://crafatar.com/avatars/${uuidWithoutHyphens}?${params}`;
}

// UUIDをハイフン付きフォーマットに変換
export function formatUuid(uuid: string): string {
  const clean = uuid.replace(/-/g, "");
  return clean.replace(
    /(.{8})(.{4})(.{4})(.{4})(.{12})/,
    "$1-$2-$3-$4-$5"
  );
}

// カスタムエラークラス
export class MojangError extends Error {
  constructor(
    public code: "MCID_NOT_FOUND" | "UUID_NOT_FOUND" | "API_ERROR",
    message: string
  ) {
    super(message);
    this.name = "MojangError";
  }
}
