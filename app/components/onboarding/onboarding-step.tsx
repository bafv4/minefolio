import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { NoticeBanner } from "@/components/notice-banner";
import { AlertCircle, ChevronLeft, Loader2 } from "lucide-react";

/**
 * 描画した直後に要素へフォーカスを移す（`enabled` のときだけ）。
 * ウィザードの手順を切り替えたとき、新しい手順のタイトルへ移すのに使う。ページを開いた直後は `enabled=false` にして動かさない
 */
export function useFocusOnMount<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus({ preventScroll: true });
    // 描画時の1回だけ（手順ごとに新しく描画される）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

/**
 * 初期設定ウィザード（/onboarding）の各ステップ上部。
 * 「ステップ n / total」＋ Progress、その下にタイトル（ページの h1）と説明を置く。
 * - `focusTitle`: 描画した直後にタイトルへフォーカスを移す（手順を切り替えたとき）
 */
export function OnboardingStepHeader({
  step,
  total,
  title,
  description,
  focusTitle = false,
}: {
  step: number;
  total: number;
  title: string;
  description: string;
  focusTitle?: boolean;
}) {
  const t = useT();
  const label = t("onboarding.stepIndicator", { current: step, total });
  const titleRef = useFocusOnMount<HTMLHeadingElement>(focusTitle);
  return (
    <CardHeader className="px-4 sm:px-5">
      <div className="space-y-2 pb-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {/* 進行は brand（ui.md 1 章）。Progress の基底（primary）は変えず、ここだけ className で塗り替える */}
        <Progress
          value={(step / total) * 100}
          className="h-1.5 bg-brand/20 [&>[data-slot=progress-indicator]]:bg-brand"
          aria-label={label}
        />
      </div>
      <h1
        ref={titleRef}
        tabIndex={-1}
        data-slot="card-title"
        className="text-2xl font-bold leading-snug focus-visible:outline-none"
      >
        {title}
      </h1>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

/** ステップ内のサーバーエラー表示（action の `{ error }`） */
export function OnboardingStepError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <NoticeBanner tone="error" icon={AlertCircle}>
      {error}
    </NoticeBanner>
  );
}

/**
 * ステップ下部の操作列。左に「戻る」、右に「スキップ」と主ボタン（次へ／完了）。
 * - `onBack` / `onSkip` を渡さなければそのボタンは出さない
 * - `onNext` を渡すと主ボタンは type="button" になりクリックで呼ばれる（保存物が無いステップ用）。
 *   渡さなければ type="submit"（囲んでいる fetcher.Form を送信する）
 * - ボタンはモバイルで高さ 44px（sm 以上は既定の 36px）
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
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 sm:min-h-9"
          onClick={onBack}
          disabled={isSubmitting}
        >
          <ChevronLeft className="h-4 w-4" />
          {t("onboarding.back")}
        </Button>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        {onSkip && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 sm:min-h-9"
            onClick={onSkip}
            disabled={isSubmitting}
          >
            {t("onboarding.skip")}
          </Button>
        )}
        <Button
          type={onNext ? "button" : "submit"}
          className="min-h-11 sm:min-h-9"
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
