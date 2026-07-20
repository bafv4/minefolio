import { useEffect, useRef } from "react";
import { useFetcher, useRevalidator, Link } from "react-router";
import { Settings, Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";

export interface PresetSelectorPreset {
  id: string;
  name: string;
  isActive: boolean;
  /** メイン（公開用）プリセットか。ドロップダウンに「（メイン）」を表示する */
  isMain?: boolean;
}

interface PresetSelectorProps {
  presets: PresetSelectorPreset[];
  activePresetId: string | null;
  hasChanges: boolean;
  onCopyFromOther?: () => void;
  className?: string;
}

/**
 * 「現在編集中のプリセット」表示。
 *
 * - ドロップダウンで編集先プリセットを切り替え（apply-preset を /me/presets に POST）
 * - 未保存変更時はドロップダウン・コピーを非活性化
 * - プリセットが0件のときは警告のみ表示
 * - タブ復帰（focus / visibilitychange）時に loader を再検証し、
 *   別タブでのプリセット切替による stale 表示を防ぐ
 */
export function PresetSelector({
  presets,
  activePresetId,
  hasChanges,
  onCopyFromOther,
  className,
}: PresetSelectorProps) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const isSwitching = fetcher.state !== "idle";
  const lastRevalidatedAt = useRef(0);

  // 別タブでプリセットが切り替えられた場合に備え、タブ復帰時に再検証する。
  // 編集中（hasChanges）はローカル状態を尊重してスキップし、
  // 保存時の staleSession エラーに委ねる。
  useEffect(() => {
    if (hasChanges) return;

    const revalidateIfIdle = () => {
      if (document.visibilityState !== "visible") return;
      if (revalidator.state !== "idle") return;
      // タブ復帰時は focus と visibilitychange が同時に発火するため、
      // 短時間の連続呼び出しをスロットルで抑止する
      const now = Date.now();
      if (now - lastRevalidatedAt.current < 1000) return;
      lastRevalidatedAt.current = now;
      revalidator.revalidate();
    };

    window.addEventListener("focus", revalidateIfIdle);
    document.addEventListener("visibilitychange", revalidateIfIdle);
    return () => {
      window.removeEventListener("focus", revalidateIfIdle);
      document.removeEventListener("visibilitychange", revalidateIfIdle);
    };
  }, [hasChanges, revalidator]);

  // プリセット未作成時の警告
  if (presets.length === 0) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm">{t("mePresets.noPresetWarning")}</span>
          <Link to="/me/presets" className="shrink-0">
            <Button size="sm" className="w-full sm:w-auto">
              {t("mePresets.createPreset")}
            </Button>
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const handleChange = (presetId: string) => {
    if (presetId === activePresetId || !presetId) return;
    const formData = new FormData();
    formData.set("intent", "apply-preset");
    formData.set("presetId", presetId);
    fetcher.submit(formData, { method: "post", action: "/me/presets" });
  };

  const dropdownDisabled = hasChanges || isSwitching;
  const copyDisabled = hasChanges || isSwitching;
  const showCopyButton = onCopyFromOther && presets.length > 1;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 sm:p-4 shadow-sm",
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Settings className="h-4 w-4" />
        </div>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("mePresets.selectorLabel")}
          </span>
          <TooltipProvider delayDuration={150}>
            <Tooltip open={dropdownDisabled && hasChanges ? undefined : false}>
              <TooltipTrigger asChild>
                <div className="w-full sm:w-64">
                  <Select
                    value={activePresetId ?? ""}
                    onValueChange={handleChange}
                    disabled={dropdownDisabled}
                  >
                    <SelectTrigger className="h-9 w-full">
                      {isSwitching ? (
                        <div className="flex items-center gap-2 text-sm">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span className="truncate">…</span>
                        </div>
                      ) : (
                        <SelectValue placeholder={t("mePresets.selectorPlaceholder")} />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          <div className="flex items-center gap-2">
                            <span className="truncate">{preset.name}</span>
                            {preset.isMain && (
                              <span className="text-xs text-muted-foreground shrink-0">
                                {t("mePresets.mainSuffix")}
                              </span>
                            )}
                            {preset.isActive && (
                              <Check className="h-3 w-3 text-primary shrink-0" />
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TooltipTrigger>
              {hasChanges && (
                <TooltipContent side="bottom" align="start">
                  <p className="text-xs">{t("mePresets.disabledHint")}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {showCopyButton && (
          <TooltipProvider delayDuration={150}>
            <Tooltip open={copyDisabled && hasChanges ? undefined : false}>
              <TooltipTrigger asChild>
                <span className="flex-1 sm:flex-none">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCopyFromOther}
                    disabled={copyDisabled}
                    className="w-full sm:w-auto"
                  >
                    <Copy className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t("mePresets.copyFromOtherPreset")}</span>
                    <span className="sm:hidden">{t("mePresets.copyShort")}</span>
                  </Button>
                </span>
              </TooltipTrigger>
              {hasChanges && (
                <TooltipContent side="bottom" align="end">
                  <p className="text-xs">{t("mePresets.disabledHint")}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}
        <Link to="/me/presets" className="shrink-0">
          <Button variant="ghost" size="sm">
            <span className="hidden sm:inline">{t("mePresets.managePresets")}</span>
            <span className="sm:hidden">
              <Badge variant="outline" className="text-xs">
                ⚙
              </Badge>
            </span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
