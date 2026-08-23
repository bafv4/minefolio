// Mojang API連携

import { z } from "zod";
import { getCached, setCached, getMojangCacheKey, CacheTTL } from "./cache";

// Zodスキーマ定義
const mojangProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const mojangSessionProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  properties: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    })
  ),
});

const mojangTexturesSchema = z.object({
  textures: z.object({
    SKIN: z.object({ url: z.string() }).optional(),
    CAPE: z.object({ url: z.string() }).optional(),
  }),
});

function safeParse<T>(data: unknown, schema: z.ZodSchema<T>): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

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
export async function fetchUuidFromMcid(mcid: string, timeoutMs = 10000): Promise<string> {
  // キャッシュチェック
  const cacheKey = getMojangCacheKey(`mcid:${mcid.toLowerCase()}`);
  const cached = await getCached<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await fetch(
    `${MOJANG_API_BASE}/users/profiles/minecraft/${encodeURIComponent(mcid)}`,
    { signal: AbortSignal.timeout(timeoutMs) }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new MojangError("MCID_NOT_FOUND", "Minecraft ID not found");
    }
    throw new MojangError("API_ERROR", `Mojang API error: ${response.status}`);
  }

  const json = await response.json();
  const data = safeParse(json, mojangProfileSchema);

  if (!data) {
    throw new MojangError("API_ERROR", "Invalid response from Mojang API");
  }

  // ハイフン付きUUIDに変換
  const uuid = formatUuid(data.id);

  // キャッシュに保存（1日）
  await setCached(cacheKey, uuid, CacheTTL.LONG);

  return uuid;
}

// UUIDからMCIDを取得（MCID同期用）
export async function fetchMcidFromUuid(uuid: string): Promise<string> {
  // ハイフンを除去
  const uuidWithoutHyphens = uuid.replace(/-/g, "");

  const response = await fetch(
    `${SESSION_SERVER_BASE}/session/minecraft/profile/${uuidWithoutHyphens}`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 204) {
      throw new MojangError("UUID_NOT_FOUND", "UUID not found");
    }
    throw new MojangError("API_ERROR", `Session server error: ${response.status}`);
  }

  const json = await response.json();
  const data = safeParse(json, mojangSessionProfileSchema);

  if (!data) {
    throw new MojangError("API_ERROR", "Invalid response from Mojang session server");
  }

  return data.name;
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
  // キャッシュチェック
  const cacheKey = getMojangCacheKey(`skin:${uuid}`);
  const cached = await getCached<string | null>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const uuidWithoutHyphens = uuid.replace(/-/g, "");

  const response = await fetch(
    `${SESSION_SERVER_BASE}/session/minecraft/profile/${uuidWithoutHyphens}`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  const data = safeParse(json, mojangSessionProfileSchema);

  if (!data) {
    return null;
  }

  const texturesProperty = data.properties.find((p) => p.name === "textures");

  if (!texturesProperty) {
    return null;
  }

  try {
    const decoded = JSON.parse(atob(texturesProperty.value));
    const texturesData = safeParse(decoded, mojangTexturesSchema);

    if (!texturesData) {
      return null;
    }

    const skinUrl = texturesData.textures.SKIN?.url ?? null;

    // キャッシュに保存（1日）
    await setCached(cacheKey, skinUrl, CacheTTL.LONG);

    return skinUrl;
  } catch {
    return null;
  }
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
