import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  formatItemName,
  getItemName,
  loadLang,
  isLangLoaded,
} from "@bafv4/mcitems/1.16/react";
import { ItemIcon, TEXTURE_BASE_URL } from "@/components/item-icon";
import { getActualKeyInfos, type UiRemapInfo, type RemapInfo, type RemapDetail } from "@/lib/remap-utils";
import type { SearchCraftTiming } from "@/lib/search-craft-templates";
import type { SearchCraftVariation } from "@/lib/search-craft-variations";
import { getKeyLabel, getKeyCombinationLabel, type FingerType } from "@/lib/keybindings";
import { FingerLegend, FINGER_KEY_COLORS } from "@/components/virtual-keyboard";
import { cn } from "@/lib/utils";
import { ShiftMark, KeyLabelText } from "@/components/shift-mark";
import { useT } from "@/hooks/use-locale";
import type { MessageKey, Translator } from "@/lib/messages";
import { toast } from "sonner";
import { Copy } from "lucide-react";

/**
 * サーチクラフトの公開表示コンポーネント群。
 * プレイヤープロフィールのサーチクラフトタブ・テンプレート詳細ページ・Playground で共用する。
 * タイミング別グループカード + 3カラム表形式（v1.6.0 の刷新スタイル）。
 */

/** サーチクラフトのゲーム内言語が未設定のときのフォールバック言語（アプリ既定=日本語）。 */
const DEFAULT_ITEM_LANG = "ja_jp";

/** アイテム名を指定言語で取得（未ロード言語・キー欠落時は en_us / 整形IDにフォールバック）。 */
function getItemDisplayName(itemId: string, lang: string): string {
  return getItemName(itemId, lang) ?? formatItemName(itemId);
}

/**
 * 指定言語の辞書をクライアントで読み込む。バンドル済み(en_us/ja_jp)・読込済みは即 true。
 * 非バンドル言語は SSR/初回描画では en_us にフォールバックし、loadLang 完了後に
 * 再描画をトリガーして正しい名前へ更新する（初回描画はSSRと一致するのでhydration崩れなし）。
 */
function useItemLang(gameLanguage: string | null | undefined): string {
  const lang = gameLanguage || DEFAULT_ITEM_LANG;
  const [, setLoadedVersion] = useState(0);
  useEffect(() => {
    if (isLangLoaded(lang)) return;
    let cancelled = false;
    loadLang(lang, TEXTURE_BASE_URL)
      .then(() => {
        if (!cancelled) setLoadedVersion((v) => v + 1);
      })
      .catch(() => {
        // 読み込み失敗時はフォールバック表示のまま
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);
  return lang;
}

/**
 * 半角スペースの連続を「␣」（U+2423）に置き換えて可視化しつつ、テキスト片を描画する
 * （全角スペースは対象外）。可視化用の span は常に aria-hidden にする（呼び出し側で
 * 読み上げテキストを別途 aria-label 等で提供すること）。search-craft-loop-view.tsx の
 * SegmentedSearchString と共用する。
 */
export function renderVisibleSpaces(text: string, spaceClassName: string): ReactNode[] {
  const parts = text.split(/( +)/);
  return parts.map((part, i) =>
    part.length > 0 && part[0] === " " ? (
      <span key={i} aria-hidden="true" className={spaceClassName}>
        {"␣".repeat(part.length)}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * サーチ文字列を表示する。半角スペースは視認できるよう「␣」（U+2423）に置き換えて
 * 描画する（全角スペースは対象外）。描画テキストは実データと異なるため、
 * コピー機能は必ず元の searchStr 文字列を使うこと（DOM のテキストから取らない）。
 * スクリーンリーダーには aria-label で元の文字列を提供する。
 */
export function SearchStringText({ value }: { value: string }) {
  return <span aria-label={value}>{renderVisibleSpaces(value, "text-muted-foreground/70")}</span>;
}

/**
 * タイミングの表示メタ（この配列順が表示順）。
 * 「指定なし」(null) はこの配列外で、常に先頭に表示する。
 * dot はグループ見出し左の色ドット（カテゴリの識別用。意味的な良し悪しではない）。
 */
export const TIMING_META: {
  id: SearchCraftTiming;
  /** 固定表記（固有名詞は翻訳しない）。labelKey がある場合は使わない */
  label?: string;
  /** 翻訳が必要なものだけキーを持つ。解決は timingLabel() */
  labelKey?: MessageKey;
  dot: string;
}[] = [
  { id: "ow", label: "OW", dot: "bg-success" },
  { id: "bastion", label: "Bastion", dot: "bg-warning" },
  { id: "bastion_fort", label: "Bastion→Fort", dot: "bg-info" },
  { id: "fortress", label: "Fortress", dot: "bg-destructive" },
  { id: "blinded", label: "Blinded", dot: "bg-primary" },
  { id: "other", labelKey: "playerProfile.timingOther", dot: "bg-muted-foreground" },
];

/** タイミングの表示ラベル。モジュール評価時はロケールが未確定なので描画時に解決する */
export function timingLabel(
  t: Translator,
  meta: (typeof TIMING_META)[number],
): string {
  return meta.labelKey ? t(meta.labelKey) : (meta.label ?? meta.id);
}

/** id から表示ラベルを引く。未知の id はそのまま返す */
export function timingLabelById(t: Translator, id: string): string {
  const meta = TIMING_META.find((m) => m.id === id);
  return meta ? timingLabel(t, meta) : id;
}
const TIMING_DOT_CLASSES: Record<string, string> = Object.fromEntries(
  TIMING_META.map((m) => [m.id, m.dot]),
);
const TIMING_ORDER: SearchCraftTiming[] = TIMING_META.map((m) => m.id);

/** 表示用のサーチクラフト行データ（items はデコード済み） */
export type SearchCraftRowData = {
  id: string;
  sequence: number;
  items: string[];
  comment: string | null;
  timing: string | null;
  /** 複数サーチ文字列バリエーション。行内で縦積み表示する */
  variations: SearchCraftVariation[];
};

// ============================================
// キーバッジ
// ============================================

/** 実入力キーのバッジ（指割り当て色・リマップring・Shift琥珀・ツールチップ付き） */
export function KeyBadge({
  keyCode,
  label,
  finger,
  isRemapped,
  needsShift,
  remapDetail,
}: {
  keyCode: string;
  label: string;
  finger?: FingerType;
  isRemapped?: boolean;
  needsShift?: boolean;
  /** リマップされている場合のツールチップ詳細（「リマップ: 物理 → 出力」表示用） */
  remapDetail?: RemapDetail;
}) {
  const t = useT();
  const fingerClass = finger ? FINGER_KEY_COLORS[finger] : "";

  // ツールチップのテキスト。物理キーボードのキー情報ツールチップ（key-info-trigger.tsx）と
  // 同じ「リマップ: 物理 → 出力」形式（フル名称。⇧ 等の短縮記号は使わない）
  const getTooltipContent = (): ReactNode => {
    if (isRemapped && remapDetail) {
      return t("playerProfile.remapped", { source: remapDetail.sourceLabel, target: remapDetail.targetLabel });
    }
    if (keyCode.includes("+")) {
      // 修飾キー組み合わせの場合
      return getKeyCombinationLabel(t, keyCode);
    }
    return getKeyLabel(t, keyCode);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center justify-center rounded border-2 font-mono font-semibold text-sm min-w-7 h-7 px-1.5",
            finger
              ? fingerClass
              : "bg-secondary/50 border-border/50 text-muted-foreground",
            isRemapped && "ring-1 ring-primary ring-offset-1",
            needsShift && !isRemapped && "border-warning/50 bg-warning/10"
          )}
        >
          <KeyLabelText label={label} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{getTooltipContent()}</TooltipContent>
    </Tooltip>
  );
}

/** 「Shiftを押しながらクラフト」を示すバッジ（入力キー列の先頭に表示） */
export function ShiftCraftBadge() {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center gap-1 rounded border-2 font-mono font-semibold text-sm h-7 px-1.5 border-warning/50 bg-warning/10 text-warning">
          <ShiftMark /> Shift
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("playerProfile.withShiftTooltip")}</TooltipContent>
    </Tooltip>
  );
}

/** サーチ文字列から導出した実入力キーのバッジ列 */
export function ActualKeyBadges({
  searchStr,
  remaps,
  fingerAssignments,
  shiftHeld,
}: {
  searchStr: string;
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  /** Shiftを押しながらクラフトする前提で逆引きし、先頭に ⇧ Shift バッジを表示する */
  shiftHeld?: boolean;
}) {
  const t = useT();
  const keyInfos = getActualKeyInfos(t, searchStr, remaps, { shiftHeld });

  // キーコードから指割り当てを取得
  const getFingerForKey = (keyCode: string): FingerType | undefined => {
    if (!fingerAssignments) return undefined;
    const fingers = fingerAssignments[keyCode] || fingerAssignments[keyCode.toLowerCase()];
    return fingers?.[0];
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shiftHeld && <ShiftCraftBadge />}
      {keyInfos.map((info, idx) => {
        // 修飾キー組み合わせの場合、ベースキーで指割り当てを検索
        const baseKeyCode = info.keyCode.includes("+")
          ? info.keyCode.split("+").pop() || info.keyCode
          : info.keyCode;
        return (
          <KeyBadge
            key={idx}
            keyCode={info.keyCode}
            label={info.displayLabel}
            finger={getFingerForKey(baseKeyCode)}
            isRemapped={info.isRemapped}
            needsShift={info.needsShift}
            remapDetail={info.remapDetail}
          />
        );
      })}
    </div>
  );
}

/** キーバッジ装飾（リマップ/Shift/指割り当て）の凡例 */
export function KeyBadgeLegend({
  showFingers = false,
  showCraftMarker = false,
}: {
  showFingers?: boolean;
  /** Loop（繋ぎ方）表示があるページでのみ、制御キー（BS/←/Home/⇧Home）バッジの説明を追加する */
  showCraftMarker?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-3.5 rounded border-2 bg-secondary/50 border-border/50 ring-1 ring-primary ring-offset-1 ring-offset-background" />
        <span className="text-[11px] text-muted-foreground">
          {t("playerProfile.legendRemapped")}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex h-3.5 items-center justify-center rounded border-2 border-warning/50 bg-warning/10 px-0.5 text-warning">
          <ShiftMark className="size-2.5" />
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("playerProfile.legendWithShift")}
        </span>
      </div>
      {showCraftMarker && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3.5 items-center justify-center rounded-full border-2 border-info/50 bg-info/10 px-1 font-mono text-[10px] font-semibold text-info">
            BS
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t("playerProfile.legendControlKey")}
          </span>
        </div>
      )}
      {showFingers && <FingerLegend />}
    </div>
  );
}

// ============================================
// グループカード + 行リスト
// ============================================

// 行と列ヘッダーで共通のレスポンシブ3カラム定義（アイテム / サーチ文字列 / 入力キー）
const SEARCH_CRAFT_GRID_COLS =
  "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,5fr)] lg:gap-4";

/**
 * サーチクラフトの一覧表示（タイミング別グループカード + 3カラム表形式）。
 * タイミングが1件もない場合はヘッダーなしの1枚のカードにまとめる。
 */
export function SearchCraftGroupedList({
  crafts,
  remaps,
  fingerAssignments,
  gameLanguage,
  renderGroupExtra,
  extraTimings,
}: {
  crafts: SearchCraftRowData[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  /** アイテム名の表示に使うゲーム内言語（未指定なら日本語） */
  gameLanguage?: string | null;
  /**
   * 各グループカードの行リストの後（CardContent 内）に追加コンテンツを描画するフック
   * （繋ぎ方 Loop 表示などを疎結合に差し込むための拡張点。search-craft-loop-view.tsx を
   * ここから直接 import しない ＝ 循環 import 回避のため render prop 方式にしている）。
   * タイミングなしの1枚カード表示のときも renderGroupExtra(null) を呼ぶ。
   */
  renderGroupExtra?: (timing: string | null) => ReactNode;
  /**
   * crafts 側に存在しない timing でもグループカードを出すための補助
   * （例: Loop だけがその timing を持ち、crafts は全て timing なし、というケースで
   * Loop のグループが表示から漏れるのを防ぐ）。該当カードは crafts が0件なら行リストを省略し、
   * renderGroupExtra の内容だけを描画する。
   */
  extraTimings?: (string | null)[];
}) {
  const t = useT();
  const lang = useItemLang(gameLanguage);

  const timingsFromCrafts = new Set(crafts.map((c) => c.timing));
  const extraOnlyTimings = (extraTimings ?? []).filter((timing) => !timingsFromCrafts.has(timing));
  const hasAnyTiming = crafts.some((c) => c.timing) || extraOnlyTimings.length > 0;

  if (!hasAnyTiming) {
    return (
      <SearchCraftGroupCard
        crafts={crafts}
        remaps={remaps}
        fingerAssignments={fingerAssignments}
        lang={lang}
        extra={renderGroupExtra?.(null)}
      />
    );
  }

  // タイミング別にグループ化
  const grouped = new Map<string | null, SearchCraftRowData[]>();
  for (const craft of crafts) {
    const key = craft.timing;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(craft);
  }
  // extraTimings のうち crafts 側に無いものは、空のグループとして追加する
  for (const timing of extraOnlyTimings) {
    if (!grouped.has(timing)) grouped.set(timing, []);
  }

  // ソート: 指定なし(null) → OW → Bastion → Bastion→Fort → Fortress → Blinded → その他
  const sortedKeys: (string | null)[] = [];
  if (grouped.has(null)) sortedKeys.push(null);
  for (const timing of TIMING_ORDER) {
    if (grouped.has(timing)) sortedKeys.push(timing);
  }

  return (
    <div className="space-y-4">
      {sortedKeys.map((timing) => (
        <SearchCraftGroupCard
          key={timing ?? "__none"}
          title={timing ? timingLabelById(t, timing) : t("playerProfile.timingUnspecified")}
          dotClass={timing ? TIMING_DOT_CLASSES[timing] : undefined}
          crafts={grouped.get(timing)!}
          remaps={remaps}
          fingerAssignments={fingerAssignments}
          lang={lang}
          extra={renderGroupExtra?.(timing)}
        />
      ))}
    </div>
  );
}

/** タイミンググループ1つ分のカード（行リスト + デスクトップ用の列ヘッダー + 任意の追加コンテンツ） */
function SearchCraftGroupCard({
  title,
  dotClass,
  crafts,
  remaps,
  fingerAssignments,
  lang,
  extra,
}: {
  title?: string;
  dotClass?: string;
  crafts: SearchCraftRowData[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  lang: string;
  extra?: ReactNode;
}) {
  const t = useT();
  // タイミング未設定のみの1枚カード（title未設定）は crafts=[] でも従来どおり行リストの枠を出す。
  // タイミング別グループカード（title あり）は、extraTimings 由来で crafts=0件のことがあるため、
  // その場合は行リスト（列ヘッダー含む）を省略し extra だけを描画する。
  const showList = title === undefined || crafts.length > 0;
  return (
    <Card className="gap-3 py-5">
      {title && (
        <CardHeader className="px-5">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            {dotClass && <span className={cn("h-2.5 w-2.5 rounded-full", dotClass)} />}
            {title}
            <span className="text-xs font-normal text-muted-foreground">
              {crafts.length}
            </span>
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="px-5">
        {showList && (
          <>
            {/* 列ヘッダー（デスクトップのみ） */}
            <div
              className={cn(
                "hidden pb-2 border-b text-xs text-muted-foreground",
                SEARCH_CRAFT_GRID_COLS,
              )}
            >
              <span>{t("playerProfile.colItems")}</span>
              <span>{t("playerProfile.colSearchStr")}</span>
              <span>{t("playerProfile.colInputKeys")}</span>
            </div>
            <div className="divide-y">
              {crafts.map((craft) => (
                <SearchCraftRow
                  key={craft.id}
                  craft={craft}
                  remaps={remaps}
                  fingerAssignments={fingerAssignments}
                  lang={lang}
                />
              ))}
            </div>
          </>
        )}
        {extra && <div className={showList ? "mt-3" : undefined}>{extra}</div>}
      </CardContent>
    </Card>
  );
}

function SearchCraftRow({
  craft,
  remaps,
  fingerAssignments,
  lang,
}: {
  craft: SearchCraftRowData;
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  lang: string;
}) {
  const t = useT();
  const handleCopy = (str: string) => {
    if (!str || !navigator.clipboard) return;
    navigator.clipboard.writeText(str).then(() => {
      toast.success(t("playerProfile.searchStrCopied"));
    });
  };

  return (
    <div className="py-3">
      <div className={cn("flex flex-col gap-2 lg:items-start", SEARCH_CRAFT_GRID_COLS)}>
        {/* アイテム */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {craft.items.map((itemId, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 bg-secondary/50 rounded px-2 py-1"
            >
              <ItemIcon itemId={itemId} size={24} />
              <span className="text-sm">{getItemDisplayName(itemId, lang)}</span>
            </div>
          ))}
        </div>

        {/* サーチ文字列（バリエーションごとに縦積み表示。コピーはそのバリエーションの元文字列） */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="lg:hidden text-xs text-muted-foreground shrink-0">
            {t("playerProfile.searchLabel")}
          </span>
          {craft.variations.length > 0 ? (
            craft.variations.map((variation, idx) =>
              variation.str ? (
                <div key={idx} className="flex items-center gap-1 min-w-0">
                  <code className="bg-secondary/50 px-2 py-0.5 rounded font-mono text-sm break-all whitespace-pre-wrap">
                    <SearchStringText value={variation.str} />
                  </code>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => handleCopy(variation.str)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("playerProfile.copySearchStr")}</TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <span key={idx} className="text-sm text-muted-foreground">—</span>
              ),
            )
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>

        {/* 入力キー（バリエーションごとに縦積み表示、行の高さをサーチ文字列列と揃える） */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="lg:hidden text-xs text-muted-foreground shrink-0">
            {t("playerProfile.inputKeysLabel")}
          </span>
          {craft.variations.length > 0 ? (
            craft.variations.map((variation, idx) => (
              <div key={idx} className="flex min-h-7 items-center">
                {variation.str ? (
                  <ActualKeyBadges
                    searchStr={variation.str}
                    remaps={remaps}
                    fingerAssignments={fingerAssignments}
                    shiftHeld={variation.withShift}
                  />
                ) : variation.withShift ? (
                  <ShiftCraftBadge />
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>
      </div>

      {/* コメント */}
      {craft.comment && (
        <p className="mt-1.5 text-sm text-muted-foreground">{craft.comment}</p>
      )}
    </div>
  );
}
