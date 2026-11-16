import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { groupCraftsByTiming, resolveCraftTiming, type SearchCraftTiming } from "@/lib/search-craft-templates";
import type { SearchCraftVariation } from "@/lib/search-craft-variations";
import type { FingerType, KeyboardLayout } from "@/lib/keybindings";
import { FingerLegend } from "@/components/virtual-keyboard";
import { CraftKeySequenceButton } from "@/components/search-craft-key-sequence-dialog";
import {
  SearchStringText,
  KeyBadge,
  ShiftKeyGroup,
  getFingersForKeyCode,
} from "@/components/search-craft-badges";
import { cn } from "@/lib/utils";
import { ShiftMark } from "@/components/shift-mark";
import { useT } from "@/hooks/use-locale";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { MessageKey, Translator } from "@/lib/messages";
import { toast } from "sonner";
import { hasItemNameDictionary } from "@/lib/game-languages";
import { ChevronDown, Copy } from "lucide-react";

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

/** 読み込みに失敗した言語（英語名のフォールバックを確定させる） */
const failedItemLangs = new Set<string>();

/**
 * 辞書の読み込み待ちか。待ちの間は英語の仮の名前を出さない（読み込み後に名前が入れ替わって
 * 行の幅が揺れるため）。バンドル済み・読込済み・辞書なしの言語・読込失敗は待ちではない。
 */
function isItemLangPending(lang: string): boolean {
  return !isLangLoaded(lang) && hasItemNameDictionary(lang) && !failedItemLangs.has(lang);
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
        // 読み込み失敗時は英語名のフォールバック表示にする（スケルトンを出し続けない）
        failedItemLangs.add(lang);
        if (!cancelled) setLoadedVersion((v) => v + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);
  return lang;
}

// SearchStringText は app/components/search-craft-badges.tsx が単一ソース
// （既存 importer — search-craft-loop-view.tsx・guide-embeds.tsx 等 — を無改修で保つための re-export）
export { SearchStringText };

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

// KeyBadge / ShiftKeyGroup は app/components/search-craft-badges.tsx が単一ソース
// （既存 importer — guide-embeds.tsx 等 — を無改修で保つための re-export）
export { KeyBadge, ShiftKeyGroup };

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
  /** Shiftを押しながらクラフトする前提で逆引きし、キー列全体を ShiftKeyGroup で囲む */
  shiftHeld?: boolean;
}) {
  const t = useT();
  const keyInfos = getActualKeyInfos(t, searchStr, remaps, { shiftHeld });

  const badges = keyInfos.map((info, idx) => (
    <KeyBadge
      key={idx}
      keyCode={info.keyCode}
      label={info.displayLabel}
      fingers={getFingersForKeyCode(info.keyCode, fingerAssignments)}
      isRemapped={info.isRemapped}
      needsShift={info.needsShift}
      remapDetail={info.remapDetail}
    />
  ));

  if (shiftHeld) {
    return <ShiftKeyGroup>{badges}</ShiftKeyGroup>;
  }

  return <div className="flex flex-wrap items-center gap-1">{badges}</div>;
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
        <span className="inline-block h-3.5 w-3.5 rounded border-2 bg-secondary/50 border-border/50 ring-2 ring-primary ring-offset-1 ring-offset-background" />
        <span className="text-[11px] text-muted-foreground">
          {t("playerProfile.legendRemapped")}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex h-3.5 items-center justify-center rounded-lg border-2 border-warning/50 bg-warning/10 px-0.5 text-warning">
          <ShiftMark className="size-2.5" />
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("playerProfile.legendWithShift")}
        </span>
      </div>
      {showCraftMarker && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3.5 items-center justify-center rounded-full border-2 border-info/50 bg-info/8 px-1 font-mono text-[10px] font-semibold text-info">
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

/**
 * 開閉できる一覧（collapsible）で、先頭のグループを開いて始める件数の上限（記事の埋め込み・テンプレート詳細）。
 * 先頭のグループのクラフトがこれより多ければ、全部閉じて始める（長い一覧でページが縦に伸びすぎないように）。
 * 記事の埋め込み・テンプレート詳細は lg 以上では全部開く（openAllFromLg）ので、この規則が効くのは lg 未満だけ
 */
export const SEARCH_CRAFT_OPEN_FIRST_MAX = 10;

/**
 * SearchCraftGroupedList が描くタイミンググループの数（クラフトの表示用タイミング ∪ extraTimings）。
 * 0 はタイミングが1件も無い（ヘッダーなしの1枚表示）。開閉にするか（2つ以上）を呼び出し側が決めるのに使う
 */
export function countSearchCraftGroups(
  crafts: { timing: string | null }[],
  extraTimings: (string | null)[] = [],
): number {
  const keys = new Set<string | null>([
    ...crafts.map((c) => resolveCraftTiming(c.timing)),
    ...extraTimings.map((timing) => resolveCraftTiming(timing)),
  ]);
  return [...keys].some((k) => k !== null) ? keys.size : 0;
}

// 行と列ヘッダーで共通のレスポンシブ3カラム定義（アイテム / サーチ文字列 / 入力キー）
const SEARCH_CRAFT_GRID_COLS =
  "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,5fr)] lg:gap-4";

/**
 * 1 バリエーション分の [サーチ文字列, 入力キー] の包み。lg 未満は1段に並べて入りきらなければ折り返し、
 * lg 以上は display: contents で中身を親のサブグリッドに直接置く（列の揃えは従来どおり）
 */
const SEARCH_CRAFT_PAIR_CLASS = "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-4 sm:gap-y-2 lg:contents";

/** 箱なし表示のグループ見出しに使えるタグ（h1・h2 はページ名・欄見出しの段なので受けない） */
export type SearchCraftGroupHeadingLevel = "h3" | "h4" | "h5" | "h6";

/**
 * サーチクラフトの一覧表示（タイミング別グループカード + 3カラム表形式）。
 * タイミングが1件もない場合はヘッダーなしの1枚のカードにまとめる。
 */
export function SearchCraftGroupedList({
  crafts,
  remaps,
  fingerAssignments,
  gameLanguage,
  keyboardLayout,
  renderGroupExtra,
  extraTimings,
  framed = true,
  collapsible = false,
  stickyHeaders = false,
  stickyTopClassName,
  groupHeadingLevel = "h4",
  openFirstMaxCount,
  openAllFromLg = false,
  keepClosedMounted = false,
  toolbarStart,
}: {
  /**
   * 一覧の上の行の左に置く物（凡例など）。「すべて開く／すべて閉じる」と同じ行に並べ、凡例と開閉ボタンが
   * 別々の行に積まれて一覧の上が空くのを防ぐ。幅が足りなければ折り返す
   */
  toolbarStart?: ReactNode;
  crafts: SearchCraftRowData[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  /**
   * 箱なし表示（framed=false）のグループ見出しのタグ。親に欄見出し（h3）が無いときは "h3" に上げる。既定 h4。
   * ガイド記事の埋め込みは、直前の本文の見出しの1つ下の段を渡す（h5・h6 もありうる。guide-embeds.tsx）
   */
  groupHeadingLevel?: SearchCraftGroupHeadingLevel;
  /**
   * true にすると、開いているグループの見出し行（グループ名・件数・開閉ボタン、あれば列見出しも）を
   * スクロール中も画面上部に貼り付ける。`framed={false}` かつ `collapsible` のときだけ効く
   * （閉じているグループは追従せず自然に流れる）。既定 false
   */
  stickyHeaders?: boolean;
  /** stickyHeaders の貼り付き位置（Tailwind の top-* クラス。固定ヘッダーの下に合わせる。例: 走者画面は "top-[64px] md:top-[120px]"） */
  stickyTopClassName?: string;
  /**
   * false にすると各タイミンググループを Card ではなく「h4 小見出し＋中身」の箱なしで描く
   * （外側の欄 h2 は呼び出し側が PageSection で用意する）。既定 true＝従来の Card 表示
   */
  framed?: boolean;
  /**
   * true にするとタイミング別グループを開閉できる（見出しに件数、先頭グループのみ開いた状態で開始、
   * 一覧の上に「すべて開く／すべて閉じる」）。タイミングなしの1枚表示には効かない。既定 false
   */
  collapsible?: boolean;
  /**
   * collapsible のとき、先頭のグループを開いて始めるのを、そのグループのクラフトがこの件数以下のときに限る
   * （多ければ全部閉じて始める）。未指定なら従来どおり常に先頭を開く（走者画面）
   */
  openFirstMaxCount?: number;
  /**
   * collapsible のとき、lg 以上では全グループを開いて始める（lg 未満は上の規則のまま）。
   * 初期表示（SSR・ハイドレーション）は CSS の lg: で出し分け、マウント後に幅を読んで aria-expanded などをそろえる。
   * 開閉を一度でも操作したら、以後は操作の結果に従う（それまでは幅の変化にも追従する）。既定 false（走者画面）
   */
  openAllFromLg?: boolean;
  /**
   * collapsible のとき、閉じたグループの本体も DOM に残す（`hidden="until-found"`。ページ内検索で見つかったら開く。
   * 非対応のブラウザでは通常の hidden として隠れる）。SSR の HTML にも中身が入り、aria-controls の先が常にある。
   * 既定 false＝閉じた本体は描かない（走者画面）
   */
  keepClosedMounted?: boolean;
  /** アイテム名の表示に使うゲーム内言語（未指定なら日本語） */
  gameLanguage?: string | null;
  /** キー入力順ダイアログのバーチャルキーボードに使うレイアウト（未指定なら "US"） */
  keyboardLayout?: KeyboardLayout;
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

  const timingsFromCrafts = new Set(crafts.map((c) => resolveCraftTiming(c.timing)));
  const extraOnlyTimings = (extraTimings ?? []).filter(
    (timing) => !timingsFromCrafts.has(resolveCraftTiming(timing)),
  );
  const hasAnyTiming = crafts.some((c) => resolveCraftTiming(c.timing)) || extraOnlyTimings.length > 0;

  // タイミング別にグループ化
  // enum 外の timing は "other" に寄せる（件数と描画対象を一致させる）
  const grouped: Map<string | null, SearchCraftRowData[]> = groupCraftsByTiming(crafts);
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

  // crafts が0件で、renderGroupExtra の中身（Loop）も無いグループは描かない
  // （extraTimings 由来の空グループは Loop を出すためのものなので、Loop があれば残る）
  const groups = sortedKeys
    .map((timing) => ({
      timing,
      groupKey: timing ?? "__none",
      crafts: grouped.get(timing)!,
      extra: renderGroupExtra?.(timing),
    }))
    .filter((g) => g.crafts.length > 0 || Boolean(g.extra));

  // 開閉状態（collapsible のときだけ使う）。lg 未満（と openAllFromLg なしの全幅）の既定は先頭のグループだけ開く
  // （openFirstMaxCount があれば、先頭のグループの件数がそれ以下のときだけ）
  const narrowDefaultKeys = (() => {
    const first = groups[0];
    if (!first) return new Set<string>();
    if (openFirstMaxCount !== undefined && first.crafts.length > openFirstMaxCount) return new Set<string>();
    return new Set([first.groupKey]);
  })();
  const allKeys = () => new Set(groups.map((g) => g.groupKey));
  // 利用者が開閉を操作した後の状態。null の間は既定（openAllFromLg なら幅で決まる）に従う
  const [userOpenKeys, setUserOpenKeys] = useState<Set<string> | null>(null);
  // openAllFromLg の幅の判定。SSR とハイドレーションの描画では幅を使わず（null）、CSS の lg: で出し分ける。
  // マウント後は matchMedia の値で aria-expanded・hidden 属性まで確定させる（見た目は変わらない）
  const isLgViewport = useMediaQuery("(min-width: 64rem)");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const wide: boolean | null = !openAllFromLg ? false : mounted ? isLgViewport : null;
  /** 今の実効の開閉状態（wide が null のときは lg 未満の既定。描画側は cssOpenAtLg で lg 以上を開いて見せる） */
  const effectiveOpenKeys = (): Set<string> =>
    userOpenKeys ?? (wide ? allKeys() : narrowDefaultKeys);
  const openKeys = effectiveOpenKeys();
  // 幅が未確定（SSR・ハイドレーション）で、未操作のときだけ、lg 以上の「全部開く」を CSS に任せる
  const cssOpenAtLg = openAllFromLg && wide === null && userOpenKeys === null;
  const toggleGroup = (groupKey: string) => {
    const next = new Set(effectiveOpenKeys());
    if (!next.delete(groupKey)) next.add(groupKey);
    setUserOpenKeys(next);
  };
  // ページ内検索で閉じた本体の中身が見つかったとき（beforematch）。そのグループを開いた状態にそろえる
  const revealGroup = (groupKey: string) => {
    const current = effectiveOpenKeys();
    if (current.has(groupKey)) return;
    setUserOpenKeys(new Set([...current, groupKey]));
  };

  if (!hasAnyTiming) {
    const card = (
      <SearchCraftGroupCard
        crafts={crafts}
        remaps={remaps}
        fingerAssignments={fingerAssignments}
        keyboardLayout={keyboardLayout}
        lang={lang}
        framed={framed}
        extra={renderGroupExtra?.(null)}
      />
    );
    return toolbarStart ? (
      <div className={framed ? "space-y-4" : "space-y-5"}>
        {toolbarStart}
        {card}
      </div>
    ) : (
      card
    );
  }

  const allOpen = groups.length > 0 && groups.every((g) => openKeys.has(g.groupKey));
  const expandAllLabel = (open: boolean) =>
    open ? t("playerProfile.searchCraftCollapseAll") : t("playerProfile.searchCraftExpandAll");
  const showToggleAll = collapsible && groups.length > 1;

  return (
    <div className={framed ? "space-y-4" : "space-y-5"}>
      {(showToggleAll || toolbarStart) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {toolbarStart && <div className="min-w-0">{toolbarStart}</div>}
          {showToggleAll && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // モバイルは押せる範囲を 44px に（見た目の行の高さは負のマージンで変えない。ui.md 9 章）。
              // 凡例が折り返して1行に収まらないときも右に寄せる
              className="-my-2 ml-auto h-11 text-xs text-muted-foreground sm:my-0 sm:h-7"
              onClick={() => setUserOpenKeys(allOpen ? new Set() : allKeys())}
            >
              {cssOpenAtLg ? (
                // 幅が未確定の間は、lg 以上（全部開いている）の文言を CSS で出し分ける
                <>
                  <span className="lg:hidden">{expandAllLabel(allOpen)}</span>
                  <span className="hidden lg:inline">{expandAllLabel(true)}</span>
                </>
              ) : (
                expandAllLabel(allOpen)
              )}
            </Button>
          )}
        </div>
      )}
      {groups.map((g) => (
        <SearchCraftGroupCard
          key={g.groupKey}
          title={g.timing ? timingLabelById(t, g.timing) : t("playerProfile.timingUnspecified")}
          dotClass={g.timing ? TIMING_DOT_CLASSES[g.timing] : undefined}
          crafts={g.crafts}
          remaps={remaps}
          fingerAssignments={fingerAssignments}
          keyboardLayout={keyboardLayout}
          lang={lang}
          framed={framed}
          collapsible={collapsible}
          stickyHeader={stickyHeaders}
          stickyTopClassName={stickyTopClassName}
          headingLevel={groupHeadingLevel}
          open={openKeys.has(g.groupKey)}
          openAtLg={cssOpenAtLg}
          keepClosedMounted={keepClosedMounted}
          onToggle={() => toggleGroup(g.groupKey)}
          onReveal={() => revealGroup(g.groupKey)}
          extra={g.extra}
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
  keyboardLayout,
  lang,
  extra,
  framed = true,
  collapsible = false,
  stickyHeader = false,
  stickyTopClassName,
  headingLevel = "h4",
  open = true,
  openAtLg = false,
  keepClosedMounted = false,
  onToggle,
  onReveal,
}: {
  headingLevel?: SearchCraftGroupHeadingLevel;
  title?: string;
  dotClass?: string;
  crafts: SearchCraftRowData[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  keyboardLayout?: KeyboardLayout;
  lang: string;
  extra?: ReactNode;
  /** false なら Card ではなく h4 小見出し＋中身で描く（走者画面: タブ h2 ＞ 欄 h3 ＞ グループ h4） */
  framed?: boolean;
  /** true なら見出しを開閉ボタンにする（title があるときのみ）。open / onToggle で制御 */
  collapsible?: boolean;
  /** 開いているときに見出し行（＋列見出し）を貼り付ける。framed=false かつ collapsible のときだけ有効 */
  stickyHeader?: boolean;
  stickyTopClassName?: string;
  open?: boolean;
  /**
   * 幅が未確定（SSR・ハイドレーション）の間、lg 以上では open に関わらず開いて見せる（CSS の lg: で出し分け）。
   * この間は aria-expanded を付けない（幅で見た目が変わるため、どちらの値でも食い違う）
   */
  openAtLg?: boolean;
  /** 閉じた本体も hidden="until-found" で DOM に残す（ページ内検索で見つかったら onReveal） */
  keepClosedMounted?: boolean;
  onToggle?: () => void;
  onReveal?: () => void;
}) {
  const t = useT();
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  // タイミング未設定のみの1枚カード（title未設定）は crafts=[] でも従来どおり行リストの枠を出す。
  // タイミング別グループカード（title あり）は、extraTimings 由来で crafts=0件のことがあるため、
  // その場合は行リスト（列ヘッダー含む）を省略し extra だけを描画する。
  const showList = title === undefined || crafts.length > 0;
  const isCollapsible = collapsible && title !== undefined;
  const bodyVisible = !isCollapsible || open;
  // 閉じていても本体を DOM に残すか。lg 以上だけ開いて見せる間（openAtLg）も、閉じた側の本体は CSS で隠して残す
  const cssOpenAtLg = isCollapsible && openAtLg && !open;
  const mountBody = bodyVisible || (isCollapsible && (keepClosedMounted || cssOpenAtLg));
  // hidden 属性で隠すのは、幅に関わらず閉じているときだけ（lg 以上で開いて見せる間は max-lg:hidden のクラスで隠す）
  const hiddenClosed = isCollapsible && !open && !cssOpenAtLg;
  // 見出し行を貼り付けるときは、列見出しも同じ貼り付き枠に入れる（別々の top 指定をしなくて済む）
  const stickyActive = stickyHeader && !framed && isCollapsible && open;

  // 閉じた本体は hidden="until-found" にする（ページ内検索で見つかると、ブラウザが hidden を外して beforematch を送る）。
  // React 19 は hidden を真偽属性として hidden="" で出すため、属性値はここで書き換える（SSR は hidden="" のまま）。
  // until-found に非対応のブラウザでは、この値も通常の hidden（非表示）として扱われる
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && hiddenClosed) el.setAttribute("hidden", "until-found");
  }, [hiddenClosed]);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !mountBody) return;
    const handle = () => onRevealRef.current?.();
    el.addEventListener("beforematch", handle);
    return () => el.removeEventListener("beforematch", handle);
  }, [mountBody]);

  // 列ヘッダー（デスクトップのみ）
  const columnHeader = (
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
  );

  const body = (
    <>
      {showList && (
        <>
          {!stickyActive && columnHeader}
          <div className="divide-y">
            {crafts.map((craft) => (
              <SearchCraftRow
                key={craft.id}
                craft={craft}
                remaps={remaps}
                fingerAssignments={fingerAssignments}
                keyboardLayout={keyboardLayout}
                lang={lang}
              />
            ))}
          </div>
        </>
      )}
      {extra && <div className={showList ? "mt-3" : undefined}>{extra}</div>}
    </>
  );

  const titleContent = (
    <>
      {dotClass && <span className={cn("h-2.5 w-2.5 rounded-full", dotClass)} />}
      {title}
      {/* Loop だけのグループ（crafts 0件）は、新しい表示（箱なし・折りたたみ）では件数を出さない。
          既定の Card 表示は従来どおり 0 も出す */}
      {(crafts.length > 0 || (framed && !collapsible)) && (
        <>
          <span aria-hidden="true" className="text-xs font-normal text-muted-foreground">{crafts.length}</span>
          <span className="sr-only">{t("playerProfile.craftGroupCountSr", { count: crafts.length })}</span>
        </>
      )}
    </>
  );

  if (!framed) {
    const Heading = headingLevel;
    const heading = title && (
          <Heading
            className={cn(
              "text-base font-semibold",
              // 開閉ボタンの負のマージン（押せる範囲 44px）が見出しの外へ相殺して抜けないよう、見出しで閉じ込める
              // （抜けると見出し・貼り付き枠の高さが 44px に伸びる。ボタンは見出しの上下に 6px はみ出して重なる）
              isCollapsible && "flow-root",
              showList && bodyVisible && !stickyActive && "mb-2",
              showList && cssOpenAtLg && "lg:mb-2",
            )}
          >
            {isCollapsible ? (
              <button
                type="button"
                aria-expanded={cssOpenAtLg ? undefined : open}
                aria-controls={mountBody ? bodyId : undefined}
                onClick={onToggle}
                // モバイルは押せる範囲を 44px に（行の高さは負のマージンで変えない。見出しの flow-root で閉じ込める。ui.md 9 章）。
                // sm 以上は従来の 32px
                className="-mx-1 -my-1.5 flex w-full items-center gap-2 rounded px-1 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:my-0 sm:py-1"
              >
                {titleContent}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-180",
                    cssOpenAtLg && "lg:rotate-180",
                  )}
                />
              </button>
            ) : (
              <span className="flex items-center gap-2">{titleContent}</span>
            )}
          </Heading>
    );
    return (
      <section>
        {stickyActive ? (
          /* 見出しの開閉ボタンは -mx-1 で左右に 4px はみ出すため、追従中の背景も -mx-2 px-2 で広げて覆う
              （覆わないと、下を流れる別グループのボタンやフォーカス枠が背景の外に見える） */
          <div data-sticky-heading className={cn("sticky z-30 -mx-2 mb-2 bg-background px-2", stickyTopClassName)}>
            {heading}
            {showList && columnHeader}
          </div>
        ) : (
          heading
        )}
        {mountBody && (
          <div ref={bodyRef} id={bodyId} hidden={hiddenClosed} className={cn(cssOpenAtLg && "max-lg:hidden")}>
            {body}
          </div>
        )}
      </section>
    );
  }

  return (
    <Card className="gap-3 py-5">
      {title && (
        <CardHeader className="px-5">
          <CardTitle role="heading" aria-level={3} className="text-base font-semibold flex items-center gap-2">
            {isCollapsible ? (
              <button
                type="button"
                aria-expanded={cssOpenAtLg ? undefined : open}
                aria-controls={mountBody ? bodyId : undefined}
                onClick={onToggle}
                className="flex w-full items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {titleContent}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-180",
                    cssOpenAtLg && "lg:rotate-180",
                  )}
                />
              </button>
            ) : (
              titleContent
            )}
          </CardTitle>
        </CardHeader>
      )}
      {mountBody && (
        <CardContent
          ref={bodyRef}
          id={bodyId}
          hidden={hiddenClosed}
          className={cn("px-5", cssOpenAtLg && "max-lg:hidden")}
        >
          {body}
        </CardContent>
      )}
    </Card>
  );
}

function SearchCraftRow({
  craft,
  remaps,
  fingerAssignments,
  keyboardLayout,
  lang,
}: {
  craft: SearchCraftRowData;
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  /** キー入力順ダイアログのバーチャルキーボードに使うレイアウト（未指定時のフォールバックは
   * CraftKeySequenceButton → VirtualKeyboard の既定値 "US" に委ねる） */
  keyboardLayout?: KeyboardLayout;
  lang: string;
}) {
  const t = useT();
  const namesPending = isItemLangPending(lang);
  const handleCopy = (str: string) => {
    if (!str || !navigator.clipboard) return;
    navigator.clipboard.writeText(str).then(() => {
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
              <ItemIcon itemId={itemId} size={24} alt="" />
              {namesPending ? (
                <>
                  {/* 読み込み中は英語の仮名の代わりに同じ高さのスケルトン。読み上げは ID 由来の英語名 */}
                  <span aria-hidden className="inline-block h-5 w-[7em] rounded bg-muted" />
                  <span className="sr-only">{formatItemName(itemId)}</span>
                </>
              ) : (
                <span className="text-sm">{getItemDisplayName(itemId, lang)}</span>
              )}
            </div>
          ))}
        </div>

        {/*
          サーチ文字列 + 入力キー（バリエーションごとに [文字列セル, キーセル] のペアで並べ、
          サブグリッドの1行に自動配置する。独立した縦積みだと行の高さが揃わないため、
          ペアをグリッドの自動配置に委ねることで行を確実に揃える（ペアの包みは lg で display: contents）。
          lg 未満はペアを1段に並べ、入りきらないときだけ入力キーを次の段へ折り返す（どちらも短いので、
          1行が「アイテム／サーチ／入力キー」の3段にならないように）。sm 未満の段の間隔は 16px
          （コピー・キー入力順の 24px のボタンを上下に 10px ずつ広げているので、28px の段どうしで重ならない幅）。
        */}
        <div className="min-w-0 flex flex-col gap-4 sm:gap-2 lg:col-span-2 lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)] lg:gap-x-4 lg:gap-y-2">
          {craft.variations.length > 0 ? (
            craft.variations.map((variation, idx) => (
              <div key={idx} className={SEARCH_CRAFT_PAIR_CLASS}>
              <div className="flex min-h-7 items-center gap-1 min-w-0">
                <span className="lg:hidden text-xs text-muted-foreground shrink-0">
                  {t("playerProfile.searchLabel")}
                </span>
                {variation.str ? (
                  <>
                    <code className="bg-secondary/50 px-2 py-0.5 rounded font-mono text-sm break-all whitespace-pre-wrap">
                      <SearchStringText value={variation.str} />
                    </code>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="relative h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground after:absolute after:-inset-y-2.5 after:-left-1 after:-right-4 sm:after:hidden"
                          aria-label={t("playerProfile.copySearchStrNamed", { str: variation.str })}
                          onClick={() => handleCopy(variation.str)}
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
              <div className="flex min-h-7 items-center gap-1">
                <span className="lg:hidden text-xs text-muted-foreground shrink-0">
                  {t("playerProfile.inputKeysLabel")}
                </span>
                {variation.str ? (
                  <>
                    <ActualKeyBadges
                      searchStr={variation.str}
                      remaps={remaps}
                      fingerAssignments={fingerAssignments}
                      shiftHeld={variation.withShift}
                    />
                    <CraftKeySequenceButton
                      className="relative after:absolute after:-inset-y-2.5 after:-left-1 after:-right-4 sm:after:hidden"
                      searchStr={variation.str}
                      withShift={variation.withShift}
                      remaps={remaps}
                      layout={keyboardLayout}
                      fingerAssignments={fingerAssignments}
                    />
                  </>
                ) : variation.withShift ? (
                  <ShiftKeyGroup />
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
              </div>
            ))
          ) : (
            <div className={SEARCH_CRAFT_PAIR_CLASS}>
              <div className="flex min-h-7 items-center gap-1 min-w-0">
                <span className="lg:hidden text-xs text-muted-foreground shrink-0">
                  {t("playerProfile.searchLabel")}
                </span>
                <span className="text-sm text-muted-foreground">—</span>
              </div>
              <div className="flex min-h-7 items-center gap-1">
                <span className="lg:hidden text-xs text-muted-foreground shrink-0">
                  {t("playerProfile.inputKeysLabel")}
                </span>
                <span className="text-sm text-muted-foreground">—</span>
              </div>
            </div>
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
