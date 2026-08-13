import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, RotateCcw } from "lucide-react";
import { useT } from "@/hooks/use-locale";

interface FloatingSaveBarProps {
  hasChanges: boolean;
  isSubmitting: boolean;
  onSave: () => void;
  onReset?: () => void;
  saveLabel?: string;
  resetLabel?: string;
  className?: string;
}

export function FloatingSaveBar({
  hasChanges,
  isSubmitting,
  onSave,
  onReset,
  saveLabel,
  resetLabel,
  className,
}: FloatingSaveBarProps) {
  // 既定ラベルは本体で解決する（既定引数は useT() より先に評価されるため）
  const t = useT();
  const save = saveLabel ?? t("common.saveChanges");
  const reset = resetLabel ?? t("common.discardChanges");
  return (
    <div
      role="region"
      aria-label={t("common.saveBar")}
      aria-hidden={!hasChanges}
      className={cn(
        "fixed bottom-4 left-0 right-0 mx-auto z-50",
        "w-[calc(100%-2rem)] max-w-2xl",
        "flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3",
        "bg-card/95 backdrop-blur-sm supports-[backdrop-filter]:bg-card/80",
        "p-3 sm:p-4 rounded-xl border-2 border-primary/20 shadow-xl",
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
      <div className="flex gap-2">
        {onReset && hasChanges && (
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            disabled={isSubmitting}
            className="flex-1 sm:flex-none touch-manipulation"
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
          className="flex-1 sm:flex-none sm:min-w-32 touch-manipulation"
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
  );
}
