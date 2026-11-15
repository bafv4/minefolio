import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { useT } from "@/hooks/use-locale";
import { ArrowLeft, BookOpen, FileQuestion, Users } from "lucide-react";

/**
 * ガイド系ルート（記事・著者・テンプレート）の ErrorBoundary 本体。
 * 404 のときだけ「見つかりません＋一覧へ戻る」を出し、それ以外のエラーは root の ErrorBoundary へ投げ直す。
 * ルート自身が境界になることで、その route の meta（見つかりません系のタイトル）も使われる。
 */
export function GuideRouteNotFound({
  title,
  description,
  backTo,
  backLabel,
  secondaryTo,
  secondaryLabel,
  showFindRunner = false,
}: {
  title: string;
  description: string;
  backTo: string;
  backLabel: string;
  /** 補助の導線（記事の 404 で著者が実在するときの「この走者のガイド」など）。両方そろったときだけ出す */
  secondaryTo?: string;
  secondaryLabel?: string;
  /** 著者が実在しない 404（記事・著者ページ）で「走者を探す」（/browse）の導線を足す */
  showFindRunner?: boolean;
}) {
  const t = useT();
  const error = useRouteError();
  if (!isRouteErrorResponse(error) || error.status !== 404) {
    throw error;
  }
  return (
    <EmptyState
      icon={<FileQuestion className="h-12 w-12" />}
      titleAs="h1"
      title={title}
      description={description}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
            <Link to={backTo}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {backLabel}
            </Link>
          </Button>
          {secondaryTo && secondaryLabel && (
            <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
              <Link to={secondaryTo}>
                <BookOpen className="mr-2 h-4 w-4" />
                {secondaryLabel}
              </Link>
            </Button>
          )}
          {showFindRunner && (
            <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
              <Link to="/browse">
                <Users className="mr-2 h-4 w-4" />
                {t("guides.findRunner")}
              </Link>
            </Button>
          )}
        </div>
      }
    />
  );
}
