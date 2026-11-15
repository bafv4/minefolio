import { useSyncExternalStore, type ReactNode } from "react";
import { ItemIcon, getLocalizedItemName } from "@/components/item-icon";
import { HintTip } from "@/components/hint-tip";
import { useLocale } from "@/hooks/use-locale";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

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

// fitMobile: md 未満は 32px 角（親の列が flex-1 で縮むとき幅に追従する）、md 以上は従来の 48px
const TILE_FIT_CLASS =
  "relative flex aspect-square w-full max-w-8 items-center justify-center rounded border-2 border-border/50 bg-secondary/50 transition-colors group-hover:border-primary/50 md:size-12 md:max-w-none";

/**
 * スロットのアイコン。画面幅で 24px / 28px を出し分けるため img を2枚描く。どちらか一方は常に display:none で
 * 読み上げにも出ないので、両方に翻訳名の alt を付ける（片方を alt="" にすると、その幅でアイテム名が読まれなくなる）
 */
function SlotIconImage({ itemId, fit = false }: { itemId: string; fit?: boolean }) {
  const locale = useLocale();
  const name = getLocalizedItemName(itemId, locale);
  return (
    <>
      <ItemIcon itemId={itemId} size={24} alt={name} className={fit ? "md:hidden" : "sm:hidden"} />
      <ItemIcon
        itemId={itemId}
        size={28}
        alt={name}
        className={fit ? "hidden md:block" : "hidden sm:block"}
      />
    </>
  );
}

/** items.length >= 2 のときだけマウントされる、tick に応じて表示アイテムを切り替えるアイコン */
function CyclingSlotIcon({ items, fit }: { items: string[]; fit: boolean }) {
  const tick = useHotbarTick();
  const activeIndex = tick % items.length;
  // 全アイテムをマウントしたまま表示だけ切り替える。src を差し替える方式だと
  // ItemIcon の読み込みプレースホルダが切替のたびに一瞬表示されてしまう
  return (
    <>
      {items.map((itemId, i) => (
        <span key={`${itemId}-${i}`} className={i === activeIndex ? "contents" : "hidden"}>
          <SlotIconImage itemId={itemId} fit={fit} />
        </span>
      ))}
    </>
  );
}

/**
 * items.length >= 2 のときだけ描画される、サイクル可否（reduced-motion）を判定するラッパー。
 * reduced-motion 時は共有ティッカーを購読せず先頭アイテム固定にする。
 */
function CyclingCapableIcon({ items, fit }: { items: string[]; fit: boolean }) {
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  if (prefersReducedMotion) {
    return <SlotIconImage itemId={items[0]} fit={fit} />;
  }
  return <CyclingSlotIcon items={items} fit={fit} />;
}

/**
 * ホットバー1スロット分の純表示タイル。空スロットは中身なし（番号プレースホルダは置かない。
 * ラベルは ItemHotbar 側が担う）。単一アイテム・空スロットは共有ティッカーを購読しない
 * （サイクル判定コンポーネントを items.length >= 2 のときだけ描画することで不要な購読を避ける）。
 */
export function HotbarSlotTile({ items, fit = false }: { items: string[]; fit?: boolean }) {
  return (
    <div className={fit ? TILE_FIT_CLASS : TILE_BASE_CLASS}>
      {items.length >= 2 ? (
        <CyclingCapableIcon items={items} fit={fit} />
      ) : items.length === 1 ? (
        <SlotIconImage itemId={items[0]} fit={fit} />
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

/** キーのチップ（ホームの注目の走者 HotbarRow と同系統。未割り当ては「-」を薄く出す） */
const SLOT_KEY_CHIP_CLASS =
  "inline-flex h-6 w-full min-w-0 max-w-full items-center justify-center rounded border-2 border-border/50 bg-secondary/50 px-0.5 font-mono text-xs font-semibold text-muted-foreground";

/** スロットのタイルを、アイテム名のヒント（ポインタ=Tooltip / タッチ=Popover）で包む。空スロットは包まない */
function ItemNameTip({ items, children }: { items: string[]; children: ReactNode }) {
  const locale = useLocale();
  if (items.length === 0) return <>{children}</>;
  const separator = locale === "en" ? ", " : "、";
  const message = items.map((id) => getLocalizedItemName(id, locale)).join(separator);
  return (
    <HintTip message={message} className="w-full cursor-default justify-center">
      {children}
    </HintTip>
  );
}

export function ItemHotbar({
  slots,
  offhand,
  offhandLabel = "OFF",
  renderSlotWrapper,
  slotKeyLabels,
  fitMobile = false,
  itemNameTips = false,
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
  /**
   * スロット番号(1〜9) → 割り当てキーの表示ラベル（解決済みの文字列）。渡すと、各スロット下の
   * 番号の代わりにキーのチップを出す（番号は sr-only に残す）。未割り当て（キー無し）は「-」を薄く出す。
   * 未指定なら従来どおり番号ラベル
   */
  slotKeyLabels?: Partial<Record<number, string>>;
  /** md 未満でスロットを約32px に縮め、320〜375px 幅に横スクロールなしで収める。既定は従来の大きさ */
  fitMobile?: boolean;
  /**
   * 各スロットにアイテム名（翻訳済み・複数は区切り）のヒントを付ける（ホバー/フォーカス/タップ）。
   * 既定は無効（編集側は renderSlotWrapper の Dialog トリガーと競合するため）。renderSlotWrapper 指定時は無視
   */
  itemNameTips?: boolean;
}) {
  const getSlotItems = (slotNum: number): string[] => slots.find((s) => s.slot === slotNum)?.items ?? [];

  const renderTile = (slotKey: number | "offhand", items: string[]) => {
    const tile = <HotbarSlotTile items={items} fit={fitMobile} />;
    if (renderSlotWrapper) return renderSlotWrapper({ slotKey, items, tile });
    return itemNameTips ? <ItemNameTip items={items}>{tile}</ItemNameTip> : tile;
  };

  // fitMobile の列は flex-1 + max-w-8 で、親幅が足りないとき均等に縮む。md 以上は従来の自然幅
  const colClass = cn(
    "flex flex-col items-center gap-0.5",
    fitMobile && "min-w-0 flex-1 basis-0 max-w-8 md:max-w-none md:flex-none md:basis-auto",
  );

  return (
    <div className="custom-scrollbar overflow-x-auto pb-2">
      {/* items-start: 各列はタイル+ラベルで背が高いため、中央揃えだと区切り線がタイル中心から
          下にずれる。上端揃えにし、区切り線側の sm:mt-1 で sm のタイル高 h-12 に対して中央を合わせる */}
      <div className={cn("flex items-start gap-2", fitMobile ? "w-full gap-1 md:w-fit md:gap-2" : "w-fit")}>
        {/* オフハンド */}
        <div className={colClass}>
          {renderTile("offhand", offhand)}
          <span className="text-[10px] text-muted-foreground">{offhandLabel}</span>
        </div>

        <div className={cn("w-px shrink-0 bg-border", fitMobile ? "h-8 md:mt-1 md:h-10" : "h-10 sm:mt-1")} />

        {/* メインホットバー */}
        <div className={cn("flex", fitMobile ? "min-w-0 flex-[9] gap-px md:flex-none md:gap-1" : "gap-1")}>
          {SLOT_NUMBERS.map((slotNum) => {
            const keyLabel = slotKeyLabels ? slotKeyLabels[slotNum] : undefined;
            return (
              <div key={slotNum} className={colClass}>
                {renderTile(slotNum, getSlotItems(slotNum))}
                {slotKeyLabels ? (
                  <>
                    <span className="sr-only">{slotNum}</span>
                    <span
                      title={keyLabel}
                      className={cn(SLOT_KEY_CHIP_CLASS, !keyLabel && "opacity-50")}
                    >
                      <span className="truncate">{keyLabel ?? "-"}</span>
                    </span>
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground">{slotNum}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
