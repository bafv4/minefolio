import type { ReactNode } from "react";
import { useT } from "@/hooks/use-locale";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, ChevronLeft, Loader2 } from "lucide-react";

/**
 * 初期設定ウィザード（/onboarding）の各ステップ上部。
 * 「ステップ n / total」＋ Progress、その下にタイトルと説明を置く。
 */
export function OnboardingStepHeader({
  step,
  total,
  title,
  description,
}: {
  step: number;
  total: number;
  title: string;
  description: string;
}) {
  const t = useT();
  const label = t("onboarding.stepIndicator", { current: step, total });
  return (
    <CardHeader className="px-5">
      <div className="space-y-2 pb-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Progress value={(step / total) * 100} className="h-1.5" aria-label={label} />
      </div>
      <CardTitle className="text-xl">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

/** ステップ内のサーバーエラー表示（action の `{ error }`） */
export function OnboardingStepError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

/**
 * ステップ下部の操作列。左に「戻る」、右に「スキップ」と主ボタン（次へ／完了）。
 * - `onBack` / `onSkip` を渡さなければそのボタンは出さない
 * - `onNext` を渡すと主ボタンは type="button" になりクリックで呼ばれる（保存物が無いステップ用）。
 *   渡さなければ type="submit"（囲んでいる fetcher.Form を送信する）
 */
export function OnboardingStepFooter({
  onBack,
  onSkip,
  onNext,
  nextLabel,
  isSubmitting = false,
  nextDisabled = false,
  hint,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  onNext?: () => void;
  nextLabel: string;
  isSubmitting?: boolean;
  nextDisabled?: boolean;
  /** 主ボタンの左に出す補足（例: 必須項目の案内） */
  hint?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
      {onBack && (
        <Button type="button" variant="ghost" onClick={onBack} disabled={isSubmitting}>
          <ChevronLeft className="h-4 w-4" />
          {t("onboarding.back")}
        </Button>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip} disabled={isSubmitting}>
            {t("onboarding.skip")}
          </Button>
        )}
        <Button
          type={onNext ? "button" : "submit"}
          onClick={onNext}
          disabled={isSubmitting || nextDisabled}
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
