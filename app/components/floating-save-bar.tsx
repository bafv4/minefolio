import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, RotateCcw } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";

/**
 * 未保存の変更を持ったまま離れるのを止める（アプリ内遷移は確認ダイアログ、タブ閉じ/リロードは beforeunload）。
 * useBlocker は1ルーターに1つしか効かないので、自前で useUnsavedWarning を呼ぶ画面は
 * FloatingSaveBar に `unsavedGuard={false}` を渡して、この子コンポーネント自体を描かない。
 */
function UnsavedGuard({
  hasChanges,
  onSave,
  isSubmitting,
}: {
  hasChanges: boolean;
  onSave: () => void;
  isSubmitting: boolean;
}) {
  // 保存中は止めない。ただし blocked 済みの状態は dirty が下がっても保たれるので、
  // 「保存して移動」は送信完了後に proceed できる
  const blocker = useUnsavedWarning(hasChanges && !isSubmitting);
  return <UnsavedChangesDialog blocker={blocker} onSave={onSave} isSubmitting={isSubmitting} hasChanges={hasChanges} />;
}

interface FloatingSaveBarProps {
  hasChanges: boolean;
  isSubmitting: boolean;
  onSave: () => void;
  onReset?: () => void;
  saveLabel?: string;
  resetLabel?: string;
  className?: string;
  /**
   * 未保存のまま離れるときの警告をこの保存バーが持つか（既定 true）。保存中（isSubmitting）は止めない。
   * 画面側で useUnsavedWarning + UnsavedChangesDialog を自前で持つ間だけ false にする。
   */
  unsavedGuard?: boolean;
}

export function FloatingSaveBar({
  hasChanges,
  isSubmitting,
  onSave,
  onReset,
  saveLabel,
  resetLabel,
  className,
  unsavedGuard = true,
}: FloatingSaveBarProps) {
  // 既定ラベルは本体で解決する（既定引数は useT() より先に評価されるため）
  const t = useT();
  const save = saveLabel ?? t("common.saveChanges");
  const reset = resetLabel ?? t("common.discardChanges");
  return (
    <>
    {unsavedGuard && <UnsavedGuard hasChanges={hasChanges} onSave={onSave} isSubmitting={isSubmitting} />}
    <div
      data-me-tour="save-bar"
      role="region"
      aria-label={t("common.saveBar")}
      aria-hidden={!hasChanges}
      className={cn(
        // Cookie 同意バナー表示中は、その高さぶん上へ積む（cookie-consent.tsx が変数を公開）
        "fixed bottom-[calc(1rem+var(--cookie-banner-offset,0px))] left-0 right-0 mx-auto z-50",
        "w-[calc(100%-2rem)] max-w-2xl",
        "flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3",
        // 不透明の面（半透明だと「未保存」バッジの warning 文字が背景次第で 4.5:1 を割る）。枠は中立（primary はリンクの色）
        "bg-card",
        "p-3 sm:p-4 rounded-xl border-2 border-border/70 shadow-xl",
        "transition-all duration-200",
        hasChanges ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none",
        className
      )}
    >
      <div
        className="flex items-center justify-center sm:justify-start gap-3"
        aria-live="polite"
      >
        {hasChanges && (
          <Badge
            variant="outline"
            className="text-warning border-warning/50 bg-warning/10 text-xs sm:text-sm"
          >
            <span className="hidden sm:inline">{t("common.unsavedChanges")}</span>
            <span className="sm:hidden">{t("common.unsaved")}</span>
          </Badge>
        )}
        {isSubmitting && (
          <span className="sr-only">{t("common.savingInProgress")}</span>
        )}
      </div>
      {/* モバイルは「取消」を左端の小さな副次操作にして、広い「保存」から離す（押し間違いで破棄しにくくする） */}
      <div className="flex gap-2 max-sm:gap-6">
        {onReset && hasChanges && (
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            disabled={isSubmitting}
            className="flex-none min-h-11 sm:min-h-9 text-muted-foreground touch-manipulation"
          >
            <RotateCcw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{reset}</span>
            <span className="sm:hidden">{t("common.discard")}</span>
          </Button>
        )}
        <Button
          type="button"
          onClick={onSave}
          disabled={isSubmitting || !hasChanges}
          className="flex-1 sm:flex-none sm:min-w-32 min-h-11 sm:min-h-9 touch-manipulation"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" />
              <span className="hidden sm:inline">{t("common.saving")}...</span>
              <span className="sm:hidden">{t("common.saving")}</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{save}</span>
              <span className="sm:hidden">{t("common.save")}</span>
            </>
          )}
        </Button>
      </div>
    </div>
    </>
  );
}
