// /me/edit の上端に出す「はじめに」の欄。プロフィールの手順（MCID・自己紹介・キー配置・デバイス・記録・プレイスタイル）の
// 進み具合を示し、各手順をその画面へのリンクにする。全部済むか「閉じる」で消え、閉じたことは users に記録する。
// データは /me のレイアウトの loader（checklist）から読むので、置く側は <MeChecklist /> を1つ置くだけ。
import { useState } from "react";
import { Link, useRouteLoaderData } from "react-router";
import { useT } from "@/hooks/use-locale";
import { PageSection } from "@/components/page-section";
import { Button } from "@/components/ui/button";
import { Check, Circle } from "lucide-react";
import { recordMeGuide, type MeChecklistData } from "@/lib/me-guide";

export function MeChecklist({ onDismiss }: { onDismiss?: () => void } = {}) {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  const data = useRouteLoaderData("routes/me/_layout") as { checklist?: MeChecklistData | null } | undefined;
  const checklist = data?.checklist;
  if (!checklist || dismissed) return null;

  return (
    <PageSection
      id="me-checklist"
      first
      title={t("meLayout.checklist.title")}
      badge={
        <span className="text-sm font-normal text-muted-foreground tabular-nums">
          {t("meLayout.checklist.progress", { done: checklist.doneCount, total: checklist.total })}
        </span>
      }
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 sm:min-h-8"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
            void recordMeGuide("checklist");
          }}
        >
          {t("meLayout.checklist.close")}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">{t("meLayout.checklist.description", { total: checklist.total })}</p>
      <div
        role="progressbar"
        aria-label={t("meLayout.checklist.progressLabel")}
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-valuenow={checklist.doneCount}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${(checklist.doneCount / checklist.total) * 100}%` }}
        />
      </div>
      <ul className="mt-3 divide-y divide-border/60">
        {checklist.steps.map((step) => (
          <li key={step.key}>
            <Link
              to={step.to}
              className="flex min-h-11 items-start gap-3 rounded-md px-1 py-2 text-sm hover:bg-muted/50 sm:min-h-10"
            >
              {step.done ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className={step.done ? "block text-muted-foreground line-through" : "block font-medium"}>
                  {t(`meLayout.checklist.steps.${step.key}`)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`meLayout.checklist.criteria.${step.key}`)}
                </span>
              </span>
              <span className="sr-only">
                {step.done ? t("meLayout.checklist.done") : t("meLayout.checklist.todo")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PageSection>
  );
}
