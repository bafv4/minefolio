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
        "flex items-center justify-between",
        "bg-card/95 backdrop-blur-sm supports-[backdrop-filter]:bg-card/80",
        "p-4 rounded-xl border-2 border-primary/20 shadow-xl",
        "transition-all duration-200",
        hasChanges ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none",
        className
      )}
    >
      <div className="flex items-center gap-3">
        {hasChanges && (
          <Badge
            variant="outline"
            className="text-amber-600 dark:text-amber-400 border-amber-500/50 bg-amber-500/10"
          >
            未保存の変更があります
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
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {resetLabel}
          </Button>
        )}
        <Button
          type="button"
          onClick={onSave}
          disabled={isSubmitting || !hasChanges}
          className="min-w-32"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              保存中...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {saveLabel}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
