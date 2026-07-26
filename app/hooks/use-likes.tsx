// いいねのクライアント状態。
//
// 設計:
// - 「いいね済みか」は _layout のローダーが返す id 一覧をシードにする（SSR時点で正しい状態が出る。
//   クライアント取得だと未いいね状態が一瞬見える）
// - 「いいね数」の基準値は各ページのローダー由来の props。ここでは自分が押した分の
//   差分だけをオーバーライドとして保持し、新しいローダー値が届いたら破棄する
// - useFetcher は使わない（送信のたびに全ローダーが再検証され、ホームでは外部API取得が走る）

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type LikeTargetType = "guide" | "template";

/** ローダー由来の初期値 */
export interface LikeSeed {
  liked: boolean;
  count: number;
}

interface LikeOverride extends LikeSeed {
  pending: boolean;
}

interface LikesContextValue {
  /** 対象のいいね状態。overrides があればそちらを優先する */
  getState: (targetType: LikeTargetType, targetId: string, seed: LikeSeed) => LikeOverride;
  /** ローダーから新しい値が来たときにオーバーライドを破棄する */
  reconcile: (targetType: LikeTargetType, targetId: string) => void;
  toggle: (targetType: LikeTargetType, targetId: string, seed: LikeSeed) => Promise<void>;
  isLoggedIn: boolean;
}

const LikesContext = createContext<LikesContextValue | null>(null);

const keyOf = (targetType: LikeTargetType, targetId: string) => `${targetType}:${targetId}`;

export function LikesProvider({
  isLoggedIn,
  likedGuideIds = [],
  likedTemplateIds = [],
  children,
}: {
  isLoggedIn: boolean;
  likedGuideIds?: string[];
  likedTemplateIds?: string[];
  children: ReactNode;
}) {
  const likedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const id of likedGuideIds) set.add(keyOf("guide", id));
    for (const id of likedTemplateIds) set.add(keyOf("template", id));
    return set;
  }, [likedGuideIds, likedTemplateIds]);

  const [overrides, setOverrides] = useState<Record<string, LikeOverride>>({});
  // ロールバック時に stale closure の値を復元しないための鏡（use-favorites と同じ理由）
  const overridesRef = useRef(overrides);
  useEffect(() => {
    overridesRef.current = overrides;
  }, [overrides]);

  // 連打対策: 直前のリクエスト完了を待ってから次を実行（対象ごとに直列化）
  const chainsRef = useRef(new Map<string, Promise<void>>());

  const getState = useCallback(
    (targetType: LikeTargetType, targetId: string, seed: LikeSeed): LikeOverride => {
      const key = keyOf(targetType, targetId);
      const override = overrides[key];
      if (override) return override;
      // シードの liked は各ページが渡さないこともあるため、_layout 由来の集合で補う
      return {
        liked: seed.liked || likedKeys.has(key),
        count: seed.count,
        pending: false,
      };
    },
    [overrides, likedKeys],
  );

  const reconcile = useCallback((targetType: LikeTargetType, targetId: string) => {
    const key = keyOf(targetType, targetId);
    if (chainsRef.current.has(key)) return; // 通信中は破棄しない（楽観的更新が巻き戻る）
    setOverrides((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const toggle = useCallback(
    async (targetType: LikeTargetType, targetId: string, seed: LikeSeed) => {
      if (!isLoggedIn) return;
      const key = keyOf(targetType, targetId);
      const previous = chainsRef.current.get(key) ?? Promise.resolve();

      const run = previous.then(async () => {
        const base: LikeSeed = overridesRef.current[key] ?? {
          liked: seed.liked || likedKeys.has(key),
          count: seed.count,
        };
        const nextLiked = !base.liked;
        const optimistic: LikeOverride = {
          liked: nextLiked,
          count: Math.max(0, base.count + (nextLiked ? 1 : -1)),
          pending: true,
        };
        setOverrides((prev) => ({ ...prev, [key]: optimistic }));

        try {
          const res = await fetch("/api/likes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              targetType,
              targetId,
              action: nextLiked ? "like" : "unlike",
            }),
          });
          if (!res.ok) throw new Error(`like failed: ${res.status}`);
          const data = (await res.json()) as LikeSeed;
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
      return run;
    },
    [isLoggedIn, likedKeys],
  );

  const value = useMemo<LikesContextValue>(
    () => ({ getState, reconcile, toggle, isLoggedIn }),
    [getState, reconcile, toggle, isLoggedIn],
  );

  return <LikesContext.Provider value={value}>{children}</LikesContext.Provider>;
}

/**
 * 対象1件のいいね状態と操作を返す。
 * Provider の外で使われた場合は seed をそのまま返す不活性な値にフォールバックする
 * （use-favorites と同じ方針。テスト・単体レンダリングで落ちないようにする）。
 */
export function useLike(
  targetType: LikeTargetType,
  targetId: string,
  seed: LikeSeed,
): { liked: boolean; count: number; isPending: boolean; isLoggedIn: boolean; toggle: () => void } {
  const ctx = useContext(LikesContext);

  // ローダーが新しい値を配ったらオーバーライドを破棄してサーバー値に追従する
  const reconcile = ctx?.reconcile;
  useEffect(() => {
    reconcile?.(targetType, targetId);
    // seed の値が変わったときだけ実行する（再検証で値が同じなら何もしない）
  }, [reconcile, targetType, targetId, seed.liked, seed.count]);

  if (!ctx) {
    return {
      liked: seed.liked,
      count: seed.count,
      isPending: false,
      isLoggedIn: false,
      toggle: () => {},
    };
  }

  const state = ctx.getState(targetType, targetId, seed);
  return {
    liked: state.liked,
    count: state.count,
    isPending: state.pending,
    isLoggedIn: ctx.isLoggedIn,
    toggle: () => void ctx.toggle(targetType, targetId, seed),
  };
}
