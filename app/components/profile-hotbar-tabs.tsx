import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { LucideIcon } from "lucide-react";

import { hotbarTabForKey, type ProfileHotbarGroup } from "@/lib/profile-hotbar";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface ProfileHotbarItem {
  value: string;
  icon: LucideIcon;
  /** スロットに常時表示する短いラベル */
  shortLabel: string;
  /** 長いラベル（短いラベルと異なるときはツールチップに出す） */
  label: string;
  /** 未登録（中身が無い）スロット。押せる状態は保つ */
  empty: boolean;
  group: ProfileHotbarGroup;
}

/**
 * md 以上のバーの貼り付き位置。サイトヘッダー（layout/header.tsx: `h-16`＋下罫線 1px＝65px）より 1px 上にして、
 * ヘッダーの下に 1px もぐらせる（ヘッダーは z-50 でバーより手前）。ちょうど 65px で接すると、表示倍率 125%・150% 等で
 * 境目が小数の画素位置（81.25 等）になり、両者が半端に塗る1行から下のコンテンツが透けてちらつくため。
 * バーの `md:top-[64px]` と揃える
 */
const STICKY_TOP_PX = 64;
/** 貼り付き中のタブ切替で戻すときの、番兵の viewport 上端からの位置。
 * コンパクトバー（57px）＋フロー上の高さ 72px＋gap 24px の下に新タブの先頭が出るよう逆算した値 */
const SCROLL_RESTORE_SENTINEL_TOP_PX = 42;

interface ProfileHotbarTabsProps {
  /** 並び順どおり。数字キー 1〜9 がこの順に対応する */
  items: readonly ProfileHotbarItem[];
  activeValue: string;
  onSelect: (value: string) => void;
  /** lg 以上でホットバーと同じ行の右端（貼り付き時もバーの中）に置く部品（プリセット選択等）。tablist の外に置く。lg 未満では出さない（消費側がタイトル行の右に置く） */
  trailing?: React.ReactNode;
  /** 貼り付き中（md 以上）だけバーの左に出す表示用の部品（走者のアバター＋名前）。tablist の外に置く。貼り付く前・md 未満では出さない。aria-hidden（身元帯の h1 と重複するため読み上げない） */
  leading?: React.ReactNode;
}

/**
 * プロフィール専用のホットバー型タブ列。
 *
 * 消費側の Root（`ui/tabs` の `<Tabs>`）には `activationMode="manual"`（矢印キーはフォーカス移動のみ、
 * Enter/Space で切替）を付け、向きは既定の horizontal のままにする。タブ切替を履歴に積むため、
 * 矢印で動くたびに履歴が増えるのを避ける。`ui/tabs` の TabsList / TabsTrigger（フォルダ型）は使わない。
 *
 * - md 以上: 横一列のスロット（アイコン＋短いラベル）。ヘッダー直下に sticky で追従し、貼り付いたら
 *   コンパクト表示（横長の低いスロット＋背景＋下罫線）。貼り付き判定は番兵＋IntersectionObserver
 * - md 未満: 画面下端固定（`data-bottom-dock`。高さは app.css の `--bottom-dock-height`）。アイコンのみ
 * - 数字キーはこの tablist にフォーカスがあるときだけ効く（ページ全体のキー監視はしない）
 */
export function ProfileHotbarTabs({ items, activeValue, onSelect, trailing, leading }: ProfileHotbarTabsProps) {
  const t = useT();
  const triggerRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const active = items.find((i) => i.value === activeValue);

  // md 以上でヘッダー直下に貼り付いたか。番兵（バーの直前に置く 1px の要素）がヘッダーの裏へ出たら貼り付き。
  // scroll イベントではなく IntersectionObserver で判定する（state が変わるのは貼り付き/解除の瞬間だけ）
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = React.useState(false);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: `-${STICKY_TOP_PX}px 0px 0px 0px`,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 貼り付き中に別タブを選んだら、新しいタブの先頭がコンパクトバーの直下に見える位置へ戻す
  // （タブ切替は preventScrollReset でスクロール位置を保つため、深くスクロールしたままだと新タブの先頭が画面の上に外れる）
  // クリック（Root の onValueChange 経由）・数字キー・戻る/進むのどれでも activeValue の変化で一本化して処理する。
  // 番兵がこの位置より上にあれば、貼り付き（ヘッダーの裏へ出た状態）に必ずなっているので、貼り付き判定は別に持たない
  // md 未満（ホットバーは下端固定で番兵は display:none）は、新タブのタイトル h2（profile.tsx の ProfileTabTitle）が
  // 画面の上（サイトヘッダーの裏を含む）に外れているときだけ、:root の scroll-padding-top（--sticky-bar-inset）の位置へ戻す。
  // 見えているとき（身元帯が見える浅い位置など）は動かさない
  const prevActiveRef = React.useRef(activeValue);
  React.useEffect(() => {
    if (prevActiveRef.current === activeValue) return;
    prevActiveRef.current = activeValue;
    if (!window.matchMedia("(min-width: 768px)").matches) {
      // 新しいパネルの中身は、この effect の時点ではまだ DOM に無い（Radix の TabsContent は Presence 経由で、
      // 選択が変わった次のコミットで子を描く）。タイトルが現れるまでフレームごとに待ち、現れた次のフレーム
      // （ブラウザのスクロールアンカーによる位置の補正が済んだ後）で位置を測って戻す
      let frame = 0;
      let tries = 0;
      const restore = () => {
        const title = document.getElementById(`profile-tab-title-${activeValue}`);
        if (!title) {
          if (++tries < 30) frame = requestAnimationFrame(restore);
          return;
        }
        frame = requestAnimationFrame(() => {
          const inset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
          const titleTop = title.getBoundingClientRect().top;
          if (titleTop < inset) window.scrollBy({ top: titleTop - inset });
        });
      };
      restore();
      return () => cancelAnimationFrame(frame);
    }
    const el = sentinelRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < SCROLL_RESTORE_SENTINEL_TOP_PX) window.scrollBy({ top: top - SCROLL_RESTORE_SENTINEL_TOP_PX });
  }, [activeValue]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = hotbarTabForKey(
      e,
      items.map((i) => i.value),
    );
    if (target === null) return;
    e.preventDefault();
    if (target === activeValue) return;
    onSelect(target);
    triggerRefs.current.get(target)?.focus();
  }

  return (
    <>
    {/* 番兵（md 以上のみ）。次のバーの直前に置き、-mb で親の gap（gap-6=24px）を打ち消して位置をバーの上端に重ねる */}
    <div ref={sentinelRef} aria-hidden="true" className="pointer-events-none h-px max-md:hidden md:-mb-[25px]" />
    <div
      data-bottom-dock
      data-stuck={stuck}
      className={cn(
        "group/bar max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-[var(--bottom-dock-height)] max-md:border-t max-md:border-border max-md:bg-background/95 max-md:pb-[env(safe-area-inset-bottom,0px)] max-md:backdrop-blur",
        // md 以上はヘッダー直下に追従（z はヘッダー z-50 より下）。貼り付き中は背景＋下罫線のコンパクトバー。
        // コンパクト時は高さが縮むぶん mb で埋め、フロー上の高さ（72px）を保って切替時に下の内容が跳ねないようにする
        "md:sticky md:top-[64px] md:z-40 md:transition-colors",
        // trailing（lg 以上のみ表示）を右端に置くための横並び。折り返さない（折り返すと貼り付き前後でバーの高さが変わり、貼り付き判定が点滅する）
        "md:flex md:items-center md:justify-start md:gap-x-3",
        "md:data-[stuck=true]:mb-[15px] md:data-[stuck=true]:border-b md:data-[stuck=true]:border-border/70 md:data-[stuck=true]:bg-background md:data-[stuck=true]:py-2",
        // 貼り付き中は背景を左右 8px 広げ（中身の位置は px で据え置き）、下を流れる要素の小さなはみ出し（-mx の開閉ボタン・リング等）を覆う
        "md:data-[stuck=true]:-mx-2 md:data-[stuck=true]:px-2",
      )}
    >
      <p
        aria-hidden="true"
        className="truncate px-3 pt-1 text-center text-xs font-medium leading-5 text-muted-foreground md:hidden"
      >
        {active?.label}
      </p>
      {leading && (
        <div
          aria-hidden="true"
          className="hidden min-w-0 shrink items-center gap-2 md:group-data-[stuck=true]/bar:flex"
        >
          {leading}
          {/* スキン・名前とタブの区切り線（タブのグループ区切りと同じ見た目） */}
          <span className="ml-1 h-6 w-px shrink-0 bg-border" />
        </div>
      )}
      <TabsPrimitive.List
        aria-label={t("playerProfile.hotbarAriaLabel")}
        onKeyDown={handleKeyDown}
        className="group/list flex items-center gap-0.5 px-1 pt-1 md:w-fit md:shrink-0 md:gap-1.5 md:p-0 md:group-data-[stuck=true]/bar:gap-1"
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          // 数字キー 1〜9（hotbarTabForKey と同じ対応）。10 番目以降はショートカット無し
          const shortcutKey = index < 9 ? String(index + 1) : undefined;
          const showTooltip = item.label !== item.shortLabel || shortcutKey !== undefined;
          const tooltipText = shortcutKey
            ? t("playerProfile.hotbarTooltipWithKey", { label: item.label, key: shortcutKey })
            : item.label;
          const baseName = item.label.includes(item.shortLabel) ? item.label : item.shortLabel;
          const name = item.empty
            ? `${baseName}${t("playerProfile.hotbarEmptySuffix")}`
            : baseName;
          const prev = items[index - 1];
          const trigger = (
            <TabsPrimitive.Trigger
              ref={(el) => {
                if (el) triggerRefs.current.set(item.value, el);
                else triggerRefs.current.delete(item.value);
              }}
              value={item.value}
              aria-label={name}
              aria-keyshortcuts={shortcutKey}
              className={cn(
                "group relative flex min-w-9 flex-1 flex-col items-center justify-center gap-1 rounded-lg border-2 text-muted-foreground transition-colors outline-none",
                "h-11 md:size-[4.5rem] md:flex-none",
                // 貼り付き中はコンパクト（横長の低いスロット。アイコン＋短いラベルを横並び）。
                // lg 未満（768〜1023px）は8個がバー幅に収まるよう左右の余白を詰める
                "md:group-data-[stuck=true]/bar:h-10 md:group-data-[stuck=true]/bar:w-auto md:group-data-[stuck=true]/bar:flex-row md:group-data-[stuck=true]/bar:gap-1 md:group-data-[stuck=true]/bar:px-1.5",
                "lg:group-data-[stuck=true]/bar:gap-1.5 lg:group-data-[stuck=true]/bar:px-3",
                "hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                // 選択状態は aria-selected で判定する。ツールチップ付きのスロットは TooltipTrigger（asChild）が
                // data-state を closed / delayed-open で上書きするため、data-[state=active] が効かない
                "aria-selected:border-foreground aria-selected:bg-secondary/50 aria-selected:text-foreground",
                // 空スロットは破線＋薄い表示（押せる状態は保つ）。選択中は aria-selected: が優先される。
                // 薄くするのはアイコンだけ（下）。押せる部品のラベルなので文字は 4.5:1 を保つため薄めない
                item.empty
                  ? "border-dashed border-muted-foreground/70"
                  : "border-transparent md:border-border/70",
                item.empty && "aria-selected:border-solid",
              )}
            >
              {/* 数字キーの発見用の番号。キーボードでバーにフォーカスがある間だけ md 以上で出す（マウス操作では出ない）。
                  absolute なのでアイコン・ラベルの位置は動かない。貼り付き中のコンパクトスロットは左端にアイコンがあり重なるため出さない。
                  意味は aria-keyshortcuts とツールチップが担うので読み上げない */}
              {shortcutKey && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1 top-0.5 hidden font-mono text-[10px] leading-none tabular-nums text-muted-foreground opacity-0 transition-opacity duration-150 group-aria-selected:text-foreground group-has-[:focus-visible]/list:opacity-100 md:block md:group-data-[stuck=true]/bar:hidden"
                >
                  {shortcutKey}
                </span>
              )}
              <Icon
                aria-hidden="true"
                className={cn("size-5 shrink-0", item.empty && "opacity-70 group-aria-selected:opacity-100")}
              />
              <span aria-hidden="true" className="hidden text-xs leading-none md:block">
                {item.shortLabel}
              </span>
            </TabsPrimitive.Trigger>
          );
          return (
            <React.Fragment key={item.value}>
              {prev && prev.group !== item.group && (
                <span
                  aria-hidden="true"
                  className="mx-0.5 h-6 w-px shrink-0 bg-border md:mx-1.5 md:h-10 md:group-data-[stuck=true]/bar:h-6"
                />
              )}
              {showTooltip ? (
                <Tooltip>
                  <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                  <TooltipContent className="max-md:hidden">{tooltipText}</TooltipContent>
                </Tooltip>
              ) : (
                trigger
              )}
            </React.Fragment>
          );
        })}
      </TabsPrimitive.List>
      {/* lg 未満（〜1023px）はスロット8個だけでバー幅がほぼ埋まり、貼り付き前後でバーの高さが変わって点滅するため、
          trailing は出さない（プリセットはタイトル行の右に出る）。lg 以上でバーの右端に置く */}
      {trailing && <div className="min-w-0 max-lg:hidden lg:ml-auto">{trailing}</div>}
    </div>
    </>
  );
}
