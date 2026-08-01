// プロフィール絵文字リアクションのクライアント状態（単一ページ用ローカルフック）。
//
// 呼び出し元は ProfileReactionBar 自身ではなく、`/player/:slug` の Tabs を描画する
// 親ページコンポーネント（PlayerProfilePage）にすること。Radix TabsContent は非アクティブ
// になると外枠の DOM ノードは維持したまま中の子要素を unmount する。ProfileReactionBar は
// `<TabsContent value="profile">` の中にあるため、このフックをバー自身の中で呼ぶと
// 別タブへ切替 → 戻る のたびにこの state（overrides）が失われ、タブ切替では loader が
// 再実行されない（shouldRevalidate 最適化）ことと相まって、リアクション後の見た目が
// ページ初回読み込み時点の古い値に巻き戻って見える（DB自体は正しい。ハードリロードで直る）。
//
// use-likes.tsx（LikesProvider）の戦訓を単一対象用に簡略化したもの:
// - グローバル Provider にはしない（対象は常に1プロフィールのみで、Tabs を描画する
//   親ページコンポーネント内で閉じるため、Context を挟む理由がない）
// - useFetcher は使わない。profile の loader は PaceMan 外部APIを叩く重い loader のため、
//   送信のたびに全ローダーが再検証されるのを避け、素の fetch を使う
// - オーバーライド・直列化チェーンのキーは `${profileUserId}:${emoji}`（use-likes.tsx の
//   keyOf(targetType, targetId) と同じ考え方）。同一ルートコンポーネントのまま
//   /player/a → /player/b と遷移しても、A への遅延応答が B の表示に混線しない
//   （読み出し・reconcile・ロールバックは常に現在の profileUserId のキーのみを参照する。
//   旧プロフィール分のオーバーライドは reconcile で自然に破棄されるか、以後参照されないまま
//   メモリに残るだけで、表示には影響しない）
// - 楽観的更新（reacted 反転・count ±1・0未満にしない）→ 失敗時は直前値へロールバック、
//   成功時は応答の権威 count で確定する
// - ロールバック時に stale closure の値を復元しないための鏡（overridesRef）を持つ
//   （use-likes.tsx / use-favorites.tsx と同じ理由）
// - props（ローダー値）が変わったら、通信中でない絵文字のオーバーライドを破棄して
//   サーバー値に追従する（reconcile 相当）

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROFILE_REACTION_EMOJIS,
  type ProfileReactionCount,
  type ProfileReactionEmoji,
} from "@/lib/profile-reactions";

export interface ProfileReactionPill {
  emoji: ProfileReactionEmoji;
  count: number;
  reacted: boolean;
  pending: boolean;
}

interface ReactionOverride {
  count: number;
  reacted: boolean;
  pending: boolean;
}

interface UseProfileReactionsOptions {
  profileUserId: string;
  /** ローダー由来の絵文字別カウント（0件の絵文字は含まれない） */
  initialCounts: ProfileReactionCount[];
  /** ローダー由来の閲覧者の押下済み絵文字一覧 */
  initialViewerReactions: string[];
}

interface UseProfileReactionsResult {
  /** PROFILE_REACTION_EMOJIS の並び順に固定した8件（表示側で count>0 に絞り込む） */
  pills: ProfileReactionPill[];
  toggle: (emoji: ProfileReactionEmoji) => void;
}

/** オーバーライド・直列化チェーンのキー。プロフィールをまたいだ混線を防ぐ（use-likes.tsx の keyOf と同じ考え方） */
const overrideKeyOf = (profileUserId: string, emoji: ProfileReactionEmoji) =>
  `${profileUserId}:${emoji}`;

export function useProfileReactions({
  profileUserId,
  initialCounts,
  initialViewerReactions,
}: UseProfileReactionsOptions): UseProfileReactionsResult {
  const countByEmoji = useMemo(() => {
    const map = new Map<ProfileReactionEmoji, number>();
    for (const { emoji, count } of initialCounts) map.set(emoji, count);
    return map;
  }, [initialCounts]);

  const reactedSet = useMemo(
    () => new Set(initialViewerReactions),
    [initialViewerReactions],
  );

  const [overrides, setOverrides] = useState<Partial<Record<string, ReactionOverride>>>({});
  // ロールバック時に stale closure の値を復元しないための鏡
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  // 連打対策: `${profileUserId}:${emoji}` ごとに直前のリクエスト完了を待ってから次を実行する
  const chainsRef = useRef(new Map<string, Promise<void>>());

  // ローダーから新しい値（別プロフィールへの遷移・再検証）が届いたら、現在の profileUserId
  // に属する・通信中でない絵文字のオーバーライドのみを破棄してサーバー値に追従する
  // （他プロフィール分のキーはここでは触らない＝そのプロフィールに戻らない限り読み出されないため
  // 破棄不要。メモリに残っても実害はない）
  useEffect(() => {
    setOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const emoji of PROFILE_REACTION_EMOJIS) {
        const key = overrideKeyOf(profileUserId, emoji);
        if (!(key in next)) continue;
        if (chainsRef.current.has(key)) continue; // 通信中は破棄しない（楽観的更新が巻き戻る）
        delete next[key];
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [profileUserId, countByEmoji, reactedSet]);

  const toggle = useCallback(
    (emoji: ProfileReactionEmoji) => {
      const key = overrideKeyOf(profileUserId, emoji);
      const previous = chainsRef.current.get(key) ?? Promise.resolve();

      const run = previous.then(async () => {
        const base: ReactionOverride = overridesRef.current[key] ?? {
          count: countByEmoji.get(emoji) ?? 0,
          reacted: reactedSet.has(emoji),
          pending: false,
        };
        const nextReacted = !base.reacted;
        const optimistic: ReactionOverride = {
          reacted: nextReacted,
          count: Math.max(0, base.count + (nextReacted ? 1 : -1)),
          pending: true,
        };
        setOverrides((prev) => ({ ...prev, [key]: optimistic }));

        try {
          const res = await fetch("/api/profile-reactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              profileUserId,
              emoji,
              action: nextReacted ? "react" : "unreact",
            }),
          });
          if (!res.ok) throw new Error(`profile reaction failed: ${res.status}`);
          const data = (await res.json()) as { reacted: boolean; count: number };
          setOverrides((prev) => ({ ...prev, [key]: { ...data, pending: false } }));
        } catch {
          // ロールバック: 楽観的更新の直前の値に戻す（エラー表示はしない。件数が戻るのが合図）
          setOverrides((prev) => ({ ...prev, [key]: { ...base, pending: false } }));
        }
      });

      const settled = run.catch(() => {});
      chainsRef.current.set(key, settled);
      void settled.then(() => {
        if (chainsRef.current.get(key) === settled) chainsRef.current.delete(key);
      });
    },
    [profileUserId, countByEmoji, reactedSet],
  );

  const pills = useMemo<ProfileReactionPill[]>(
    () =>
      PROFILE_REACTION_EMOJIS.map((emoji) => {
        const override = overrides[overrideKeyOf(profileUserId, emoji)];
        if (override) {
          return {
            emoji,
            count: override.count,
            reacted: override.reacted,
            pending: override.pending,
          };
        }
        return {
          emoji,
          count: countByEmoji.get(emoji) ?? 0,
          reacted: reactedSet.has(emoji),
          pending: false,
        };
      }),
    [overrides, profileUserId, countByEmoji, reactedSet],
  );

  return { pills, toggle };
}
