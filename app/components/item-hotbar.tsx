import { useSyncExternalStore, type ReactNode } from "react";
import { ItemIcon } from "@/components/item-icon";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * アイテム配置1スロット分のデータ。/me/items（編集）と /player/:slug（公開）で共有する。
 */
export type Slot = {
  slot: number;
  items: string[];
};

const SLOT_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const CYCLE_INTERVAL_MS = 2500;

// ============================================
// 複数アイテムスロットのサイクル表示: 全タイル共有ティッカー
// ============================================
//
// 各タイルが個別に setInterval を持つとマウント時刻のずれでバラバラに切り替わってしまうため、
// モジュールレベルで tick を1つだけ保持し、最初の購読で setInterval を開始・購読者が
// ゼロになったら停止する小さな pub/sub にする。全タイルが同じ tick を参照することで
// 「同時に切り替わる」を保証する。
let tick = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
const tickListeners = new Set<() => void>();

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (intervalId === null) {
    intervalId = setInterval(() => {
      tick++;
      tickListeners.forEach((l) => l());
    }, CYCLE_INTERVAL_MS);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getTickSnapshot(): number {
  return tick;
}

function getServerTickSnapshot(): number {
  return 0;
}

/** 全タイル共有の tick を購読する（items.length >= 2 のタイルのみが呼ぶこと） */
function useHotbarTick(): number {
  return useSyncExternalStore(subscribeTick, getTickSnapshot, getServerTickSnapshot);
}

// ============================================
// スロットタイル
// ============================================

// group-hover はラッパーに .group を付けた消費側（編集側の Dialog trigger）でのみ発火する。
// 公開側のようにラッパーが .group を持たない場合は通常キーと同じ静的な見た目になる
const TILE_BASE_CLASS =
  "relative flex h-10 w-10 items-center justify-center rounded border-2 border-border/50 bg-secondary/50 transition-colors group-hover:border-primary/50 sm:h-12 sm:w-12";

function SlotIconImage({ itemId }: { itemId: string }) {
  return (
    <>
      <ItemIcon itemId={itemId} size={24} className="sm:hidden" />
      <ItemIcon itemId={itemId} size={28} className="hidden sm:block" />
    </>
  );
}

/** items.length >= 2 のときだけマウントされる、tick に応じて表示アイテムを切り替えるアイコン */
function CyclingSlotIcon({ items }: { items: string[] }) {
  const tick = useHotbarTick();
  const activeIndex = tick % items.length;
  // 全アイテムをマウントしたまま表示だけ切り替える。src を差し替える方式だと
  // ItemIcon の読み込みプレースホルダが切替のたびに一瞬表示されてしまう
  return (
    <>
      {items.map((itemId, i) => (
        <span key={`${itemId}-${i}`} className={i === activeIndex ? "contents" : "hidden"}>
          <SlotIconImage itemId={itemId} />
        </span>
      ))}
    </>
  );
}

/**
 * items.length >= 2 のときだけ描画される、サイクル可否（reduced-motion）を判定するラッパー。
 * reduced-motion 時は共有ティッカーを購読せず先頭アイテム固定にする。
 */
function CyclingCapableIcon({ items }: { items: string[] }) {
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  if (prefersReducedMotion) {
    return <SlotIconImage itemId={items[0]} />;
  }
  return <CyclingSlotIcon items={items} />;
}

/**
 * ホットバー1スロット分の純表示タイル。空スロットは中身なし（番号プレースホルダは置かない。
 * ラベルは ItemHotbar 側が担う）。単一アイテム・空スロットは共有ティッカーを購読しない
 * （サイクル判定コンポーネントを items.length >= 2 のときだけ描画することで不要な購読を避ける）。
 */
export function HotbarSlotTile({ items }: { items: string[] }) {
  return (
    <div className={TILE_BASE_CLASS}>
      {items.length >= 2 ? (
        <CyclingCapableIcon items={items} />
      ) : items.length === 1 ? (
        <SlotIconImage itemId={items[0]} />
      ) : null}
      {items.length > 1 && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-background/80 px-0.5 font-mono text-[10px]">
          +{items.length - 1}
        </span>
      )}
    </div>
  );
}

// ============================================
// ホットバー全体（並び + 横スクロール器）
// ============================================

export function ItemHotbar({
  slots,
  offhand,
  offhandLabel = "OFF",
  renderSlotWrapper,
}: {
  slots: Slot[];
  offhand: string[];
  /** オフハンドタイル下のラベル文言（公開側とキー領域が違うため注入式。既定は "OFF"） */
  offhandLabel?: string;
  /**
   * 各タイルにインタラクションを注入する render prop（未指定ならタイルをそのまま描画）。
   * 編集側は Dialog trigger ボタンで包み、公開側は Tooltip で包む用途を想定
   */
  renderSlotWrapper?: (ctx: { slotKey: number | "offhand"; items: string[]; tile: ReactNode }) => ReactNode;
}) {
  const getSlotItems = (slotNum: number): string[] => slots.find((s) => s.slot === slotNum)?.items ?? [];

  const renderTile = (slotKey: number | "offhand", items: string[]) => {
    const tile = <HotbarSlotTile items={items} />;
    return renderSlotWrapper ? renderSlotWrapper({ slotKey, items, tile }) : tile;
  };

  return (
    <div className="custom-scrollbar overflow-x-auto pb-2">
      {/* items-start: 各列はタイル+ラベルで背が高いため、中央揃えだと区切り線がタイル中心から
          下にずれる。上端揃えにし、区切り線側の sm:mt-1 で sm のタイル高 h-12 に対して中央を合わせる */}
      <div className="flex w-fit items-start gap-2">
        {/* オフハンド */}
        <div className="flex flex-col items-center gap-0.5">
          {renderTile("offhand", offhand)}
          <span className="text-[10px] text-muted-foreground">{offhandLabel}</span>
        </div>

        <div className="h-10 w-px bg-border sm:mt-1" />

        {/* メインホットバー */}
        <div className="flex gap-1">
          {SLOT_NUMBERS.map((slotNum) => (
            <div key={slotNum} className="flex flex-col items-center gap-0.5">
              {renderTile(slotNum, getSlotItems(slotNum))}
              <span className="text-[10px] text-muted-foreground">{slotNum}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
