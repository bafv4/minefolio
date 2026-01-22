import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, RotateCcw } from "lucide-react";

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
  saveLabel = "変更を保存",
  resetLabel = "変更を取り消す",
  className,
}: FloatingSaveBarProps) {
  return (
    <div
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
      <div className="flex items-center justify-center sm:justify-start gap-3">
        {hasChanges && (
          <Badge
            variant="outline"
            className="text-amber-600 dark:text-amber-400 border-amber-500/50 bg-amber-500/10 text-xs sm:text-sm"
          >
            <span className="hidden sm:inline">未保存の変更があります</span>
            <span className="sm:hidden">未保存</span>
          </Badge>
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
            <span className="hidden sm:inline">{resetLabel}</span>
            <span className="sm:hidden">取消</span>
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
              <span className="hidden sm:inline">保存中...</span>
              <span className="sm:hidden">保存中</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{saveLabel}</span>
              <span className="sm:hidden">保存</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
