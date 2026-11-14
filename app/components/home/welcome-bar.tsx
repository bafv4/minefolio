import { useState } from "react";
import { Link } from "react-router";
import type { HomeLayout } from "@/lib/home-sections";
import { Button } from "@/components/ui/button";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { HomeSettingsDialog } from "@/components/home/home-settings-dialog";
import { useT } from "@/hooks/use-locale";
import { Heart, Pencil, Settings2, User } from "lucide-react";

/** ログイン済みの「おかえりなさい」バー。宣伝の見出し・説明や自分のペース・PB は出さない。作成24時間以内は「ようこそ」 */
export function WelcomeBar({
  name,
  slug,
  uuid,
  skinUrl,
  isNewAccount = false,
  layout,
  liveCount,
  liveSplit,
}: {
  name: string;
  slug: string;
  uuid: string | null;
  skinUrl: string | null;
  /** アカウント作成から24時間以内（初回訪問に「おかえりなさい」と出さない） */
  isNewAccount?: boolean;
  /** 設定モーダルの編集初期値（現在の欄の並び・表示） */
  layout: HomeLayout;
  /** 走行中の人数（ライブ取得が落ち着いていないとき・0件のときは 0。チップを出さない） */
  liveCount: number;
  /** いちばん先の区間にいる走者の区間名（PaceManSplitMark の timeline）。無ければ null */
  liveSplit: string | null;
}) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const greeting = t(isNewAccount ? "home.welcomeNew" : "home.welcomeBack", { name });
  // ライブ欄が非表示のときはページ内リンク先が無いので /paces へ
  const liveHref = layout.hidden.includes("live") ? "/paces" : "#home-live";
  return (
    <section
      aria-label={greeting}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm sm:gap-x-4 sm:px-5"
    >
      <Link to={`/player/${slug}`} className="shrink-0" aria-hidden="true" tabIndex={-1}>
        <MinecraftAvatar uuid={uuid} skinUrl={skinUrl} size={44} className="rounded-xl" />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold">{greeting}</p>
        {liveCount > 0 && (
          <Link
            to={liveHref}
            aria-label={t("home.liveCountAria", { count: liveCount })}
            className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
            <span className="truncate">{t("home.welcomeLiveChip", { count: liveCount })}</span>
            {liveSplit && <PaceManSplitMark timeline={liveSplit} size={16} withLabel={false} className="shrink-0" />}
          </Link>
        )}
      </div>
      {/* DOM 順（＝フォーカス順）は 編集 → マイプロフィール → お気に入り → 設定。モバイルは2段目に折り返し、設定は末尾（右端） */}
      <div className="flex w-full items-center gap-x-1 sm:w-auto sm:gap-x-2">
        <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
          <Link to="/me/edit">
            <Pencil className="mr-1.5 h-4 w-4" />
            {t("home.welcomeEditProfile")}
          </Link>
        </Button>
        {/* モバイルは2つ目以降をアイコンのみ（44px 角）にして1行に収める。ラベルは sr-only で残す */}
        <Button asChild variant="ghost" className="min-h-11 max-sm:w-11 max-sm:px-0 sm:min-h-9">
          <Link to={`/player/${slug}`}>
            <User className="h-4 w-4 sm:mr-1.5" />
            <span className="sr-only sm:not-sr-only">{t("home.welcomeMyProfile")}</span>
          </Link>
        </Button>
        <Button asChild variant="ghost" className="min-h-11 max-sm:w-11 max-sm:px-0 sm:min-h-9">
          <Link to="/favorites">
            <Heart className="h-4 w-4 sm:mr-1.5" />
            <span className="sr-only sm:not-sr-only">{t("home.welcomeFavorites")}</span>
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto min-h-11 max-sm:w-11 max-sm:px-0 sm:ml-0 sm:min-h-9"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="h-4 w-4 sm:mr-1.5" />
          <span className="sr-only sm:not-sr-only">{t("home.welcomeCustomize")}</span>
        </Button>
      </div>
      <HomeSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} layout={layout} />
    </section>
  );
}
