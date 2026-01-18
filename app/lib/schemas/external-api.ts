// 外部APIレスポンスのZodスキーマ
import { z } from "zod";

// ============================================
// Mojang API
// ============================================

export const mojangProfileSchema = z.object({
  id: z.string().length(32, "UUID must be 32 characters without hyphens"),
  name: z.string().min(1).max(16, "Minecraft username must be 1-16 characters"),
});

export const mojangSessionProfileSchema = z.object({
  id: z.string().length(32),
  name: z.string().min(1).max(16),
  properties: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    })
  ),
});

// テクスチャデコード後のスキーマ
export const mojangTexturesSchema = z.object({
  textures: z.object({
    SKIN: z
      .object({
        url: z.string().url(),
      })
      .optional(),
    CAPE: z
      .object({
        url: z.string().url(),
      })
      .optional(),
  }),
});

// ============================================
// Twitch API
// ============================================

export const twitchTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string(),
});

export const twitchStreamSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  user_login: z.string(),
  user_name: z.string(),
  game_id: z.string(),
  game_name: z.string(),
  type: z.enum(["live", ""]),
  title: z.string(),
  viewer_count: z.number().nonnegative(),
  started_at: z.string(),
  language: z.string(),
  thumbnail_url: z.string().url(),
  tag_ids: z.array(z.string()),
  tags: z.array(z.string()),
  is_mature: z.boolean(),
});

export const twitchStreamsResponseSchema = z.object({
  data: z.array(twitchStreamSchema),
});

// ============================================
// YouTube API
// ============================================

export const youtubeVideoSnippetSchema = z.object({
  publishedAt: z.string(),
  channelId: z.string(),
  title: z.string(),
  description: z.string(),
  thumbnails: z.object({
    default: z.object({
      url: z.string().url(),
      width: z.number(),
      height: z.number(),
    }),
    medium: z.object({
      url: z.string().url(),
      width: z.number(),
      height: z.number(),
    }),
    high: z.object({
      url: z.string().url(),
      width: z.number(),
      height: z.number(),
    }),
  }),
  channelTitle: z.string(),
  liveBroadcastContent: z.enum(["none", "live", "upcoming"]),
});

export const youtubeSearchResultSchema = z.object({
  kind: z.string(),
  etag: z.string(),
  id: z.object({
    kind: z.string(),
    videoId: z.string().optional(),
    channelId: z.string().optional(),
    playlistId: z.string().optional(),
  }),
  snippet: youtubeVideoSnippetSchema,
});

export const youtubeSearchResponseSchema = z.object({
  kind: z.string(),
  etag: z.string(),
  nextPageToken: z.string().optional(),
  prevPageToken: z.string().optional(),
  pageInfo: z.object({
    totalResults: z.number(),
    resultsPerPage: z.number(),
  }),
  items: z.array(youtubeSearchResultSchema),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      errors: z.array(
        z.object({
          message: z.string(),
          domain: z.string(),
          reason: z.string(),
        })
      ),
    })
    .optional(),
});

export const youtubeChannelResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
    })
  ).optional(),
});

// ============================================
// PaceMan API
// ============================================

export const pacemanEventSchema = z.object({
  eventId: z.string(),
  rta: z.number().nonnegative(),
  igt: z.number().nonnegative(),
});

export const pacemanLiveRunSchema = z.object({
  worldId: z.string(),
  gameVersion: z.string(),
  eventList: z.array(pacemanEventSchema),
  contextEventList: z.array(pacemanEventSchema),
  user: z.object({
    uuid: z.string(),
    liveAccount: z.string().nullable(),
  }),
  nickname: z.string(),
  lastUpdated: z.number(),
  isCheated: z.boolean(),
  isHidden: z.boolean(),
  numLeaves: z.number().nonnegative(),
});

export const pacemanRecentRunRawSchema = z.object({
  id: z.number(),
  nether: z.number().nullable(),
  bastion: z.number().nullable(),
  fortress: z.number().nullable(),
  first_portal: z.number().nullable(),
  stronghold: z.number().nullable(),
  end: z.number().nullable(),
  finish: z.number().nullable(),
  lootBastion: z.number().nullable(),
  obtainObsidian: z.number().nullable(),
  obtainCryingObsidian: z.number().nullable(),
  obtainRod: z.number().nullable(),
  time: z.number(),
  updatedTime: z.number(),
});

// ============================================
// ヘルパー関数
// ============================================

/**
 * 安全にJSONをパースしてスキーマ検証を行う
 */
export async function parseAndValidate<T>(
  response: Response,
  schema: z.ZodSchema<T>
): Promise<T> {
  const json = await response.json();
  return schema.parse(json);
}

/**
 * 安全にJSONをパースして部分的なスキーマ検証を行う
 * 検証エラー時は null を返す
 */
export function safeParse<T>(
  data: unknown,
  schema: z.ZodSchema<T>
): T | null {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }

  console.error("Schema validation failed:", result.error);
  return null;
}
