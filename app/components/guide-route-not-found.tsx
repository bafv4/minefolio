import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ArrowLeft, FileQuestion } from "lucide-react";

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
}: {
  title: string;
  description: string;
  backTo: string;
  backLabel: string;
}) {
  const error = useRouteError();
  if (!isRouteErrorResponse(error) || error.status !== 404) {
    throw error;
  }
  return (
    <EmptyState
      icon={<FileQuestion className="h-12 w-12" />}
      title={title}
      description={description}
      action={
        <Button asChild variant="outline">
          <Link to={backTo}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {backLabel}
          </Link>
        </Button>
      }
    />
  );
}
