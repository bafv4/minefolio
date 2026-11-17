import { useState, useCallback, useEffect, useRef } from "react";
import { useT } from "@/hooks/use-locale";
import { useFetcher } from "react-router";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NoticeBanner } from "@/components/notice-banner";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
} from "lucide-react";
import {
  parseAutoHotkeyScript,
  parseMinecraftSettings,
  type ParsedRemap,
  type ParsedMinecraftSettings,
} from "@/lib/import-parser";
import { getKeyLabel, getActionLabel } from "@/lib/keybindings";

interface ImportDialogProps {
  /** 取り込み元。ページ側で選ぶので、ダイアログ内では選び直さない */
  source: "remap" | "minecraft";
  /** 取り込み先（編集中）のプリセット名。null はプリセットが無く、取り込みで新規作成される */
  targetPresetName: string | null;
  onSuccess?: () => void;
}

type ImportStep = "select" | "preview" | "done";

export function ImportDialog({ source, targetPresetName, onSuccess }: ImportDialogProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ImportStep>("select");
  const activeTab = source;

  // リマップインポート状態
  const [parsedRemaps, setParsedRemaps] = useState<ParsedRemap[]>([]);
  const [selectedRemaps, setSelectedRemaps] = useState<Set<number>>(new Set());

  // Minecraft設定インポート状態
  const [parsedMcSettings, setParsedMcSettings] = useState<ParsedMinecraftSettings | null>(null);
  const [importKeybindings, setImportKeybindings] = useState(true);
  const [importGameSettings, setImportGameSettings] = useState(true);

  // 共通
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher();

  const isSubmitting = fetcher.state === "submitting";

  const resetState = useCallback(() => {
    setStep("select");
    setParsedRemaps([]);
    setSelectedRemaps(new Set());
    setParsedMcSettings(null);
    setImportKeybindings(true);
    setImportGameSettings(true);
    setError(null);
  }, []);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setError(null);

      // ファイルサイズチェック（最大1MB）
      const MAX_FILE_SIZE = 1024 * 1024; // 1MB
      if (file.size > MAX_FILE_SIZE) {
        setError(t("meImport.fileTooLarge"));
        return;
      }

      try {
        const content = await file.text();

        if (activeTab === "remap") {
          // AutoHotkeyスクリプト解析
          const remaps = parseAutoHotkeyScript(content);
          if (remaps.length === 0) {
            setError(t("meImport.noRemapsFound"));
            return;
          }
          setParsedRemaps(remaps);
          setSelectedRemaps(new Set(remaps.map((_, i) => i)));
          setStep("preview");
        } else {
          // Minecraft設定解析
          const settings = parseMinecraftSettings(content, file.name);
          if (settings.keybindings.length === 0 && Object.keys(settings.gameSettings).length === 0) {
            setError(t("meImport.noSettingsFound"));
            return;
          }
          setParsedMcSettings(settings);
          setStep("preview");
        }
      } catch {
        setError(t("meImport.readFailed"));
      }

      // ファイル入力をリセット
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [activeTab]
  );

  const handleImport = useCallback(() => {
    if (activeTab === "remap") {
      // 選択されたリマップをインポート
      const selectedRemapData = parsedRemaps.filter((_, i) => selectedRemaps.has(i));
      fetcher.submit(
        {
          intent: "import-remaps",
          remaps: JSON.stringify(selectedRemapData),
        },
        { method: "post" }
      );
    } else {
      // Minecraft設定をインポート
      if (!parsedMcSettings) return;
      fetcher.submit(
        {
          intent: "import-minecraft",
          keybindings: importKeybindings ? JSON.stringify(parsedMcSettings.keybindings) : "[]",
          gameSettings: importGameSettings ? JSON.stringify(parsedMcSettings.gameSettings) : "{}",
        },
        { method: "post" }
      );
    }
  }, [activeTab, parsedRemaps, selectedRemaps, parsedMcSettings, importKeybindings, importGameSettings, fetcher]);

  // fetcher完了時の処理。サーバーがエラーを返した場合（プリセット未作成・
  // 別タブでの切替検知等）は完了画面に遷移せず、エラーをダイアログ内に表示する
  const prevFetcherDataRef = useRef<typeof fetcher.data>(undefined);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data === prevFetcherDataRef.current) return;
    prevFetcherDataRef.current = fetcher.data;
    if (step !== "preview") return;
    const data = fetcher.data as { error?: string };
    if (data.error) {
      setError(data.error);
    } else {
      setError(null);
      setStep("done");
      onSuccess?.();
    }
  }, [fetcher.state, fetcher.data, step, onSuccess]);

  const toggleRemapSelection = (index: number) => {
    setSelectedRemaps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const selectAllRemaps = () => {
    setSelectedRemaps(new Set(parsedRemaps.map((_, i) => i)));
  };

  const deselectAllRemaps = () => {
    setSelectedRemaps(new Set());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) resetState();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="max-sm:min-h-11"
          aria-label={t("meImport.importButtonAria", {
            name: source === "remap" ? t("meImport.remapTitle") : t("meImport.minecraftTitle"),
          })}
        >
          <Upload className="h-4 w-4 mr-2" />
          {t("meImport.importButton")}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-w-2xl max-h-[80vh] overflow-y-auto">
        {/* 閉じるボタン: 共有の DialogContent の既定は 16px。md 未満は 44px の押せる範囲にする */}
        <DialogClose className="ring-offset-background focus-visible:ring-ring absolute top-1.5 right-1.5 inline-flex size-11 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden md:top-3 md:right-3 md:size-8">
          <X className="size-4" aria-hidden />
          <span className="sr-only">{t("common.close")}</span>
        </DialogClose>
        <DialogHeader className="pr-10">
          <DialogTitle>
            {t("meImport.dialogTitle")}: {source === "remap" ? t("meImport.remapTitle") : t("meImport.minecraftTitle")}
          </DialogTitle>
          <DialogDescription>
            {source === "remap" ? t("meImport.ahkDescription") : t("meImport.mcSettingsDescription")}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {targetPresetName
            ? t("meImport.targetPreset", { name: targetPresetName })
            : t("meImport.targetPresetNone")}
        </p>

        {step === "select" && (
          <div className="flex justify-center">
            <input
              ref={fileInputRef}
              type="file"
              accept={source === "remap" ? ".ahk,.txt" : ".txt,.json"}
              onChange={handleFileSelect}
              className="hidden"
              aria-label={source === "remap" ? t("meImport.selectAhkFile") : t("meImport.selectFile")}
            />
            <Button onClick={() => fileInputRef.current?.click()} className="max-sm:min-h-11">
              <FileText className="h-4 w-4 mr-2" />
              {source === "remap" ? t("meImport.selectAhkFile") : t("meImport.selectFile")}
            </Button>
          </div>
        )}

        {step === "preview" && activeTab === "remap" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">
                {t("meImport.remapsSelected", {
                  selected: selectedRemaps.size,
                  total: parsedRemaps.length,
                })}
              </h4>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllRemaps}>
                  {t("meImport.selectAll")}
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAllRemaps}>
                  {t("meImport.deselectAll")}
                </Button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto border rounded-lg">
              {parsedRemaps.map((remap, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 border-b last:border-b-0 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedRemaps.has(index)}
                    onCheckedChange={() => toggleRemapSelection(index)}
                  />
                  <div className="flex-1 flex items-center gap-2">
                    <Badge variant="secondary">{getKeyLabel(t, remap.sourceKey)}</Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="outline">{getKeyLabel(t, remap.targetKey)}</Badge>
                  </div>
                  {remap.notes && (
                    <span className="text-xs text-muted-foreground">{remap.notes}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("select")}>
                {t("meImport.back")}
              </Button>
              <Button onClick={handleImport} disabled={selectedRemaps.size === 0 || isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("meImport.importing")}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    {t("meImport.importCount", { count: selectedRemaps.size })}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && activeTab === "minecraft" && parsedMcSettings && (
          <div className="space-y-4">
            <div className="space-y-4">
              {/* キーバインド */}
              {parsedMcSettings.keybindings.length > 0 && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="import-keybindings"
                      checked={importKeybindings}
                      onCheckedChange={(checked) => setImportKeybindings(!!checked)}
                    />
                    <Label htmlFor="import-keybindings" className="font-medium">
                      {t("meImport.keybindingsCount", {
                        count: parsedMcSettings.keybindings.length,
                      })}
                    </Label>
                  </div>
                  {importKeybindings && (
                    <div className="max-h-40 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-2">
                        {parsedMcSettings.keybindings.map((kb, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">{getActionLabel(t, kb.action)}:</span>
                            <Badge variant="secondary" className="text-xs">
                              {getKeyLabel(t, kb.keyCode)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ゲーム設定 */}
              {Object.keys(parsedMcSettings.gameSettings).length > 0 && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="import-game-settings"
                      checked={importGameSettings}
                      onCheckedChange={(checked) => setImportGameSettings(!!checked)}
                    />
                    <Label htmlFor="import-game-settings" className="font-medium">
                      {t("meImport.gameSettings")}
                    </Label>
                  </div>
                  {importGameSettings && (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {parsedMcSettings.gameSettings.toggleSprint !== undefined && (
                        <div>{t("meImport.toggleSprint")}: {parsedMcSettings.gameSettings.toggleSprint ? t("meImport.switchOn") : t("meImport.switchOff")}</div>
                      )}
                      {parsedMcSettings.gameSettings.toggleSneak !== undefined && (
                        <div>{t("meImport.toggleSneak")}: {parsedMcSettings.gameSettings.toggleSneak ? t("meImport.switchOn") : t("meImport.switchOff")}</div>
                      )}
                      {parsedMcSettings.gameSettings.autoJump !== undefined && (
                        <div>{t("meImport.autoJump")}: {parsedMcSettings.gameSettings.autoJump ? t("meImport.switchOn") : t("meImport.switchOff")}</div>
                      )}
                      {parsedMcSettings.gameSettings.fov !== undefined && (
                        <div>FOV: {parsedMcSettings.gameSettings.fov}</div>
                      )}
                      {parsedMcSettings.gameSettings.guiScale !== undefined && (
                        <div>{t("meImport.guiScale")}: {parsedMcSettings.gameSettings.guiScale}</div>
                      )}
                      {parsedMcSettings.gameSettings.rawInput !== undefined && (
                        <div>{t("meImport.rawInput")}: {parsedMcSettings.gameSettings.rawInput ? t("meImport.switchOn") : t("meImport.switchOff")}</div>
                      )}
                      {parsedMcSettings.gameSettings.gameLanguage && (
                        <div>{t("meImport.gameLanguage")}: {parsedMcSettings.gameSettings.gameLanguage}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("select")}>
                {t("meImport.back")}
              </Button>
              <Button
                onClick={handleImport}
                disabled={(!importKeybindings && !importGameSettings) || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("meImport.importing")}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    {t("meImport.importButton")}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <NoticeBanner tone="success" icon={CheckCircle2}>
              <p className="font-medium">{t("meImport.completed")}</p>
              <p>{t("meImport.importedSuccessfully")}</p>
            </NoticeBanner>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>{t("common.close")}</Button>
            </div>
          </div>
        )}

        {error && (
          <NoticeBanner tone="error" icon={AlertCircle}>
            <p className="font-medium">{t("meImport.errorTitle")}</p>
            <p>{error}</p>
          </NoticeBanner>
        )}
      </DialogContent>
    </Dialog>
  );
}
