import { useEffect, useId, useState, type ReactNode } from "react";
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
  keyboardLayout,
  renderGroupExtra,
  extraTimings,
  framed = true,
  collapsible = false,
  stickyHeaders = false,
  stickyTopClassName,
  groupHeadingLevel = "h4",
}: {
  crafts: SearchCraftRowData[];
  remaps: UiRemapInfo[] | RemapInfo[];
  fingerAssignments?: Record<string, FingerType[]>;
  /** 箱なし表示（framed=false）のグループ見出しのタグ。親に欄見出し（h3）が無いときは "h3" に上げる。既定 h4 */
  groupHeadingLevel?: "h3" | "h4";
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

  // 開閉状態（collapsible のときだけ使う）。先頭のグループだけ開いた状態で始める
  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () => new Set(groups.length > 0 ? [groups[0].groupKey] : []),
  );
  const toggleGroup = (groupKey: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (!next.delete(groupKey)) next.add(groupKey);
      return next;
    });

  if (!hasAnyTiming) {
    return (
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
  }

  const allOpen = groups.length > 0 && groups.every((g) => openKeys.has(g.groupKey));

  return (
    <div className={framed ? "space-y-4" : "space-y-5"}>
      {collapsible && groups.length > 1 && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setOpenKeys(allOpen ? new Set() : new Set(groups.map((g) => g.groupKey)))}
          >
            {allOpen ? t("playerProfile.searchCraftCollapseAll") : t("playerProfile.searchCraftExpandAll")}
          </Button>
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
          onToggle={() => toggleGroup(g.groupKey)}
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
  onToggle,
}: {
  headingLevel?: "h3" | "h4";
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
  onToggle?: () => void;
}) {
  const t = useT();
  const bodyId = useId();
  // タイミング未設定のみの1枚カード（title未設定）は crafts=[] でも従来どおり行リストの枠を出す。
  // タイミング別グループカード（title あり）は、extraTimings 由来で crafts=0件のことがあるため、
  // その場合は行リスト（列ヘッダー含む）を省略し extra だけを描画する。
  const showList = title === undefined || crafts.length > 0;
  const isCollapsible = collapsible && title !== undefined;
  const bodyVisible = !isCollapsible || open;
  // 見出し行を貼り付けるときは、列見出しも同じ貼り付き枠に入れる（別々の top 指定をしなくて済む）
  const stickyActive = stickyHeader && !framed && isCollapsible && open;

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
          <Heading className={cn("text-base font-semibold", showList && bodyVisible && !stickyActive && "mb-2")}>
            {isCollapsible ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={onToggle}
                className="-mx-1 flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {titleContent}
                <ChevronDown
                  aria-hidden
                  className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
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
        {bodyVisible && <div id={bodyId}>{body}</div>}
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
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={onToggle}
                className="flex w-full items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {titleContent}
                <ChevronDown
                  aria-hidden
                  className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                />
              </button>
            ) : (
              titleContent
            )}
          </CardTitle>
        </CardHeader>
      )}
      {bodyVisible && (
        <CardContent id={bodyId} className="px-5">
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
          ペアをグリッドの自動配置に委ねることで行を確実に揃える。
          モバイルは flex-col のため DOM 順（文字列1→キー1→文字列2→キー2…）のまま縦に並ぶ。
        */}
        <div className="min-w-0 flex flex-col gap-4 sm:gap-2 lg:col-span-2 lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)] lg:gap-x-4 lg:gap-y-2">
          {craft.variations.length > 0 ? (
            craft.variations.flatMap((variation, idx) => [
              <div key={`search-${idx}`} className="flex min-h-7 items-center gap-1 min-w-0">
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
              </div>,
              <div key={`keys-${idx}`} className="flex min-h-7 items-center gap-1">
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
              </div>,
            ])
          ) : (
            <>
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
            </>
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
