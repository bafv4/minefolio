import { useEffect, useId, useRef } from "react";
import { useFetcher, useRevalidator, Link } from "react-router";
import { toast } from "sonner";
import { Settings, Copy, Check, Loader2, AlertCircle, Info, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NoticeBanner } from "@/components/notice-banner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

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
  /** プリセット切替（apply-preset の送信＋再検証）中かどうかを親へ通知する */
  onSwitchingChange?: (switching: boolean) => void;
  className?: string;
}

/**
 * 「現在編集中のプリセット」表示。
 *
 * - ドロップダウンで編集先プリセットを切り替え（apply-preset を /me/presets に POST）
 * - 編集中がメインでないときは通知帯で知らせ、「メインに設定」（set-main）を出す
 * - 未保存変更時はドロップダウン・コピー・メインに設定を非活性化し、理由は見える1文（`aria-describedby` で結ぶ）で示す
 * - プリセットが0件のときは警告のみ表示
 * - タブ復帰（focus / visibilitychange）時に loader を再検証し、
 *   別タブでのプリセット切替による stale 表示を防ぐ
 */
export function PresetSelector({
  presets,
  activePresetId,
  hasChanges,
  onCopyFromOther,
  onSwitchingChange,
  className,
}: PresetSelectorProps) {
  const t = useT();
  const fetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();
  const revalidator = useRevalidator();
  // 「メインに設定」は編集対象の切替とは別の fetcher（切替中ロックやセレクトの「…」表示を起こさない）
  const mainFetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();
  const selectId = useId();
  const hintId = useId();
  const switchHintId = useId();
  // apply-preset の送信〜再検証の間は fetcher.state が非idle。これを切替中とみなす
  const isSwitching = fetcher.state !== "idle";
  const lastRevalidatedAt = useRef(0);

  // 編集先の切替（apply-preset）が失敗したときは、理由をトーストで知らせる（成功は帯・選択の更新で分かる）
  const switchResult = fetcher.data;
  useEffect(() => {
    if (switchResult?.error) toast.error(switchResult.error);
  }, [switchResult]);

  // 「メインに設定」の結果をトーストで知らせる（成功後は action 後の再検証で帯が消える）
  const mainResult = mainFetcher.data;
  useEffect(() => {
    if (!mainResult) return;
    if (mainResult.error) toast.error(mainResult.error);
    else if (mainResult.message) toast.success(mainResult.message);
  }, [mainResult]);

  // 切替状態を親へ通知（親はキーボードビュー・入力欄をロックする）
  useEffect(() => {
    onSwitchingChange?.(isSwitching);
  }, [isSwitching, onSwitchingChange]);

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
          <Button asChild size="sm" className="shrink-0 w-full sm:w-auto max-sm:min-h-11">
            <Link to="/me/presets">{t("mePresets.createPreset")}</Link>
          </Button>
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

  const activePreset = presets.find((p) => p.id === activePresetId);
  // メインが別にあり、編集中がメインでないときだけ「保存しても走者画面には出ない」ことを知らせる
  const showNotMainNotice =
    !!activePreset && !activePreset.isMain && presets.some((p) => p.isMain);
  const setMainDisabled = hasChanges || isSwitching || mainFetcher.state !== "idle";

  const handleSetMain = () => {
    if (!activePresetId || setMainDisabled) return;
    const formData = new FormData();
    formData.set("intent", "set-main");
    formData.set("presetId", activePresetId);
    mainFetcher.submit(formData, { method: "post", action: "/me/presets" });
  };

  return (
    <div data-me-tour="preset-selector" className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1 sm:max-w-64">
          <Label htmlFor={selectId} className="text-xs font-medium text-muted-foreground">
            {t("mePresets.selectorLabel")}
          </Label>
          <Select
            value={activePresetId ?? ""}
            onValueChange={handleChange}
            disabled={dropdownDisabled}
          >
            <SelectTrigger
              id={selectId}
              aria-describedby={hasChanges ? switchHintId : undefined}
              className="w-full data-[size=default]:max-sm:h-11"
            >
              {isSwitching ? (
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="truncate">…</span>
                </div>
              ) : (
                <SelectValue placeholder={t("mePresets.selectorPlaceholder")}>
                  {/* Radix は SSR では選択項目の文字を描けないので、HTML の時点から値が入るよう明示する */}
                  {activePreset
                    ? `${activePreset.name}${activePreset.isMain ? t("mePresets.mainSuffix") : ""}`
                    : undefined}
                </SelectValue>
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
      <div className="ml-auto flex items-center gap-2">
        {showCopyButton && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCopyFromOther}
            disabled={copyDisabled}
            aria-describedby={hasChanges ? switchHintId : undefined}
            className="flex-1 sm:flex-none sm:w-auto max-sm:min-h-11"
          >
            <Copy className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{t("mePresets.copyFromOtherPreset")}</span>
            <span className="sm:hidden">{t("mePresets.copyShort")}</span>
          </Button>
        )}
        <Button
          asChild
          variant="ghost"
          size="sm"
          aria-label={t("mePresets.managePresets")}
          className="max-sm:size-11"
        >
          <Link to="/me/presets">
            <span className="hidden sm:inline">{t("mePresets.managePresets")}</span>
            <Settings className="h-4 w-4 sm:hidden" />
          </Link>
        </Button>
      </div>
      </div>
      {hasChanges && (
        <p id={switchHintId} className="text-xs text-muted-foreground">
          {t("mePresets.disabledHint")}
        </p>
      )}
      {showNotMainNotice && (
        <NoticeBanner tone="info" icon={Info}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="min-w-0 space-y-0.5">
              <p>{t("mePresets.notMainNotice")}</p>
              {hasChanges && (
                <p id={hintId} className="text-xs text-muted-foreground">
                  {t("mePresets.setMainDisabledHint")}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSetMain}
              disabled={setMainDisabled}
              aria-describedby={hasChanges ? hintId : undefined}
              className="max-sm:min-h-11"
            >
              {mainFetcher.state !== "idle" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Star className="h-4 w-4" aria-hidden />
              )}
              {t("mePresets.setMain")}
            </Button>
          </div>
        </NoticeBanner>
      )}
    </div>
  );
}
