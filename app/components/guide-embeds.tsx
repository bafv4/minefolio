import { Link } from "react-router";
import { ItemIcon, getLocalizedItemName } from "@/components/item-icon";
import { normalizeKeyRemapType, getActualKeyInfos, toUiRemaps } from "@/lib/remap-utils";
import { coerceStringArray, parseFingerAssignments, safeParseArray } from "@/lib/preset-read";
import type { PresetSearchCraftLoopData, PresetLoopStepData } from "@/lib/preset-utils";
import {
  resolveLoopSteps,
  isValidLoopTransitionValue,
  normalizeVariationIndex,
  type LoopStepData,
  type LoopTransition,
  type LoopKeyOp,
  type ResolvedLoop,
  type ResolvedLoopStep,
} from "@/lib/search-craft-loops";
import { resolveVariations, type SearchCraftVariation } from "@/lib/search-craft-variations";
import { VirtualKeyboard, FingerLegend, keybindingsToMap } from "@/components/virtual-keyboard";
import {
  SearchStringText,
  ShiftKeyGroup,
  TIMING_META,
  timingLabelById,
} from "@/components/search-craft-template-view";
import { KeyLabelText } from "@/components/shift-mark";
import { HorizontalScrollArea } from "@/components/horizontal-scroll-area";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { decodeHtmlAttr, isValidTemplateId } from "@/lib/guide-embed-attrs";
import { GUIDE_YOUTUBE_BLOCK_SOURCE, htmlDepthDelta, parseGuideYouTubeEmbedUrl } from "@/lib/guide-view-html";
import { parseTemplateRemaps } from "@/lib/search-craft-templates";
import { getGameLanguageName } from "@/lib/game-languages";
import type { UiRemapInfo } from "@/lib/remap-utils";
import { ArrowRight } from "lucide-react";

// ========================================
// 共通型
// ========================================

export type EmbedUserData = {
  slug: string;
  displayName: string | null;
  displayNameAlphabet: string | null;
  mcid: string | null;
  presets: Array<{
    name: string;
    isActive: boolean;
    keybindingsData: string | null;
    remapsData: string | null;
    playerConfigData: string | null;
    searchCraftsData: string | null;
    searchCraftLoopsData: string | null;
  }>;
  keybindings: Array<{ action: string; keyCode: string; category: string }>;
  keyRemaps: Array<{
    sourceKey: string;
    targetKey: string | null;
    software: string | null;
    outputMode: string | null;
    outputCharacter: string | null;
    /** リマップ種別（旧データ・プリセットJSON由来では欠落することがある） */
    remapType?: string | null;
  }>;
  playerConfig: {
    keyboardLayout: string | null;
    fingerAssignments: string | null;
  } | null;
  searchCrafts: Array<{
    id: string;
    sequence: number;
    items: string;
    searchStr: string | null;
    comment: string | null;
    timing: string | null;
    /** Shiftを押しながらクラフトするか（プリセットJSON由来の場合は存在しないことがある） */
    withShift?: boolean;
    /**
     * 複数サーチ文字列バリエーション（正準）。呼び出し元（guides/view.tsx のloader）は
     * 旧データ・プリセットスナップショット由来でも必ず resolveVariations() を通した
     * 値を渡すこと（このコンポーネント側では前提として信頼する）。
     */
    variations: SearchCraftVariation[];
  }>;
  /** サーチクラフトの繋ぎ方（Loop）。ライブ行の craftId は searchCrafts[].id を参照する */
  searchCraftLoops: Array<{
    id: string;
    sequence: number;
    steps: LoopStepData[];
    comment: string | null;
    timing: string | null;
  }>;
};

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

// ========================================
// リマップ表示コンポーネント
// ========================================

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

  // プリセット名指定時はそのプリセットのデータを使用
  let keybindingsRaw = userData.keybindings;
  let remapsRaw = userData.keyRemaps;
  let layout = userData.playerConfig?.keyboardLayout ?? "US";

  if (presetName) {
    const preset = userData.presets.find((p) => p.name === presetName);
    if (preset?.keybindingsData) {
      keybindingsRaw = JSON.parse(preset.keybindingsData);
    }
    if (preset?.remapsData) {
      remapsRaw = JSON.parse(preset.remapsData);
    }
    if (preset?.playerConfigData) {
      const config = JSON.parse(preset.playerConfigData);
      layout = config.keyboardLayout ?? layout;
    }
  }

  // リマップ埋め込みはチャット・サーチクラフト用途の紹介なので、Trigger 種別は表示しない
  // （Chat / All / 未設定をそのまま一覧表示する。文脈シミュレーションではないため優先解決はしない）
  const remaps = toUiRemaps(
    (remapsRaw as Parameters<typeof toUiRemaps>[0]).filter(
      (r) => normalizeKeyRemapType(r.remapType) !== "trigger",
    ),
  );
  const keyboardLayout = (layout || "US") as "US" | "JIS" | "US_TKL" | "JIS_TKL";

  // 指割り当てを取得
  let fingerAssignmentsJson = userData.playerConfig?.fingerAssignments ?? null;
  if (presetName) {
    const preset = userData.presets.find((p) => p.name === presetName);
    if (preset?.playerConfigData) {
      const config = JSON.parse(preset.playerConfigData);
      if (config.fingerAssignments) fingerAssignmentsJson = config.fingerAssignments;
    }
  }
  const fingerAssignments = parseFingerAssignments(fingerAssignmentsJson);
  // 指割り当てが1件も無い（キーボードに指色が出ない）場合は凡例を出さない
  const hasFingerAssignments = Object.values(fingerAssignments).some(
    (f) => Array.isArray(f) && f.length > 0,
  );

  if (remaps.length === 0) {
    return (
      <div className="my-4 rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">
        {displayName} — {t("playerProfile.noRemaps")}
      </div>
    );
  }

  return (
    <div className="my-4 not-prose">
      <div className="rounded-xl border border-border/70 bg-card overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
          <span className="text-sm font-medium">
            {displayName}
            {presetName && <span className="text-muted-foreground ml-2">({presetName})</span>}
            {" — "}{t("playerProfile.remapTab")}
          </span>
          {/* 文字サイズは据え置きで、padding＋負マージンによりヘッダー高さを変えずに当たり判定だけ約40pxへ広げる */}
          <Link
            to={`/player/${userData.slug}`}
            className="-mx-2 -my-3 inline-flex items-center px-2 py-3 text-xs text-primary hover:underline"
          >
            {t("playerProfile.viewProfile")}
          </Link>
        </div>
        {/* フェード・ヒントは bg-card 想定で、この埋め込みカードの背景（bg-card）と一致。ヒントは左右余白に揃える */}
        <HorizontalScrollArea
          className="p-4"
          wrapperClassName="[&>p]:px-4 [&>p]:pt-3"
          showHint
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

// アイテム名のロケールフォールバックは共通ヘルパーを使用（app/components/item-icon.tsx の getLocalizedItemName）

// タイミングの表示順・ラベルは共通定義 TIMING_META（全6種）から導出する
// （独自定義だと新タイミング追加時に該当クラフトが黙って非表示になる）
const TIMING_ORDER = TIMING_META.map((m) => m.id);

// ========================================
// Loop（繋ぎ方）表示 — 軽量レンダラ
// ========================================
// search-craft-loop-view.tsx（KeyBadge / ActualKeyBadges を使うリマップ対応の共有コンポーネント）は
// 意図的に import しない。ここでは resolveLoopSteps の導出結果だけを、既存の素の kbd スタイルで描画する。

type EmbedLoopRow = {
  id: string;
  timing: string | null;
  comment: string | null;
  resolved: ResolvedLoop;
};

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
 * 参照切れ・導出失敗を示す「?」kbd（Loop 表示内の3箇所で共用。軽量レンダラ方針のため
 * search-craft-loop-view.tsx の InvalidSegmentBadge とは別の簡易版を持つ）。
 * dashed=true でクラフト実行マーカー用の破線ボーダー版にする。
 */
function InvalidKbd({ title, dashed }: { title: string; dashed?: boolean }) {
  return (
    <kbd
      className={`px-1.5 py-0.5 rounded border${dashed ? " border-dashed" : ""} border-destructive/50 bg-destructive/10 text-destructive font-mono text-xs`}
      title={title}
    >
      ?
    </kbd>
  );
}

/** 生の craftsData 配列（破損・旧データがありうる）をバリエーション正準の形へ正規化する */
function normalizeEmbedCrafts(rawCrafts: unknown[]) {
  // presetName 経路（生JSON直パース）は variations フィールドが欠落・破損していることがあるため、
  // 必ず resolveVariations() を経由する（壊れたJSONでSSRが落ちないように、原始的な型ガードを一つずつ通す）。
  return rawCrafts.map((item, idx) => {
    const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      id: typeof c.id === "string" ? c.id : `preset-craft-${idx}`,
      sequence: typeof c.sequence === "number" ? c.sequence : idx,
      items: typeof c.items === "string" ? c.items : "[]",
      comment: typeof c.comment === "string" ? c.comment : null,
      timing: typeof c.timing === "string" ? c.timing : null,
      variations: resolveVariations({
        variations: c.variations,
        searchStr: typeof c.searchStr === "string" ? c.searchStr : null,
        withShift: typeof c.withShift === "boolean" ? c.withShift : undefined,
      }),
    };
  });
}

type NormalizedEmbedCraft = ReturnType<typeof normalizeEmbedCrafts>[number];

/**
 * サーチクラフト一覧 + Loop の描画本体（カードの p-4 内）。
 * ユーザー埋め込み（SearchCraftEmbedView）とテンプレート埋め込み（SearchCraftTemplateEmbedView）が共用する。
 * presetMode=true は「スナップショット由来」（Loop の craft 参照は sequence で突合し、Loop は rawLoopsData の生JSON）、
 * false は「ライブ」（craft 参照は id、Loop は liveLoops）。
 */
function SearchCraftEmbedBody({
  crafts,
  remaps,
  presetMode,
  rawLoopsData,
  liveLoops,
}: {
  crafts: NormalizedEmbedCraft[];
  remaps: UiRemapInfo[];
  presetMode: boolean;
  rawLoopsData: string | null;
  liveLoops: EmbedUserData["searchCraftLoops"];
}) {
  const t = useT();
  const locale = useLocale();

  const hasAnyTiming = crafts.some((c) => c.timing);

  // Loop（繋ぎ方）の craft 参照解決キー。presetMode 時は同スナップショット内の
  // sequence 値、無指定（ライブ / メインプリセットのスナップショット）時は id
  // （loader 側で decodePresetSearchCraftLoops により合成idへ解決済み）で突合する。
  const craftLookup = new Map<string, { items: string; variations: SearchCraftVariation[] }>(
    crafts.map((c) => [
      presetMode ? String(c.sequence) : c.id,
      { items: c.items, variations: c.variations },
    ]),
  );
  const getCraft = (craftId: string) => craftLookup.get(craftId);

  const loops: EmbedLoopRow[] = presetMode
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
        return {
          id: `preset-loop-embed-${idx}`,
          timing: (loop && typeof loop === "object" ? (loop.timing ?? null) : null),
          comment: (loop && typeof loop === "object" ? (loop.comment ?? null) : null),
          resolved: resolveLoopSteps(toSafeLoopSteps(steps), getCraft),
        };
      })
    : liveLoops.map((loop) => ({
        id: loop.id,
        timing: loop.timing,
        comment: loop.comment,
        resolved: resolveLoopSteps(toSafeLoopSteps(loop.steps), getCraft),
      }));

  const renderCraft = (craft: typeof crafts[0]) => {
    // craft.items は JSON 文字列（ライブ/プリセットスナップショット由来）だが、破損・非配列だと
    // .map で SSR が落ちる。coerceStringArray で常に string[] に矯正する（不正値は空クラフト表示）。
    const items = coerceStringArray(craft.items);

    return (
      <div key={craft.id} className="rounded-lg bg-muted/30 px-4 py-3">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {items.map((itemId: string, idx: number) => (
              <div key={idx} className="flex items-center gap-2 bg-secondary/50 rounded px-3 py-1.5">
                <ItemIcon itemId={itemId} size={28} />
                <span className="text-base">{getLocalizedItemName(itemId, locale)}</span>
              </div>
            ))}
          </div>
          {/* バリエーションごとに縦積み表示（1エントリに複数サーチ文字列を登録できる） */}
          {craft.variations.length > 0 && (
            <div className="flex flex-col gap-2">
              {craft.variations.map((variation, idx) =>
                variation.str ? (
                  <div key={idx} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground shrink-0">{t("playerProfile.searchLabel")}</span>
                      <code className="bg-secondary/50 px-2 py-0.5 rounded font-mono break-all whitespace-pre-wrap">
                        <SearchStringText value={variation.str} />
                      </code>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground shrink-0 mt-0.5">{t("playerProfile.inputKeysLabel")}</span>
                      {(() => {
                        const keyKbds = getActualKeyInfos(t, variation.str, remaps, {
                          shiftHeld: variation.withShift,
                        }).map((info, i) => (
                          <kbd key={i} className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-xs">
                            <KeyLabelText label={info.displayLabel} />
                          </kbd>
                        ));
                        return variation.withShift ? (
                          <ShiftKeyGroup>{keyKbds}</ShiftKeyGroup>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">{keyKbds}</div>
                        );
                      })()}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )}
          {craft.comment && <p className="text-sm text-muted-foreground">{craft.comment}</p>}
        </div>
      </div>
    );
  };

  const renderGrouped = () => {
    const grouped = new Map<string | null, typeof crafts>();
    for (const craft of crafts) {
      const key = craft.timing;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(craft);
    }
    const sortedKeys: (string | null)[] = [];
    for (const timing of TIMING_ORDER) {
      if (grouped.has(timing)) sortedKeys.push(timing);
    }
    if (grouped.has(null)) sortedKeys.push(null);

    return (
      <div className="space-y-4">
        {sortedKeys.map((timing) => (
          <div key={timing ?? "__none"} className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground border-b pb-1">
              {timing ? timingLabelById(t, timing) : t("playerProfile.timingUnspecified")}
            </h4>
            <div className="space-y-3">{grouped.get(timing)!.map(renderCraft)}</div>
          </div>
        ))}
      </div>
    );
  };

  // Loop（繋ぎ方）の1操作を kbd で描画する。BS は連続回数を「BS ×n」で1個にまとめる
  // （n個並べない — モバイル幅対策。search-craft-loop-view.tsx と同じ方針）
  const renderLoopOp = (op: LoopKeyOp, key: number) => {
    switch (op.kind) {
      case "backspace":
        return (
          <kbd key={key} className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-xs">
            BS{op.count > 1 ? ` ×${op.count}` : ""}
          </kbd>
        );
      case "arrowLeft":
        return (
          <kbd key={key} className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-xs">
            ←{op.count > 1 ? ` ×${op.count}` : ""}
          </kbd>
        );
      case "selectAll":
        return (
          <kbd key={key} className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-xs">
            <KeyLabelText label="⇧Home" />
          </kbd>
        );
      case "home":
        return (
          <kbd key={key} className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-xs">
            Home
          </kbd>
        );
      case "type":
        return (
          <kbd key={key} className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-xs">
            <SearchStringText value={op.text} />
          </kbd>
        );
      default:
        return null;
    }
  };

  // 先頭ステップ（idx===0）で最初に打つ文字列。先頭は遷移(derived)を持たないため、
  // resolveLoopSteps が variationIndex を織り込んで解決済みの step.searchStr を直接使い、
  // type セグメント（renderLoopOp）と同じ流儀（kbd + SearchStringText でスペース␣表示）で
  // 描画する。search-craft-loop-view.tsx の LoopKeySequence（idx===0 で ActualKeyBadges）と
  // 対称になるようにする。craft 未解決（参照切れ）・searchStr が空の場合は既存の invalid 表現に倒す
  const renderLoopFirstStepKeys = (step: ResolvedLoopStep) => {
    if (!step.searchStr) {
      return <InvalidKbd title={t("playerProfile.loopInvalidTransition")} />;
    }
    const keysKbd = (
      <kbd className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-xs">
        <SearchStringText value={step.searchStr} />
      </kbd>
    );
    return step.withShift ? <ShiftKeyGroup>{keysKbd}</ShiftKeyGroup> : keysKbd;
  };

  // ステップ間の遷移（先頭以外）。参照切れ・導出失敗（無効な遷移）は「?」kbd に留める。
  // type op（打鍵セグメント）だけを、遷移先ステップ（=このステップ自身）の withShift に応じて
  // ShiftKeyGroup で囲む（制御キー op・クラフト実行マーカーは対象外）
  const renderLoopStepOps = (step: ResolvedLoopStep) => {
    if (!step.derived || !step.derived.valid) {
      return <InvalidKbd title={t("playerProfile.loopInvalidTransition")} />;
    }
    return (
      <span className="flex flex-wrap items-center gap-1">
        {step.derived.ops.map((op, i) =>
          op.kind === "type" && step.withShift ? (
            <ShiftKeyGroup key={i}>{renderLoopOp(op, i)}</ShiftKeyGroup>
          ) : (
            renderLoopOp(op, i)
          ),
        )}
      </span>
    );
  };

  // クラフト実行マーカー。ItemIcon＋→ のインライン表現（SearchCraftGroupedList 等の
  // Hammer/Tooltip 付きチップは使わない — 軽量レンダラ方針）
  const renderLoopCraftMarker = (craftId: string, key: number) => {
    const craft = craftLookup.get(craftId);
    if (!craft) {
      return <InvalidKbd key={key} dashed title={t("playerProfile.loopInvalidTransition")} />;
    }
    const items = coerceStringArray(craft.items);
    // 同じサーチ文字列で複数アイテムが出せるクラフトは、最初の1件だけでなく全アイテムの
    // アイコンを並べる。title（native attribute。この軽量レンダラは Tooltip を使わない）も
    // 複数件のときだけ内訳を添える
    const title =
      items.length > 1
        ? `${t("playerProfile.loopCraftMarker")}（${items.map((id) => getLocalizedItemName(id, locale)).join(" / ")}）`
        : t("playerProfile.loopCraftMarker");
    return (
      <span
        key={key}
        className="inline-flex items-center gap-1 rounded bg-secondary/50 px-1.5 py-0.5"
        title={title}
      >
        {items.length > 0 ? (
          items.map((itemId, i) => <ItemIcon key={i} itemId={itemId} size={20} />)
        ) : (
          <span className="text-xs text-muted-foreground">?</span>
        )}
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
      </span>
    );
  };

  const renderLoop = (loop: EmbedLoopRow) => {
    const { resolved } = loop;
    return (
      <div key={loop.id} className="rounded-lg bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2">
          <span>{t("playerProfile.loopStepCount", { count: resolved.steps.length })}</span>
          {loop.timing && <span>{timingLabelById(t, loop.timing)}</span>}
          {!resolved.valid && (
            <span className="text-destructive">{t("playerProfile.loopInvalidTransition")}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {resolved.steps.map((step, idx) => (
            <span key={idx} className="flex flex-wrap items-center gap-1.5">
              {idx === 0 ? renderLoopFirstStepKeys(step) : renderLoopStepOps(step)}
              {renderLoopCraftMarker(step.craftId, idx)}
            </span>
          ))}
        </div>
        {loop.comment && <p className="mt-2 text-sm text-muted-foreground">{loop.comment}</p>}
      </div>
    );
  };

  return (
    <div className="p-4">
      {hasAnyTiming ? renderGrouped() : (
        <div className="space-y-3">{crafts.map(renderCraft)}</div>
      )}
      {loops.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground border-b pb-1">
            {t("playerProfile.loopSectionTitle")}
          </h4>
          <div className="space-y-3">{loops.map(renderLoop)}</div>
        </div>
      )}
    </div>
  );
}

export function SearchCraftEmbedView({
  userData,
  presetName,
}: {
  userData: EmbedUserData;
  presetName: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const displayName = getLocalizedDisplayName(userData, locale);

  let remapsRaw = userData.keyRemaps;
  // presetName 指定時のみ使う。プリセットスナップショットは行 id を保持しないため、
  // このスナップショット内 crafts との突合は sequence フィールドで行う（配列位置は不可）
  let rawLoopsData: string | null = null;
  // presetName 指定時は preset.searchCraftsData の生JSONを直接パースする（破損・旧データが
  // ありうる）ため unknown[] で受け、後段で必ず resolveVariations() を通す。無指定時は
  // userData.searchCrafts（loader 側で resolveVariations() 済み）をそのまま使う。
  let rawCrafts: unknown[] = userData.searchCrafts;

  if (presetName) {
    const preset = userData.presets.find((p) => p.name === presetName);
    if (preset?.searchCraftsData) {
      rawCrafts = safeParseArray<unknown>(preset.searchCraftsData) ?? [];
    }
    if (preset?.remapsData) {
      remapsRaw = JSON.parse(preset.remapsData);
    }
    rawLoopsData = preset?.searchCraftLoopsData ?? null;
  }

  const remaps = toUiRemaps(remapsRaw as Parameters<typeof toUiRemaps>[0]);
  const crafts = normalizeEmbedCrafts(rawCrafts);

  if (crafts.length === 0) {
    return (
      <div className="my-4 rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">
        {displayName} — {t("playerProfile.noSearchCraft")}
      </div>
    );
  }

  return (
    <div className="my-4 not-prose">
      <div className="rounded-xl border border-border/70 bg-card overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
          <span className="text-sm font-medium">
            {displayName}
            {presetName && <span className="text-muted-foreground ml-2">({presetName})</span>}
            {" — "}{t("playerProfile.searchCraftTab")}
          </span>
          <Link to={`/player/${userData.slug}`} className="text-xs text-primary hover:underline">
            {t("playerProfile.viewProfile")}
          </Link>
        </div>
        <SearchCraftEmbedBody
          crafts={crafts}
          remaps={remaps}
          presetMode={!!presetName}
          rawLoopsData={rawLoopsData}
          liveLoops={userData.searchCraftLoops}
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
    <div className="my-4 rounded-xl border border-dashed border-border/70 bg-card p-4 text-sm text-muted-foreground">
      {t("guideView.embedTemplateUnavailable")}
    </div>
  );
}

export function SearchCraftTemplateEmbedView({
  template,
}: {
  /** null = 表示できない（ID 不正・未公開・削除済み・非公開プロフィール） */
  template: EmbedTemplateData | null;
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
    <div className="my-4 not-prose">
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
            className="-mx-2 -my-3 inline-flex items-center px-2 py-3 text-xs text-primary hover:underline"
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
