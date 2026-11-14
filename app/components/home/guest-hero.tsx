import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  FeaturedKeys,
  FeaturedNextButton,
  FeaturedReasonRow,
  useFeaturedRotation,
} from "@/components/home/featured-runner-card";
import { useT, useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { getLocalizedDisplayName } from "@/lib/slug";
import { categoryLabel, isCategoryKey } from "@/lib/playstyle";
import { formatClock } from "@/lib/home-format";
import type { FeaturedRunner } from "@/lib/home-featured";
import { ArrowRight, Search, Sparkles } from "lucide-react";

/** 顔ぶれの帯に出す走者（公開一覧に出ている項目の部分集合） */
export interface HeroFace {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  displayNameAlphabet?: string | null;
  customSkinUrl?: string | null;
}

/** 帯に並べる最大人数（1行） */
const MAX_FACES = 10;

/**
 * 帯の幅（@container）に収まる人数だけ出すための表示クラス。タイル 48px・間隔 8px なので、
 * i 番目（0始まり）のタイルには 56i + 48 px の幅が要る。収まらないタイルは display:none にして
 * はみ出しと見えないリンクへのフォーカスを防ぐ（Tailwind が拾えるようクラス文字列は静的に列挙する）
 */
const FACE_VISIBILITY = [
  "flex",
  "flex",
  "flex",
  "flex",
  "hidden @[17rem]:flex", // 272px
  "hidden @[20.5rem]:flex", // 328px
  "hidden @[24rem]:flex", // 384px
  "hidden @[27.5rem]:flex", // 440px
  "hidden @[31rem]:flex", // 496px
  "hidden @[34.5rem]:flex", // 552px
] as const;

function FaceTile({ face, index }: { face: HeroFace; index: number }) {
  const locale = useLocale();
  const name = getLocalizedDisplayName(face, locale);
  return (
    <Link
      to={`/player/${face.slug}`}
      prefetch="intent"
      aria-label={name}
      title={name}
      className={cn(
        "size-12 shrink-0 items-center justify-center rounded-lg border border-transparent bg-secondary/50 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        FACE_VISIBILITY[index] ?? "hidden",
      )}
    >
      <MinecraftAvatar uuid={face.uuid} skinUrl={face.customSkinUrl} mcid={face.mcid} size={40} className="rounded" />
    </Link>
  );
}

/**
 * 未ログイン時のホームのヒーロー。左＝見出し・CTA・走者の顔ぶれの帯、右＝注目の走者（枠で包まない）。
 * 注目の走者を回す処理・理由行・キー部分は FeaturedRunnerCard（ログイン時）と共有している。
 */
export function GuestHero({
  candidates,
  initial,
  faces,
  totalPublicProfiles,
}: {
  candidates: FeaturedRunner[];
  initial: FeaturedRunner | null;
  faces: HeroFace[];
  totalPublicProfiles: number;
}) {
  const t = useT();
  const locale = useLocale();
  const { current, loading, announce, handleClick } = useFeaturedRotation(candidates, initial);
  const nextButton = <FeaturedNextButton onClick={handleClick} loading={loading} />;

  // 注目の走者として右に出ている人は帯から除く
  const shownFaces = faces.filter((f) => f.slug !== current?.slug).slice(0, MAX_FACES);

  const name = current ? getLocalizedDisplayName(current, locale) : "";
  const sensitivity =
    current?.sensitivityPercent != null
      ? current.cm180 != null
        ? `${current.sensitivityPercent}% · ${current.cm180.toFixed(1)} cm/180°`
        : `${current.sensitivityPercent}%`
      : null;

  return (
    <section aria-labelledby="home-hero-heading" className="rounded-2xl border border-border/70 bg-card p-6 sm:p-8">
      {/* 左列をやや広く取り、ja の1行目（「RTAをパーソナリティから」）が各段の文字サイズで1行に収まるようにする */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            {/* 文言中の改行（ja: 「…から」の後）で区切る。改行の無い英語は text-balance で行長を揃える。
                モバイルは text-2xl まで（それより大きいと1行目が「パーソ／ナリティ」の途中で折れる）。
                sm 以上は text-4xl で一定（画面幅で大きくせず、ヒーローの上下に余白を残す） */}
            <h1
              id="home-hero-heading"
              className="whitespace-pre-line text-balance text-2xl font-bold leading-tight tracking-tight sm:text-4xl"
            >
              {t("home.heroTitle")}
            </h1>
            <p className="max-w-xl text-base text-muted-foreground sm:text-lg">{t("home.heroDescription")}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/login">
                {t("home.ctaStart")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link to="/browse">
                <Search className="mr-2 h-4 w-4" />
                {t("home.ctaBrowse")}
              </Link>
            </Button>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{t("home.ctaLoginNote")}</p>

          {/* 走者の顔ぶれ（1行。いる人数だけ並べ、0人なら帯ごと出さない） */}
          {shownFaces.length > 0 && (
            <div className="@container space-y-2 pt-1">
              <div className="flex gap-2">
                {shownFaces.map((f, i) => (
                  <FaceTile key={f.slug} face={f} index={i} />
                ))}
              </div>
              {totalPublicProfiles > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("home.profileCount", { count: totalPublicProfiles.toLocaleString(locale) })}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 主役: 注目の走者（枠で包まず、リンクは顔と名前だけ） */}
        <section
          aria-labelledby="home-featured-heading"
          className="min-w-0 space-y-3 lg:border-l lg:border-border/60 lg:pl-10"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="home-featured-heading" className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              {current ? t("home.featuredTitle") : t("home.featuredEmptyTitle")}
            </h2>
            {nextButton}
          </div>

          {current ? (
            // 高さを保つため、取得中は中身を薄くするだけで差し替えない
            <div aria-busy={loading} className={cn("space-y-3 transition-opacity", loading && "opacity-50")}>
              <FeaturedReasonRow runner={current} />

              <div className="flex items-center gap-4">
                {/* 名前のリンクと同じ遷移先なので、タブ停止と読み上げは名前の方に任せる */}
                <Link
                  to={`/player/${current.slug}`}
                  prefetch="intent"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="flex size-28 shrink-0 items-center justify-center rounded-xl border border-transparent bg-secondary/50 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <MinecraftAvatar
                    uuid={current.uuid}
                    skinUrl={current.customSkinUrl}
                    mcid={current.mcid}
                    size={96}
                    className="rounded-lg"
                  />
                </Link>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="truncate text-xl font-bold leading-snug">
                    <Link
                      to={`/player/${current.slug}`}
                      prefetch="intent"
                      className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {name}
                    </Link>
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {isCategoryKey(current.mainCategory) && (
                      <Badge variant="secondary" className="shrink-0 rounded-full px-2 py-0.5 text-[11px]">
                        {categoryLabel(t, current.mainCategory)}
                      </Badge>
                    )}
                    {current.pbMs != null && (
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        <span className="mr-1 text-[11px] font-normal text-muted-foreground">PB</span>
                        {formatClock(current.pbMs)}
                      </span>
                    )}
                  </div>
                  {sensitivity && (
                    <p className="font-mono text-xs tabular-nums text-muted-foreground">{sensitivity}</p>
                  )}
                </div>
              </div>

              <FeaturedKeys runner={current} className="border-t border-border/60 pt-3" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("home.featuredEmptyDescription")}</p>
          )}

          {/* 切り替え後に新しい走者の名前を読み上げる */}
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>
        </section>
      </div>
    </section>
  );
}
