import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { computeLiveFlip, LIVE_EASE, prefersReducedMotion, type LivePoint } from "@/lib/live-motion";

const PULSE_MS = 1200;
const FLIP_MS = 300;
const ENTER_MS = 200;

/**
 * 区間に到達した瞬間に、付けた要素へ brand の淡い面を出して約1.2秒で消す（色の変化だけ・移動なし）。
 * 意味を持つ状態変化なので reduced-motion でも出す。マウント時（初回表示・ハイドレーション）は出さない。
 * Web Animations API で動かすので、再レンダーでクラスが外れて途中で切れることはない
 */
export function useStageReachPulse<T extends HTMLElement>(stage: number, disabled?: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const prev = useRef(stage);
  const anim = useRef<Animation | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = stage;
    const el = ref.current;
    if (disabled || !el || stage <= before || typeof el.animate !== "function") return;
    // keyframes 内の var() は解決しないブラウザがあるため、計算済みのトークン値を埋め込む（テーマ切替にも追従する）
    const brand = getComputedStyle(el).getPropertyValue("--brand").trim();
    if (!brand) return;
    anim.current?.cancel();
    anim.current = el.animate(
      [{ backgroundColor: `color-mix(in oklab, ${brand} 15%, transparent)` }, { backgroundColor: "transparent" }],
      { duration: PULSE_MS, easing: "ease-out" },
    );
  }, [stage, disabled]);
  useEffect(() => () => anim.current?.cancel(), []);
  return ref;
}

/** 子要素（li）の描画位置（レイアウト座標。スクロール・ホバーの transform に影響されない）。非表示（display:none）は含めない */
function measure(list: HTMLElement, ids: string[]): Map<string, LivePoint> {
  const out = new Map<string, LivePoint>();
  ids.forEach((id, i) => {
    const el = list.children[i] as HTMLElement | undefined;
    if (el && el.offsetParent !== null) out.set(id, { x: el.offsetLeft, y: el.offsetTop });
  });
  return out;
}

/**
 * ライブ欄の並べ替えを FLIP で滑らせる。`ids` は一覧の子要素と同じ順の id。
 * 対象は ids の変化だけ（「もっと見る」の開閉・初回表示は動かさない）。タブが裏・差1px未満は動かさない。
 * reduced-motion では滑り（translate）をやめ、新規カードの opacity だけ残す。退場は即時
 */
export function useLiveFlip(listRef: RefObject<HTMLElement | null>, ids: string[]): void {
  const prevPos = useRef<Map<string, LivePoint>>(new Map());
  const anims = useRef<Animation[]>([]);
  const key = ids.join("\u0000");

  // ids が変わったコミットだけ差を取って動かす（前回位置は下の記録用 effect が毎コミット残す）
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // 途中の動きは止めてから測る（続けて来た更新で崩れないように）
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    const next = measure(list, ids);
    if (document.hidden) return;
    const { moves, entered } = computeLiveFlip(prevPos.current, next);
    const reduce = prefersReducedMotion();
    const at = (id: string) => list.children[ids.indexOf(id)] as HTMLElement | undefined;
    if (!reduce) {
      for (const { id, dx, dy } of moves) {
        const el = at(id);
        if (!el || typeof el.animate !== "function") continue;
        anims.current.push(
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
            duration: FLIP_MS,
            easing: LIVE_EASE,
          }),
        );
      }
    }
    for (const id of entered) {
      const el = at(id);
      if (!el || typeof el.animate !== "function") continue;
      anims.current.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: "ease-out" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 毎コミットの後に位置を記録する（開閉・リサイズなどの位置も次の比較の基準になる）
  useLayoutEffect(() => {
    const list = listRef.current;
    prevPos.current = list ? measure(list, ids) : new Map();
  });

  useEffect(() => () => anims.current.forEach((a) => a.cancel()), []);
}
