import { Link } from "react-router";
import { itemLangForLocale } from "@/components/item-icon";
import { toUiRemaps } from "@/lib/remap-utils";
import { coerceStringArray, parseFingerAssignments, safeParseArray } from "@/lib/preset-read";
import type { PresetSearchCraftLoopData, PresetLoopStepData } from "@/lib/preset-utils";
import {
  isValidLoopTransitionValue,
  normalizeVariationIndex,
  type LoopStepData,
  type LoopTransition,
} from "@/lib/search-craft-loops";
import {
  filterKeybindEmbedRemaps,
  normalizeEmbedCrafts,
  selectKeybindEmbedSource,
  selectSearchCraftEmbedSource,
  type EmbedUserData,
  type NormalizedEmbedCraft,
} from "@/lib/guide-embed-data";
import { VirtualKeyboard, FingerLegend, keybindingsToMap } from "@/components/virtual-keyboard";
import {
  countSearchCraftGroups,
  KeyBadgeLegend,
  SEARCH_CRAFT_OPEN_FIRST_MAX,
  SearchCraftGroupedList,
  type SearchCraftGroupHeadingLevel,
  type SearchCraftRowData,
} from "@/components/search-craft-template-view";
import {
  groupLoopsByTiming,
  makeLoopGroupExtra,
  type LoopCraftInfo,
  type SearchCraftLoopRowData,
} from "@/components/search-craft-loop-view";
import { HorizontalScrollArea } from "@/components/horizontal-scroll-area";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { decodeHtmlAttr, isValidTemplateId } from "@/lib/guide-embed-attrs";
import {
  GUIDE_YOUTUBE_BLOCK_SOURCE,
  htmlDepthDelta,
  lastHeadingLevel,
  parseGuideYouTubeEmbedUrl,
} from "@/lib/guide-view-html";
import { parseTemplateRemaps, resolveCraftTiming } from "@/lib/search-craft-templates";
import { getGameLanguageName } from "@/lib/game-languages";
import type { UiRemapInfo } from "@/lib/remap-utils";
import type { KeyboardLayout } from "@/lib/keybindings";

// ========================================
// 共通型（実体は lib/guide-embed-data.ts。既存の import 元を保つ re-export）
// ========================================

export type { EmbedUserData };

// ========================================
// HTML からembed参照を抽出
// ========================================

export type EmbedRef = {
  type: "keybind" | "searchcraft";
  userSlug: string;
  presetName: string | null;
};

export function extractEmbedRefs(html: string): EmbedRef[] {
  const refs: EmbedRef[] = [];
  const regex = /data-(keybind|searchcraft)-embed[^>]*data-user-slug="([^"]*)"[^>]*(?:data-preset-name="([^"]*)")?/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    refs.push({
      type: match[1] as "keybind" | "searchcraft",
      userSlug: decodeHtmlAttr(match[2]),
      presetName: match[3] ? decodeHtmlAttr(match[3]) : null,
    });
  }
  // Also handle the case where data-preset-name comes before data-user-slug
  const regex2 = /data-(keybind|searchcraft)-embed[^>]*data-preset-name="([^"]*)"[^>]*data-user-slug="([^"]*)"[^>]*/g;
  while ((match = regex2.exec(html)) !== null) {
    const existing = refs.find(
      (r) => r.type === match![1] && r.userSlug === decodeHtmlAttr(match![3])
    );
    if (existing) {
      // 1本目の正規表現は属性が逆順だと presetName を拾えない（末尾の任意グループが空振りする）ため補う
      if (!existing.presetName && match[2]) existing.presetName = decodeHtmlAttr(match[2]);
    } else {
      refs.push({
        type: match[1] as "keybind" | "searchcraft",
        userSlug: decodeHtmlAttr(match[3]),
        presetName: match[2] ? decodeHtmlAttr(match[2]) : null,
      });
    }
  }
  return refs;
}

/**
 * 本文中のテンプレート埋め込みの ID を重複なしで集める（形式外は除く）。
 * extractEmbedRefs には混ぜない（getUniqueEmbedSlugs に空 slug が入るため）。
 */
export function extractTemplateEmbedIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/<div[^>]*data-sctemplate-embed[^>]*>/g)) {
    const idMatch = m[0].match(/data-template-id="([^"]*)"/);
    const id = idMatch ? decodeHtmlAttr(idMatch[1]) : "";
    if (isValidTemplateId(id)) ids.add(id);
  }
  return [...ids];
}

/** ユニークなユーザーslug一覧を取得 */
export function getUniqueEmbedSlugs(refs: EmbedRef[]): string[] {
  return [...new Set(refs.map((r) => r.userSlug))];
}

// ========================================
// コンテンツをembed境界で分割
// ========================================

export type ContentSegment =
  | { type: "html"; content: string }
  | { type: "keybind-embed"; userSlug: string; presetName: string | null }
  | { type: "searchcraft-embed"; userSlug: string; presetName: string | null }
  /** サーチクラフトテンプレート埋め込み。templateId は形式外・欠落なら null（描画側で「表示できません」） */
  | { type: "sctemplate-embed"; templateId: string | null }
  /**
   * 本文の直下の YouTube 埋め込み（押してから読み込む YouTubeClickEmbed で描く）。embedUrl は
   * youtube-nocookie.com の埋め込み URL。index は本文中の YouTube の出現順（1 始まり、入れ子の動画も数える。
   * titleGuideYouTubeIframes の番号と一致し、title / 再生ボタンの名前を一意にするのに使う）
   */
  | { type: "youtube"; embedUrl: string; index: number };

const EMBED_REGEX_SOURCE = `<div[^>]*data-(keybind|searchcraft|sctemplate)-embed[^>]*></div>|${GUIDE_YOUTUBE_BLOCK_SOURCE}`;

/**
 * YouTube は本文の直下（要素の深さ 0）のものだけ分割する。コールアウト・トグル・段組の中で切ると
 * 開きタグと閉じタグが別々の断片に分かれて本文の構造が壊れるため、入れ子の動画は iframe のまま
 * 断片に残す（loader の titleGuideYouTubeIframes が title と loading="lazy" を付けている）。
 * src が無い（許可外ホストでサニタイズが除去した）直下の動画は何も描かない（空の iframe を出さない）。
 * src はあるが押してから読み込む形に直せない動画（再生リスト等。parseGuideYouTubeEmbedUrl）は iframe のまま残す。
 */
export function splitContentAtEmbeds(html: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const embedRegex = new RegExp(EMBED_REGEX_SOURCE, "g");

  let lastIndex = 0;
  // 直前の一致の終わりまでの要素の深さ（YouTube が本文の直下にあるかの判定）
  let depth = 0;
  let depthScannedTo = 0;
  let youtubeIndex = 0;
  let match;
  while ((match = embedRegex.exec(html)) !== null) {
    depth += htmlDepthDelta(html.slice(depthScannedTo, match.index));
    depthScannedTo = match.index + match[0].length;

    if (match[1] === undefined) {
      // YouTube（一致はそれ自体で開閉が揃うので深さを変えない）
      youtubeIndex += 1;
      if (depth > 0) continue; // 入れ子は断片に残す
      const iframeAttrs = match[2] ?? "";
      const embedUrl = parseGuideYouTubeEmbedUrl(iframeAttrs);
      if (!embedUrl && /\ssrc="/.test(iframeAttrs)) continue; // 直せない動画（再生リスト等）は断片に残す
      if (match.index > lastIndex) {
        segments.push({ type: "html", content: html.slice(lastIndex, match.index) });
      }
      if (embedUrl) segments.push({ type: "youtube", embedUrl, index: youtubeIndex });
      lastIndex = match.index + match[0].length;
      continue;
    }

    // HTMLテキスト部分
    if (match.index > lastIndex) {
      segments.push({ type: "html", content: html.slice(lastIndex, match.index) });
    }

    const tag = match[0];
    if (match[1] === "sctemplate") {
      const idMatch = tag.match(/data-template-id="([^"]*)"/);
      const id = idMatch ? decodeHtmlAttr(idMatch[1]) : "";
      segments.push({ type: "sctemplate-embed", templateId: isValidTemplateId(id) ? id : null });
      lastIndex = match.index + match[0].length;
      continue;
    }
    const embedType = match[1] as "keybind" | "searchcraft";
    const slugMatch = tag.match(/data-user-slug="([^"]*)"/);
    const presetMatch = tag.match(/data-preset-name="([^"]*)"/);

    segments.push({
      type: `${embedType}-embed` as "keybind-embed" | "searchcraft-embed",
      userSlug: slugMatch ? decodeHtmlAttr(slugMatch[1]) : "",
      presetName: presetMatch ? decodeHtmlAttr(presetMatch[1]) : null,
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < html.length) {
    segments.push({ type: "html", content: html.slice(lastIndex) });
  }

  return segments;
}

/**
 * 埋め込みのグループ見出し（サーチクラフト一覧のタイミング）の段を、セグメントごとに返す（並びは segments と同じ。
 * html・YouTube のセグメントは null）。段は、その埋め込みより前で最後に現れる本文の見出し（降格した後の段。
 * セグメントをまたいで持ち越す）の1つ下で、上限は h6。前に見出しが無ければ h3（記事のタイトルが h1、本文の最上位が h2）。
 * 固定の段にすると、本文のどの段の見出しの下に置くかで段が飛んだり（h2 → h4）並んだり（h3 → h3）する。
 * html は loader が降格まで済ませた本文で、SSR とハイドレーションで同じ値を返す（render 中に呼んでよい）。
 * リマップ埋め込み（KeybindEmbedView）には見出しが無いが、並びをそろえるため値は返す。
 */
export function embedGroupHeadingLevels(
  segments: ContentSegment[],
): (SearchCraftGroupHeadingLevel | null)[] {
  let preceding: number | null = null;
  return segments.map((seg) => {
    if (seg.type === "html") {
      preceding = lastHeadingLevel(seg.content) ?? preceding;
      return null;
    }
    if (seg.type === "youtube") return null;
    const level = Math.min(Math.max((preceding ?? 2) + 1, 3), 6);
    return `h${level}` as SearchCraftGroupHeadingLevel;
  });
}

// ========================================
// リマップ表示コンポーネント
// ========================================

/**
 * リマップ / サーチクラフト埋め込みのヘッダー（「走者名（プリセット）— 種別」と「プロフィールを見る」）。
 * 狭い幅で語の途中で折れないよう、種別とリンクは折り返さず（shrink-0 whitespace-nowrap）、長い名前だけ省略する
 */
function UserEmbedHeader({
  displayName,
  presetName,
  label,
  userSlug,
}: {
  displayName: string;
  presetName: string | null;
  label: string;
  userSlug: string;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2">
      <p className="flex min-w-0 items-center text-sm font-medium">
        <span className="min-w-0 truncate">
          {displayName}
          {presetName && <span className="ml-2 text-muted-foreground">({presetName})</span>}
        </span>
        <span className="ml-1 shrink-0 whitespace-nowrap">— {label}</span>
      </p>
      {/* 文字サイズは据え置きで、padding＋負マージンによりヘッダー高さを変えずに当たり判定だけ約40pxへ広げる */}
      <Link
        to={`/player/${userSlug}`}
        className="-mx-2 -my-3 inline-flex shrink-0 items-center whitespace-nowrap px-2 py-3 text-xs text-primary hover:underline"
      >
        {t("playerProfile.viewProfile")}
      </Link>
    </div>
  );
}

export function KeybindEmbedView({
  userData,
  presetName,
}: {
  userData: EmbedUserData;
  presetName: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const displayName = getLocalizedDisplayName(userData, locale);

  // プリセット名指定時はそのプリセットのデータを使用（選び方は lib/guide-embed-data.ts。エディタの要約と同じ）
  const source = selectKeybindEmbedSource(userData, presetName);
  const keybindingsRaw = source.keybindingsRaw;
  // リマップ埋め込みはチャット・サーチクラフト用途の紹介なので、Trigger 種別は表示しない
  // （Chat / All / 未設定をそのまま一覧表示する。文脈シミュレーションではないため優先解決はしない）
  const remaps = toUiRemaps(
    filterKeybindEmbedRemaps(source.remapsRaw) as Parameters<typeof toUiRemaps>[0],
  );
  const keyboardLayout = source.layout as "US" | "JIS" | "US_TKL" | "JIS_TKL";

  // 指割り当て
  const fingerAssignments = parseFingerAssignments(source.fingerAssignmentsJson);
  // 指割り当てが1件も無い（キーボードに指色が出ない）場合は凡例を出さない
  const hasFingerAssignments = Object.values(fingerAssignments).some(
    (f) => Array.isArray(f) && f.length > 0,
  );

  if (remaps.length === 0) {
    return (
      <div className="my-6 rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">
        {displayName} — {t("playerProfile.noRemaps")}
      </div>
    );
  }

  return (
    <div className="my-6 not-prose">
      <div className="rounded-xl border border-border/70 bg-card overflow-hidden">
        <UserEmbedHeader
          displayName={displayName}
          presetName={presetName}
          label={t("playerProfile.remapTab")}
          userSlug={userData.slug}
        />
        {/* フェード・ヒントは bg-card 想定で、この埋め込みカードの背景（bg-card）と一致。ヒントは左右余白に揃える。
            鍵盤（約 1,150px）は記事の本文幅より広いことがあるので、はみ出しているときはデスクトップでも案内を出す */}
        <HorizontalScrollArea
          className="p-4"
          wrapperClassName="[&>p]:px-4 [&>p]:pt-3"
          showHint
          hintAtAllWidths
        >
          <VirtualKeyboard
            layout={keyboardLayout}
            keybindings={keybindingsToMap(keybindingsRaw)}
            remaps={remaps}
            fingerAssignments={fingerAssignments}
            showRemaps
            showFingerAssignments
            alwaysShowActions={["chat"]}
            hideNumpad
          />
        </HorizontalScrollArea>
        {/* 凡例は横スクロール領域の外に置く（狭い幅でキーボードと一緒に左へ流れて見えなくならないように） */}
        {hasFingerAssignments && <FingerLegend className="px-4 pb-4" />}
      </div>
    </div>
  );
}

// ========================================
// サーチクラフト表示コンポーネント
// ========================================

// 一覧はテンプレート詳細・走者画面と同じ SearchCraftGroupedList（高密度の行: アイテム／等幅のサーチ文字列＋コピー／
// キーバッジ）で描く。繋ぎ方（Loop）も同じ makeLoopGroupExtra でタイミンググループの中に入れる。
// ここで持つのは、壊れうる生 JSON（プリセットスナップショット・テンプレート）を共有部品へ渡せる形に直す処理だけ。

/**
 * 破損データ由来の transition 値を安全な形へ矯正する。
 * resolveLoopSteps 内部の deriveTransition は LoopTransition として構造妥当でない
 * 値に対応する分岐を持たない（呼び出し側で妥当性を保証する契約）ため、サニタイズせずに
 * 渡すと壊れた JSON（プリセットスナップショット由来）で SSR が落ちうる。
 * 判定は search-craft-loops.ts の isValidLoopTransitionValue に委譲する（型追加時に
 * ここを個別更新しなくても自動的に追従する）。構造妥当でない値は null に倒す
 * （resolveLoopSteps は非先頭ステップの transition null を「無効だが例外にはしない」形で扱う）。
 */
function toSafeLoopTransition(value: unknown): LoopTransition | null {
  return isValidLoopTransitionValue(value) ? value : null;
}

/** steps 全体を「先頭のみ transition null・以降は安全な transition」の形へ矯正する */
function toSafeLoopSteps(steps: LoopStepData[]): LoopStepData[] {
  return steps.map((step, i) => ({
    craftId: step.craftId,
    transition: i === 0 ? null : toSafeLoopTransition(step.transition),
    variationIndex: normalizeVariationIndex(step.variationIndex),
  }));
}


/**
 * サーチクラフト一覧 + Loop の描画本体（埋め込みの外枠の中）。
 * ユーザー埋め込み（SearchCraftEmbedView）とテンプレート埋め込み（SearchCraftTemplateEmbedView）が共用する。
 * presetMode=true は「スナップショット由来」（Loop の craft 参照は sequence で突合し、Loop は rawLoopsData の生JSON）、
 * false は「ライブ」（craft 参照は id、Loop は liveLoops）。
 *
 * 面は埋め込みの外枠1枚だけ（グループはカードにせず見出し＋行）。タイミングのグループが2つ以上なら開閉でき、
 * lg 以上は全部開いて始める。lg 未満は、最初のグループのクラフトが SEARCH_CRAFT_OPEN_FIRST_MAX 件以下ならそれだけ開いて、
 * 多ければ全部閉じて始める。閉じた本体も hidden="until-found" で DOM に残す（ページ内検索で見つかる）
 * （SearchCraftGroupedList の collapsible / openFirstMaxCount / openAllFromLg / keepClosedMounted。テンプレート詳細と同じ）。
 * 1つだけなら常に開く。
 */
function SearchCraftEmbedBody({
  crafts,
  remaps,
  presetMode,
  rawLoopsData,
  liveLoops,
  keyboardLayout,
  groupHeadingLevel,
}: {
  crafts: NormalizedEmbedCraft[];
  remaps: UiRemapInfo[];
  presetMode: boolean;
  rawLoopsData: string | null;
  liveLoops: EmbedUserData["searchCraftLoops"];
  /** キー入力順ダイアログの鍵盤のレイアウト（未指定なら US） */
  keyboardLayout?: KeyboardLayout;
  /** グループ見出しの段（embedGroupHeadingLevels。未指定なら h3＝本文の最上位の見出しの下） */
  groupHeadingLevel?: SearchCraftGroupHeadingLevel;
}) {
  const locale = useLocale();

  // 一覧の行データ。craft.items は JSON 文字列（ライブ/スナップショット由来）で、破損・非配列だと
  // 描画で落ちるため coerceStringArray で常に string[] に矯正する（不正値は空クラフト表示）。
  // 行の key は配列位置で振る（スナップショットの id は欠落・重複がありうる）
  const rows: SearchCraftRowData[] = crafts.map((c, idx) => ({
    id: `embed-craft-${idx}`,
    sequence: c.sequence,
    items: coerceStringArray(c.items),
    comment: c.comment,
    timing: c.timing,
    variations: c.variations,
  }));

  // Loop（繋ぎ方）の craft 参照解決キー。presetMode 時は同スナップショット内の
  // sequence 値、無指定（ライブ / メインプリセットのスナップショット）時は id
  // （loader 側で decodePresetSearchCraftLoops により合成idへ解決済み）で突合する。
  const loopCrafts: LoopCraftInfo[] = crafts.map((c) => ({
    id: presetMode ? String(c.sequence) : c.id,
    items: coerceStringArray(c.items),
    variations: c.variations,
  }));

  // timing は resolveCraftTiming で一覧と同じ表示用の値に寄せる（enum 外の値は "other"。
  // 生のままだと一覧のグループに入らず Loop が表示から漏れる）
  const loops: SearchCraftLoopRowData[] = presetMode
    ? (safeParseArray<PresetSearchCraftLoopData>(rawLoopsData) ?? []).map((loop, idx) => {
        const rawSteps = loop && Array.isArray(loop.steps) ? loop.steps : [];
        const steps: LoopStepData[] = rawSteps.map((rawStep) => {
          const step = rawStep as Partial<PresetLoopStepData> | null | undefined;
          const craftSeq = step && typeof step === "object" ? step.craftSeq : undefined;
          return {
            craftId: typeof craftSeq === "number" ? String(craftSeq) : "",
            transition: step?.transition ?? null,
            variationIndex: normalizeVariationIndex(step?.variationIndex),
          };
        });
        const isObj = loop && typeof loop === "object";
        return {
          id: `preset-loop-embed-${idx}`,
          timing: resolveCraftTiming(isObj && typeof loop.timing === "string" ? loop.timing : null),
          comment: isObj && typeof loop.comment === "string" ? loop.comment : null,
          steps: toSafeLoopSteps(steps),
        };
      })
    : liveLoops.map((loop) => ({
        id: loop.id,
        timing: resolveCraftTiming(loop.timing),
        comment: loop.comment,
        steps: toSafeLoopSteps(loop.steps),
      }));

  const loopTimings = Array.from(groupLoopsByTiming(loops).keys());
  const renderLoopExtra = makeLoopGroupExtra({
    loops,
    crafts: loopCrafts,
    remaps,
    keyboardLayout,
  });

  // グループの数（SearchCraftGroupedList と同じ数え方: クラフトの表示用タイミング ∪ Loop のタイミング）。
  // 2つ以上のときだけ開閉にする（1つだけなら閉じる意味がない）
  const collapsible = countSearchCraftGroups(rows, loopTimings) > 1;

  return (
    <div className="space-y-3 p-4">
      <KeyBadgeLegend showCraftMarker={loops.length > 0} />
      <SearchCraftGroupedList
        framed={false}
        collapsible={collapsible}
        // lg 未満は、先頭のグループが長いときは全部閉じて始める。lg 以上は全部開く（テンプレート詳細と同じ）
        openFirstMaxCount={SEARCH_CRAFT_OPEN_FIRST_MAX}
        openAllFromLg
        keepClosedMounted
        // 段は直前の本文の見出しの1つ下（embedGroupHeadingLevels）。既定の h4 のままだと本文 h2 の下で段が飛ぶ
        groupHeadingLevel={groupHeadingLevel ?? "h3"}
        crafts={rows}
        remaps={remaps}
        // アイテム名は閲覧者の UI ロケールで出す（docs/guides.md「サーチクラフトテンプレート埋め込み」）
        gameLanguage={itemLangForLocale(locale)}
        keyboardLayout={keyboardLayout}
        extraTimings={loopTimings}
        renderGroupExtra={renderLoopExtra}
      />
    </div>
  );
}

export function SearchCraftEmbedView({
  userData,
  presetName,
  groupHeadingLevel,
}: {
  userData: EmbedUserData;
  presetName: string | null;
  /** グループ見出しの段（embedGroupHeadingLevels） */
  groupHeadingLevel?: SearchCraftGroupHeadingLevel;
}) {
  const t = useT();
  const locale = useLocale();
  const displayName = getLocalizedDisplayName(userData, locale);

  // presetName 指定時のみプリセットの生 JSON を読む（選び方は lib/guide-embed-data.ts。エディタの要約と同じ）
  const source = selectSearchCraftEmbedSource(userData, presetName);
  const rawLoopsData = source.rawLoopsData;
  const keyboardLayout = source.layout as KeyboardLayout;

  const remaps = toUiRemaps(source.remapsRaw as Parameters<typeof toUiRemaps>[0]);
  const crafts = normalizeEmbedCrafts(source.rawCrafts);

  if (crafts.length === 0) {
    return (
      <div className="my-6 rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">
        {displayName} — {t("playerProfile.noSearchCraft")}
      </div>
    );
  }

  return (
    <div className="my-6 not-prose">
      <div className="rounded-xl border border-border/70 bg-card overflow-hidden">
        <UserEmbedHeader
          displayName={displayName}
          presetName={presetName}
          label={t("playerProfile.searchCraftTab")}
          userSlug={userData.slug}
        />
        <SearchCraftEmbedBody
          crafts={crafts}
          remaps={remaps}
          presetMode={source.presetMode}
          rawLoopsData={rawLoopsData}
          liveLoops={userData.searchCraftLoops}
          keyboardLayout={keyboardLayout}
          groupHeadingLevel={groupHeadingLevel}
        />
      </div>
    </div>
  );
}

// ========================================
// サーチクラフトテンプレート埋め込み
// ========================================

/** テンプレート埋め込みに渡す表示用データ（公開済み・作者が private でないものだけ loader が詰める） */
export type EmbedTemplateData = {
  id: string;
  title: string;
  gameLanguage: string | null;
  craftsData: string;
  remapsData: string | null;
  loopsData: string | null;
  authorSlug: string;
  authorName: string;
  authorUuid: string | null;
  authorSkinUrl: string | null;
};

/** 見つからない・非公開・削除済み・ID 不正のときの短い表示（本文の流れは壊さない） */
function TemplateEmbedUnavailable() {
  const t = useT();
  return (
    <div className="my-6 rounded-xl border border-dashed border-border/70 bg-card p-4 text-sm text-muted-foreground">
      {t("guideView.embedTemplateUnavailable")}
    </div>
  );
}

export function SearchCraftTemplateEmbedView({
  template,
  groupHeadingLevel,
}: {
  /** null = 表示できない（ID 不正・未公開・削除済み・非公開プロフィール） */
  template: EmbedTemplateData | null;
  /** グループ見出しの段（embedGroupHeadingLevels） */
  groupHeadingLevel?: SearchCraftGroupHeadingLevel;
}) {
  const t = useT();
  const locale = useLocale();
  if (!template) return <TemplateEmbedUnavailable />;

  // crafts は生JSONを直接パースする（スナップショットと同形式）。必ず normalizeEmbedCrafts を通す
  const crafts = normalizeEmbedCrafts(safeParseArray<unknown>(template.craftsData) ?? []);
  if (crafts.length === 0) return <TemplateEmbedUnavailable />;

  // リマップは入力キー表示（実際に押すキー）にだけ反映し、鍵盤は出さない（詳細ページで見られる）
  const remaps = parseTemplateRemaps(template.remapsData);
  const href = `/guides/templates/${template.id}`;

  return (
    <div className="my-6 not-prose">
      <div className="rounded-xl border border-border/70 bg-card overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/30 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="min-w-0 text-sm">
            <span className="font-medium break-words">{template.title}</span>
            <span className="text-muted-foreground">
              {" — "}
              <Link
                to={`/player/${template.authorSlug}`}
                className="inline-flex items-center gap-1.5 align-middle hover:underline"
              >
                <MinecraftAvatar
                  uuid={template.authorUuid}
                  skinUrl={template.authorSkinUrl}
                  size={20}
                  alt=""
                  className="shrink-0 rounded-md"
                />
                {template.authorName}
              </Link>
            </span>
            {template.gameLanguage && (
              <span className="text-muted-foreground ml-2 text-xs">
                {t("guideView.embedTemplateLanguage", {
                  language: getGameLanguageName(t, locale, template.gameLanguage),
                })}
              </span>
            )}
          </div>
          <Link
            to={href}
            className="-mx-2 -my-3 inline-flex shrink-0 items-center whitespace-nowrap px-2 py-3 text-xs text-primary hover:underline"
          >
            {t("guideView.embedTemplateView")}
          </Link>
        </div>
        <SearchCraftEmbedBody
          crafts={crafts}
          remaps={remaps}
          presetMode
          rawLoopsData={template.loopsData}
          liveLoops={[]}
          groupHeadingLevel={groupHeadingLevel}
        />
        {remaps.length > 0 && (
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            {t("guideView.embedTemplateHasRemaps")}
          </p>
        )}
      </div>
    </div>
  );
}
