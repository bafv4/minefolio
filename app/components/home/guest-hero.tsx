import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  FeaturedCategoryPb,
  FeaturedKeys,
  FeaturedNextButton,
  FeaturedReasonRow,
  FeaturedSensitivity,
  useFeaturedRotation,
} from "@/components/home/featured-runner-card";
import { useT, useLocale } from "@/hooks/use-locale";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { getLocalizedDisplayName } from "@/lib/slug";
import type { FeaturedRunner } from "@/lib/home-featured";
import { ArrowRight, Search, Sparkles } from "lucide-react";

/** 見出しで入れ替えて出す走者（公開一覧に出ている項目の部分集合） */
export interface HeroFace {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  displayNameAlphabet?: string | null;
  customSkinUrl?: string | null;
}

/** 見出しのスキンを入れ替える間隔 */
const FACE_ROTATE_MS = 8000;
/** 翻訳文中の {emphasis} の位置を見つけるための目印（制御文字なので文言には現れない） */
const EMPHASIS_MARK = "\u0001";

/** index の人。ただし除外対象なら次の除外対象でない人（全員が除外対象なら -1） */
function resolveFaceIndex(faces: HeroFace[], from: number, excludeSlug: string | null): number {
  for (let k = 0; k < faces.length; k++) {
    const i = (from + k) % faces.length;
    if (faces[i].slug !== excludeSlug) return i;
  }
  return -1;
}

/**
 * 見出しの強調部分に置くスキン。全員分の枠を重ねて opacity だけ切り替える（クロスフェード）。
 * 中のスキン画像は「表示中の人と次の人」だけ描き（一度描いた人は残す）、開いた直後に /api/skin を一斉に出さない。次の人は先に読み込まれるので切り替えで空白が出ない。
 * 48px で描いて、枠（見出しの文字と同じ 1.1em）に CSS で合わせる。装飾なので読み上げない。
 * `excludeSlug`（右列に出ている注目の走者）は出さない。リストは絞り込まず、表示する人を
 * 「index の人。除外対象なら次の除外対象でない人」として導出する（注目の走者が変わっても index がずれない）。
 * 初期表示（SSR・ハイドレーション）は、除外対象を除いた先頭の人。入れ替えは reduced-motion と非表示タブで止める。
 * 出せる人が0人なら枠ごと出さず、1人ならタイマーを張らない。
 */
function RotatingHeadingSkins({ faces, excludeSlug }: { faces: HeroFace[]; excludeSlug: string | null }) {
  const [index, setIndex] = useState(0);
  const excludeRef = useRef(excludeSlug);
  excludeRef.current = excludeSlug;

  const eligible = faces.filter((f) => f.slug !== excludeSlug).length;
  const canRotate = eligible >= 2;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    if (!canRotate || reducedMotion) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setIndex((i) => {
        // いま表示中の人（除外対象なら次の人）の、さらに次の除外対象でない人へ進める
        const shown = resolveFaceIndex(faces, i, excludeRef.current);
        if (shown < 0) return i;
        const next = resolveFaceIndex(faces, shown + 1, excludeRef.current);
        return next < 0 ? i : next;
      });
    }, FACE_ROTATE_MS);
    return () => clearInterval(timer);
  }, [canRotate, reducedMotion, faces]);

  const shownIndex = resolveFaceIndex(faces, index, excludeSlug);
  const nextIndex = shownIndex < 0 ? -1 : resolveFaceIndex(faces, shownIndex + 1, excludeSlug);
  const shownSlug = shownIndex < 0 ? null : faces[shownIndex].slug;
  const nextSlug = nextIndex < 0 || nextIndex === shownIndex ? null : faces[nextIndex].slug;

  // 描画済み（読み込み始めた）人。一度描いた人は残し、また回ってきたときに読み込み直さずクロスフェードできるようにする。
  // 初期（SSR・ハイドレーション）は「表示中＋次」だけで、入れ替え・除外の変化のたびに新しい人を足す
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setLoaded((prev) => {
      const add = [shownSlug, nextSlug].filter((s): s is string => s !== null && !prev.has(s));
      return add.length === 0 ? prev : new Set([...prev, ...add]);
    });
  }, [shownSlug, nextSlug]);

  if (shownIndex < 0) return null;

  return (
    <span
      aria-hidden="true"
      className="relative mr-1 inline-block size-[1.1em] shrink-0 align-[-0.15em] [&_div]:!size-full [&_img]:!size-full"
    >
      {faces.map((f, i) => (
        <span
          key={f.slug}
          className={cn(
            "absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none",
            i === shownIndex ? "opacity-100" : "opacity-0",
          )}
        >
          {(loaded.has(f.slug) || f.slug === shownSlug || f.slug === nextSlug) && (
            <MinecraftAvatar uuid={f.uuid} skinUrl={f.customSkinUrl} mcid={f.mcid} size={48} className="rounded" />
          )}
        </span>
      ))}
    </span>
  );
}

/** 見出し。{emphasis}（［スキン］＋強調語）をブランド色の下線でまとめ、直後の非空白文字（ja の「から」）と改行させない */
function HeroHeading({ faces, excludeSlug }: { faces: HeroFace[]; excludeSlug: string | null }) {
  const t = useT();
  const parts = t("home.heroTitle", { emphasis: EMPHASIS_MARK }).split(EMPHASIS_MARK);
  if (parts.length !== 2) return <>{t("home.heroTitle", { emphasis: t("home.heroTitleEmphasis") })}</>;
  const [before, after] = parts;
  const tail = after.match(/^\S+/)?.[0] ?? "";
  return (
    <>
      {before}
      <span className="whitespace-nowrap">
        <span className="inline-block border-b-[3px] border-brand pb-0.5">
          {faces.length > 0 && <RotatingHeadingSkins faces={faces} excludeSlug={excludeSlug} />}
          {t("home.heroTitleEmphasis")}
        </span>
        {tail}
      </span>
      {after.slice(tail.length)}
    </>
  );
}

/**
 * 未ログイン時のホームのヒーロー。左＝見出し（強調語の前でスキンが入れ替わる）・CTA、右＝注目の走者（枠で包まない）。
 * 注目の走者を回す処理・理由行・キー部分は FeaturedRunnerCard（ログイン時）と共有している。
 */
export function GuestHero({
  candidates,
  initial,
  faces,
}: {
  candidates: FeaturedRunner[];
  initial: FeaturedRunner | null;
  faces: HeroFace[];
}) {
  const t = useT();
  const locale = useLocale();
  const { current, loading, announce, handleClick } = useFeaturedRotation(candidates, initial);
  const nextButton = <FeaturedNextButton onClick={handleClick} loading={loading} />;

  const name = current ? getLocalizedDisplayName(current, locale) : "";

  return (
    <section aria-labelledby="home-hero-heading" className="rounded-2xl border border-border/70 bg-card p-6 sm:p-8">
      {/* 左列を広めに取り、ja の1行目（「RTAを［スキン］パーソナリティから」）が lg 以上で1行に収まるようにする。
          xl 以上は幅に余裕があるので比率を戻し、右列のキーを1段に並べる幅を残す */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center lg:gap-10 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            {/* 文言中の改行（ja: 「…から」の後）で区切る。改行の無い英語は text-balance で行長を揃える。
                モバイルは text-2xl まで（それより大きいと1行目が「パーソ／ナリティ」の途中で折れる）。
                sm 以上は text-4xl で一定（画面幅で大きくせず、ヒーローの上下に余白を残す） */}
            <h1
              id="home-hero-heading"
              className="whitespace-pre-line text-balance text-2xl font-bold leading-tight tracking-tight sm:text-4xl"
            >
              <HeroHeading faces={faces} excludeSlug={current?.slug ?? null} />
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
                    <FeaturedCategoryPb runner={current} />
                  </div>
                  <FeaturedSensitivity runner={current} />
                </div>
              </div>

              {/* 人の情報（名前・自己ベスト・感度）の後に「直近7日に何があったか」を置く（名前より前だと誰の話か分からない） */}
              <FeaturedReasonRow runner={current} />

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
