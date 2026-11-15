// ガイド本文のキー配置 / サーチクラフト埋め込み（data-user-slug）が参照する走者のデータを引く。
// 公開ページ（routes/guides/view.tsx）と、エディタの挿入ダイアログ・ノードビューが使う解決 API
// （routes/api/guides/embed-resolve.ts）が同じ規則で引くため、ここに1つだけ置く。
// 規則が分かれると「エディタでは見つかるのに記事では出ない」が起きる。
import { and, asc, inArray, or } from "drizzle-orm";
import type { Database } from "./db";
import { users, keybindings, keyRemaps, searchCrafts, searchCraftLoops } from "./schema";
import { parseLoopSteps } from "./search-craft-loops";
import { resolveRowVariations } from "./search-craft-variations";
import { decodePresetConfig, shouldUsePresetSnapshot } from "./preset-read";
import { publiclyReferencableCondition } from "./users-filter";
import type { EmbedUserData } from "./guide-embed-data";

/**
 * 埋め込みが参照する走者のデータを解決する。
 * slug 一致と mcid 一致を1クエリで引き、slug 一致を優先する（mcid 一致は slug で
 * 解決できなかった参照のみ採用）。非公開（private）の走者は返さない（限定公開は名指しなので返す）。
 * presetNames は本文が data-preset-name で参照している名前で、クライアントへはこれに該当する
 * プリセットだけを送る（全プリセットの JSON 列を送らない）。"all" は全プリセット（エディタの解決 API 用。
 * プリセットの一覧と中身は走者画面でも公開している）。
 * 返り値のキーは slug と mcid の両方（どちらで参照されても引ける）。
 */
export async function resolveEmbedUsers(
  db: Database,
  embedSlugs: string[],
  presetNames: ReadonlySet<string> | "all",
): Promise<Record<string, EmbedUserData>> {
  const embedUsers: Record<string, EmbedUserData> = {};
  if (embedSlugs.length > 0) {
    // 非公開（private）ユーザーの設定はガイド埋め込みでも露出させない
    const rows = await db.query.users.findMany({
      where: and(
        or(inArray(users.slug, embedSlugs), inArray(users.mcid, embedSlugs)),
        publiclyReferencableCondition
      ),
      columns: {
        id: true,
        slug: true,
        displayName: true,
        displayNameAlphabet: true,
        mcid: true,
      },
      with: {
        keybindings: { orderBy: [asc(keybindings.category), asc(keybindings.action)] },
        keyRemaps: { orderBy: [asc(keyRemaps.sourceKey)] },
        playerConfig: { columns: { keyboardLayout: true, fingerAssignments: true } },
        searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
        searchCraftLoops: { orderBy: [asc(searchCraftLoops.sequence)] },
        configPresets: {
          columns: {
            name: true,
            isActive: true,
            isMain: true,
            keybindingsData: true,
            remapsData: true,
            playerConfigData: true,
            fingerAssignmentsData: true,
            searchCraftsData: true,
            searchCraftLoopsData: true,
          },
        },
      },
    });

    // slug 一致を先、slug で解決できなかった参照に対する mcid 一致を後にする
    // （従来の「slug → 未マッチ分のみ mcid」の2段クエリと同じ結果）
    const slugSet = new Set(embedSlugs);
    const slugMatched = rows.filter((u) => slugSet.has(u.slug));
    const matchedSlugs = new Set(slugMatched.map((u) => u.slug));
    const embedUserRows = [
      ...slugMatched,
      ...rows.filter((u) => !slugSet.has(u.slug) && u.mcid && slugSet.has(u.mcid) && !matchedSlugs.has(u.mcid)),
    ];

    for (const u of embedUserRows) {
      // 既定表示（presetName 指定なし）はメイン（公開用）プリセットのスナップショットを優先。
      // メインが無いユーザー、およびメインが編集中（isActive＝ライブが現在適用中の設定そのもの）の
      // ユーザーはライブ（従来挙動）。スナップショットを使う場合、null の種別は「空」
      const mainPreset = u.configPresets.find((p) => p.isMain);
      let display: Pick<
        EmbedUserData,
        "keybindings" | "keyRemaps" | "playerConfig" | "searchCrafts" | "searchCraftLoops"
      >;
      if (shouldUsePresetSnapshot(mainPreset)) {
        const decoded = decodePresetConfig(mainPreset, u.id);
        display = {
          keybindings: decoded.keybindings,
          keyRemaps: decoded.keyRemaps,
          playerConfig: decoded.playerConfig
            ? {
                keyboardLayout: decoded.playerConfig.keyboardLayout ?? null,
                fingerAssignments: decoded.fingerAssignments,
              }
            : null,
          searchCrafts: decoded.searchCrafts,
          // decodePresetSearchCraftLoops は既に craftId をこのスナップショットの
          // searchCrafts（合成id）へ解決済み。timing はスナップショットに欠落していると
          // undefined になり得るため null へ正規化する
          searchCraftLoops: decoded.searchCraftLoops.map((l) => ({
            id: l.id,
            sequence: l.sequence,
            steps: l.steps,
            comment: l.comment,
            timing: l.timing ?? null,
          })),
        };
      } else {
        display = {
          keybindings: u.keybindings,
          keyRemaps: u.keyRemaps,
          playerConfig: u.playerConfig,
          // ライブ行の search_variations 列（旧データは null）を正準の variations へ解決する
          // （必ず resolveRowVariations() を経由 — 手書きのフォールバック合成はしない）
          searchCrafts: u.searchCrafts.map((c) => ({
            ...c,
            variations: resolveRowVariations(c),
          })),
          searchCraftLoops: u.searchCraftLoops.map((row) => ({
            id: row.id,
            sequence: row.sequence,
            steps: parseLoopSteps(row.steps),
            comment: row.comment,
            timing: row.timing,
          })),
        };
      }
      const data: EmbedUserData = {
        slug: u.slug,
        displayName: u.displayName,
        displayNameAlphabet: u.displayNameAlphabet,
        mcid: u.mcid,
        // クライアント（guide-embeds）が使うフィールドのみ渡す
        // （fingerAssignmentsData 等のスナップショット列をペイロードに漏らさない）
        // 埋め込みが data-preset-name で参照するプリセットだけ（未指定の既定表示は上の display を使う）
        presets: u.configPresets
          .filter((p) => presetNames === "all" || presetNames.has(p.name))
          .map((p) => ({
            name: p.name,
            isActive: p.isActive,
            keybindingsData: p.keybindingsData,
            remapsData: p.remapsData,
            playerConfigData: p.playerConfigData,
            searchCraftsData: p.searchCraftsData,
            searchCraftLoopsData: p.searchCraftLoopsData,
          })),
        ...display,
      };
      embedUsers[u.slug] = data;
      if (u.mcid) embedUsers[u.mcid] = data;
    }
  }
  return embedUsers;
}
