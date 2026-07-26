import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLike, type LikeTargetType } from "@/hooks/use-likes";
import { useT } from "@/hooks/use-locale";

interface LikeButtonProps {
  targetType: LikeTargetType;
  /** guides.id / searchCraftTemplates.id（guides.slug は著者内でしか一意でない） */
  targetId: string;
  /** ローダー由来のいいね数 */
  likeCount: number;
  /** ローダー由来の「いいね済みか」（未指定なら LikesProvider の集合で判定） */
  isLiked?: boolean;
  /** 自分の投稿（いいね不可。件数は表示する） */
  isOwn?: boolean;
  /** compact: 一覧カードのメタ行 / detail: 詳細ページのアクション行 */
  variant?: "compact" | "detail";
  className?: string;
}

/**
 * いいね（グッド）ボタン。
 *
 * - 色はテーマトークン `--brand` を使う（3テーマ対応。favorite-button の text-red-500 は
 *   固定色で ui.md 違反かつお気に入りと同色になるため流用しない）
 * - compact は一覧カード用。カード全体が <Link> のため、押せない状態では
 *   インタラクティブ要素を一切描画しない（<a> の中に <button>/<a> は不正なHTML）
 */
export function LikeButton({
  targetType,
  targetId,
  likeCount,
  isLiked = false,
  isOwn = false,
  variant = "compact",
  className,
}: LikeButtonProps) {
  const t = useT();
  const { liked, count, isPending, isLoggedIn, toggle } = useLike(targetType, targetId, {
    liked: isLiked,
    count: likeCount,
  });

  const canLike = isLoggedIn && !isOwn;

  const handleClick = (e: React.MouseEvent) => {
    // 一覧カードは行/カード全体が <Link>。遷移とバブリングの両方を止める
    e.preventDefault();
    e.stopPropagation();
    if (isPending || !canLike) return;
    toggle();
  };

  if (variant === "compact") {
    // 押せない場合（未ログイン / 自分の投稿）は静的表示にする
    if (!canLike) {
      return (
        <span
          // relative z-10: カード全体を覆うリンクのオーバーレイより手前に置く
          className={cn("relative z-10 inline-flex items-center gap-1", className)}
          title={isOwn ? t("likes.ownContent") : t("likes.loginToLike")}
        >
          <ThumbsUp className="h-3 w-3" aria-hidden />
          <span className="tabular-nums">{count}</span>
        </span>
      );
    }

    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-pressed={liked}
        aria-busy={isPending}
        aria-label={
          liked ? t("likes.removeAria", { count }) : t("likes.addAria", { count })
        }
        className={cn(
          // relative z-10: カード全体を覆うリンクのオーバーレイより手前に置く
          "relative z-10 -mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none",
          liked && "text-brand hover:text-brand",
          className,
        )}
      >
        <ThumbsUp className={cn("h-3 w-3", liked && "fill-current")} aria-hidden />
        {/* tabular-nums: 9→10 で行が揺れないように */}
        <span className="tabular-nums">{count}</span>
      </button>
    );
  }

  // 未ログイン: テンプレート詳細の「ログインして反映」と同じ形
  if (!isLoggedIn) {
    return (
      <Button asChild variant="outline" size="sm" className={className}>
        <Link to="/login">
          <ThumbsUp className="mr-2 size-4" aria-hidden />
          {t("likes.loginToLike")}
          <span className="ml-1 tabular-nums text-muted-foreground">{count}</span>
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={isPending || isOwn}
      aria-pressed={isOwn ? undefined : liked}
      aria-busy={isPending}
      aria-label={
        isOwn
          ? t("likes.ownContent")
          : liked
            ? t("likes.removeAria", { count })
            : t("likes.addAria", { count })
      }
      title={isOwn ? t("likes.ownContent") : undefined}
      className={cn(
        // base の disabled:opacity-50 だと件数が読めなくなる（自分の投稿でも件数は見せる要件）。
        // 通信中も楽観的更新で件数が即変わるため、暗くする意味がない
        "transition-colors disabled:opacity-100",
        liked && "border-brand/40 bg-brand/10 text-brand hover:bg-brand/15 hover:text-brand",
        isOwn && "text-muted-foreground",
        className,
      )}
    >
      <ThumbsUp className={cn("mr-2 size-4", liked && "fill-current")} aria-hidden />
      {liked ? t("likes.labelActive") : t("likes.label")}
      <span className="ml-1 tabular-nums">{count}</span>
    </Button>
  );
}
