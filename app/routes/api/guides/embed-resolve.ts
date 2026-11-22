import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { resolveEmbedUsers } from "@/lib/guide-embed-users.server";
import type { EmbedUserData } from "@/lib/guide-embed-data";

/** 走者の指定（slug / MCID）の長さの上限。users.slug / mcid より十分長い */
const MAX_USER_LENGTH = 128;

/** プレイヤー設定のスナップショットから、埋め込みの要約が使う項目（キーボードの配列）だけを残す */
function pickEmbedPlayerConfig(json: string | null): string | null {
  if (!json) return null;
  try {
    const config = JSON.parse(json) as { keyboardLayout?: unknown } | null;
    if (!config || typeof config !== "object") return null;
    return JSON.stringify({ keyboardLayout: config.keyboardLayout ?? null });
  } catch {
    return null;
  }
}

/**
 * エディタが使う項目だけに絞る（データ最小化）。要約に使うのはプリセット名・リマップ・サーチクラフト・
 * キーボードの配列だけなので、キー配置の行・Loop・指の割り当て・プレイヤー設定のほかの項目は送らない
 */
function toEditorEmbedUser(user: EmbedUserData): EmbedUserData {
  return {
    ...user,
    keybindings: [],
    searchCraftLoops: [],
    playerConfig: user.playerConfig ? { keyboardLayout: user.playerConfig.keyboardLayout, fingerAssignments: null } : null,
    presets: user.presets.map((p) => ({
      ...p,
      keybindingsData: null,
      searchCraftLoopsData: null,
      playerConfigData: pickEmbedPlayerConfig(p.playerConfigData),
    })),
  };
}

/**
 * GET /api/guides/embed-resolve?user=<slug または MCID>
 * Response: { user: EmbedUserData | null }
 *
 * ガイドエディタのキー配置 / サーチクラフト埋め込み（挿入ダイアログの検証・プレビューと、ノードビューの要約）用。
 * 公開ページ（guides/view.tsx）と同じ resolveEmbedUsers で引くので、ここで見つかる走者だけが記事にも出る
 * （非公開の走者は null）。プリセットは全件（名前と、要約に使う中身だけ。走者画面でもプリセットを選んで
 * 中身を見られる公開情報）を返す。キー配置の行・Loop は要約に使わないので空にする。
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const user = url.searchParams.get("user")?.trim() ?? "";
  if (!user || user.length > MAX_USER_LENGTH) {
    return Response.json({ user: null });
  }

  const db = createDb();
  const resolved = await resolveEmbedUsers(db, [user], "all");
  const found = resolved[user];
  return Response.json(
    { user: found ? toEditorEmbedUser(found) : null },
    // 編集中に走者が設定を変えたら次に開いたときに反映されるよう、共有キャッシュには載せない
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
