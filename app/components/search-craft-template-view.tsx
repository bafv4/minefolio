import { useEffect, useState } from "react";
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
import { getActualKeyInfos, type UiRemapInfo, type RemapInfo } from "@/lib/remap-utils";
import type { SearchCraftTiming } from "@/lib/search-craft-templates";
import { getKeyLabel, getKeyCombinationLabel, type FingerType } from "@/lib/keybindings";
import { FingerLegend, FINGER_KEY_COLORS } from "@/components/virtual-keyboard";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import type { MessageKey, Translator } from "@/lib/messages";
import { toast } from "sonner";
import { Copy, Hammer } from "lucide-react";

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
 * サーチ文字列を表示する。半角スペースは視認できるよう「␣」（U+2423）に置き換えて
 * 描画する（全角スペースは対象外）。描画テキストは実データと異なるため、
 * コピー機能は必ず元の searchStr 文字列を使うこと（DOM のテキストから取らない）。
 * スクリーンリーダーには aria-label で元の文字列を提供する。
 */
export function SearchStringText({ value }: { value: string }) {
  const t = useT();
  // 半角スペースの連続を捕捉して分割
  const parts = value.split(/( +)/);
  return (
    <span aria-label={value}>
      {parts.map((part, i) =>
        part.length > 0 && part[0] === " " ? (
          <span key={i} aria-hidden="true" className="text-muted-foreground/70">
            {"␣".repeat(part.length)}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
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
  searchStr: string | null;
  comment: string | null;
  timing: string | null;
  /** Shiftを押しながらクラフトするか（古いデータには存在しない） */
  withShift?: boolean;
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
}: {
  keyCode: string;
  label: string;
  finger?: FingerType;
  isRemapped?: boolean;
  needsShift?: boolean;
}) {
  const t = useT();
  const fingerClass = finger ? FINGER_KEY_COLORS[finger] : "";

  // ツールチップのテキスト
  const getTooltipText = () => {
    if (keyCode.includes("+")) {
      // 修飾キー組み合わせの場合
      return getKeyCombinationLabel(t, keyCode);
    }
    if (isRemapped) {
      return t("playerProfile.remapped", { key: getKeyLabel(t, keyCode) });
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
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{getTooltipText()}</TooltipContent>
    </Tooltip>
  );
}

/** 「Shiftを押しながらクラフト」を示すバッジ（入力キー列の先頭に表示） */
export function ShiftCraftBadge() {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center rounded border-2 font-mono font-semibold text-sm h-7 px-1.5 border-warning/50 bg-warning/10 text-warning">
          ⇧ Shift
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
          />
        );
      })}
    </div>
  );
}

/** キーバッジ装飾（リマップ/Shift/指割り当て/クラフト実行マーカー）の凡例 */
export function KeyBadgeLegend({
  showFingers = false,
  showCraftMarker = false,
}: {
  showFingers?: boolean;
  /** Loop（繋ぎ方）表示があるページでのみ、クラフト実行マーカーの説明を追加する */
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
        <span className="inline-flex h-3.5 items-center justify-center rounded border-2 border-warning/50 bg-warning/10 px-0.5 text-[9px] font-semibold text-warning">
          ⇧
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("playerProfile.legendWithShift")}
        </span>
      </div>
      {showCraftMarker && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3.5 items-center justify-center rounded border border-dashed border-border bg-secondary/20 px-0.5">
            <Hammer className="h-2.5 w-2.5 text-muted-foreground" aria-hidden="true" />
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t("playerProfile.legendCraftMarker")}
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
}: {
  crafts: SearchCraftRowData[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  /** アイテム名の表示に使うゲーム内言語（未指定なら日本語） */
  gameLanguage?: string | null;
}) {
  const t = useT();
  const lang = useItemLang(gameLanguage);
  const hasAnyTiming = crafts.some((c) => c.timing);

  if (!hasAnyTiming) {
    return (
      <SearchCraftGroupCard
        crafts={crafts}
        remaps={remaps}
        fingerAssignments={fingerAssignments}
        lang={lang}
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
        />
      ))}
    </div>
  );
}

/** タイミンググループ1つ分のカード（行リスト + デスクトップ用の列ヘッダー） */
function SearchCraftGroupCard({
  title,
  dotClass,
  crafts,
  remaps,
  fingerAssignments,
  lang,
}: {
  title?: string;
  dotClass?: string;
  crafts: SearchCraftRowData[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  lang: string;
}) {
  const t = useT();
  return (
    <Card>
      {title && (
        <CardHeader className="py-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            {dotClass && <span className={cn("h-2.5 w-2.5 rounded-full", dotClass)} />}
            {title}
            <span className="text-xs font-normal text-muted-foreground">
              {crafts.length}
            </span>
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className={cn("pb-3", title ? "pt-0" : "pt-4")}>
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
  const handleCopySearchStr = () => {
    if (!craft.searchStr || !navigator.clipboard) return;
    navigator.clipboard.writeText(craft.searchStr).then(() => {
      toast.success(t("playerProfile.searchStrCopied"));
    });
  };

  return (
    <div className="py-3">
      <div className={cn("flex flex-col gap-2 lg:items-center", SEARCH_CRAFT_GRID_COLS)}>
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

        {/* サーチ文字列（コピー可能） */}
        <div className="flex items-center gap-1 min-w-0">
          <span className="lg:hidden text-xs text-muted-foreground shrink-0 mr-1">
            {t("playerProfile.searchLabel")}
          </span>
          {craft.searchStr ? (
            <>
              <code className="bg-secondary/50 px-2 py-0.5 rounded font-mono text-sm break-all whitespace-pre-wrap">
                <SearchStringText value={craft.searchStr} />
              </code>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={handleCopySearchStr}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("playerProfile.copySearchStr")}</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>

        {/* 入力キー */}
        <div className="flex items-start gap-1 min-w-0">
          <span className="lg:hidden text-xs text-muted-foreground shrink-0 mr-1 mt-1.5">
            {t("playerProfile.inputKeysLabel")}
          </span>
          {craft.searchStr ? (
            <ActualKeyBadges
              searchStr={craft.searchStr}
              remaps={remaps}
              fingerAssignments={fingerAssignments}
              shiftHeld={craft.withShift === true}
            />
          ) : craft.withShift ? (
            <ShiftCraftBadge />
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
