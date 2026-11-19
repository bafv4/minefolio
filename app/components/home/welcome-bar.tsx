import { useRef, useState } from "react";
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
  const customizeRef = useRef<HTMLButtonElement>(null);
  const greeting = t(isNewAccount ? "home.welcomeNew" : "home.welcomeBack", { name });
  // ライブ欄が非表示のときはページ内リンク先が無いので /paces へ
  const liveHref = layout.hidden.includes("live") ? "/paces" : "#home-live";
  return (
    <section
      aria-label={greeting}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border/70 bg-card/70 px-4 py-3 sm:gap-x-4 sm:px-5"
    >
      {/* モバイル: アバターがマイプロフィールの入口（ボタンは出さない）。sm 以上は右の「マイプロフィール」ボタンが
          同じ行き先なので、アバターはクリックだけ受けて Tab 停止と読み上げはボタンに任せる（停止点を1つにする）。
          幅で切り替えるので両方を描いて CSS で出し分ける */}
      <Link
        to={`/player/${slug}`}
        aria-label={t("home.welcomeMyProfile")}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
      >
        <MinecraftAvatar uuid={uuid} skinUrl={skinUrl} size={44} className="rounded-xl" />
      </Link>
      <Link
        to={`/player/${slug}`}
        tabIndex={-1}
        aria-hidden="true"
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl max-sm:hidden"
      >
        <MinecraftAvatar uuid={uuid} skinUrl={skinUrl} size={44} className="rounded-xl" />
      </Link>
      <div className="min-w-0 flex-1 sm:basis-72">
        <p className="truncate text-base font-semibold">{greeting}</p>
        {liveCount > 0 && (
          <Link
            to={liveHref}
            className="mt-1 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/75 px-3 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mt-0.5"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
            <span className="truncate">{t("home.welcomeLiveChip", { count: liveCount })}</span>
            {liveSplit && <PaceManSplitMark timeline={liveSplit} size={16} withLabel={false} className="shrink-0" />}
          </Link>
        )}
      </div>
      {/* DOM 順（＝フォーカス順）は アバター（マイプロフィール。モバイルのみ）→ 編集 → マイプロフィール（sm 以上のみ）→ お気に入り → 設定。モバイルは2段目に折り返し、設定は末尾（右端） */}
      <div className="flex w-full items-center gap-x-1 sm:ml-auto sm:w-auto sm:flex-wrap sm:justify-end sm:gap-x-2">
        <Button asChild variant="outline" className="min-h-11 max-sm:has-[>svg]:px-2 sm:min-h-9">
          {/* モバイルは「カスタマイズ」の文字を残すぶん、編集は短い表記にして1行に収める（読み上げは全文） */}
          <Link to="/me/edit" aria-label={t("home.welcomeEditProfile")}>
            <Pencil className="h-4 w-4 sm:mr-1.5" />
            <span className="sm:hidden">{t("home.welcomeEditProfileShort")}</span>
            <span className="max-sm:hidden">{t("home.welcomeEditProfile")}</span>
          </Link>
        </Button>
        {/* モバイルのマイプロフィールはアバターのリンクが担うのでボタンを出さない（空いた幅でお気に入りも文字付きにする）。
            モバイルは基底の has-[>svg]:px-3 とアイコンの mr-1.5（基底の gap-2 と二重）を詰めて、3つを1行に収める */}
        <Button asChild variant="ghost" className="min-h-11 max-sm:hidden sm:min-h-9">
          <Link to={`/player/${slug}`}>
            <User className="mr-1.5 h-4 w-4" />
            {t("home.welcomeMyProfile")}
          </Link>
        </Button>
        <Button asChild variant="ghost" className="min-h-11 max-sm:has-[>svg]:px-2 sm:min-h-9">
          <Link to="/favorites">
            <Heart className="h-4 w-4 sm:mr-1.5" />
            {t("home.welcomeFavorites")}
          </Link>
        </Button>
        <Button
          ref={customizeRef}
          type="button"
          variant="ghost"
          className="ml-auto min-h-11 max-sm:has-[>svg]:px-2 sm:ml-0 sm:min-h-9"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="h-4 w-4 sm:mr-1.5" />
          {t("home.welcomeCustomize")}
        </Button>
      </div>
      <HomeSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        layout={layout}
        // 制御型で DialogTrigger を使わないので、閉じたとき（キャンセル・Esc・保存）に開いたボタンへフォーカスを戻す
        returnFocusRef={customizeRef}
      />
    </section>
  );
}
