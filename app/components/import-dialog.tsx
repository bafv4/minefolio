import { useState, useCallback, useEffect, useRef, type RefObject } from "react";
import { useT } from "@/hooks/use-locale";
import { useFetcher } from "react-router";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NoticeBanner } from "@/components/notice-banner";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  FileText,
  FileInput,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
  X,
} from "lucide-react";
import {
  parseAutoHotkeyScript,
  parseMinecraftSettings,
  type ParsedRemap,
  type ParsedMinecraftSettings,
} from "@/lib/import-parser";
import { getKeyLabel, getActionLabel } from "@/lib/keybindings";

type ImportSource = "remap" | "minecraft";

interface ImportDialogProps {
  /** 開閉（キー配置画面が持つ。/me/import からの転送 `?import=1` で開いた状態にするため） */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 閉じたあとにフォーカスを戻す先（トリガーのボタン。ダイアログは親が1回だけ置き、トリガーはプリセット行の位置で付け替わるため ref で受ける） */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** 取り込み先（編集中）のプリセット名。null はプリセットが無く、取り込みで新規作成される */
  targetPresetName: string | null;
  /** 取り込み先（編集中）のプリセット id。送り返して、別タブで編集先が切り替わっていないかサーバーが確認する */
  targetPresetId: string | null;
  onSuccess?: () => void;
}

type ImportStep = "source" | "select" | "preview" | "done";

/**
 * 設定インポートのダイアログ（キー配置画面のプリセット行から開く）。
 * 取り込み元（リマップ＝AutoHotkey／Minecraft 設定）はダイアログの最初の手順で選ぶ。
 * 書き込みは /me/import の action（リソースルート）へ送る。取り込み先は編集中のプリセット。
 */
export function ImportDialog({
  open,
  onOpenChange,
  returnFocusRef,
  targetPresetName,
  targetPresetId,
  onSuccess,
}: ImportDialogProps) {
  const t = useT();
  const [source, setSource] = useState<ImportSource | null>(null);
  const [step, setStep] = useState<ImportStep>("source");
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
  // 送信中〜応答の反映中（loading を含む）は閉じる操作を受け付けない
  const isBusy = fetcher.state !== "idle";

  // 手順が変わると押したボタンが消えてフォーカスが DialogContent へ戻るので、次の手順の見出しへ移す
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const prevStepRef = useRef<ImportStep>("source");
  useEffect(() => {
    if (prevStepRef.current === step) return;
    prevStepRef.current = step;
    if (open) stepHeadingRef.current?.focus();
  }, [step, open]);

  const resetState = useCallback(() => {
    setSource(null);
    setStep("source");
    setParsedRemaps([]);
    setSelectedRemaps(new Set());
    setParsedMcSettings(null);
    setImportKeybindings(true);
    setImportGameSettings(true);
    setError(null);
  }, []);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0];
      if (!file) return;
      // 途中で return しても、同じファイルを選び直せば onChange が発火するよう先に空にする
      // （File は保持しているので読み込みには影響しない）
      input.value = "";

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
          ...(targetPresetId ? { presetId: targetPresetId } : {}),
        },
        { method: "post", action: "/me/import" }
      );
    } else {
      // Minecraft設定をインポート
      if (!parsedMcSettings) return;
      fetcher.submit(
        {
          intent: "import-minecraft",
          keybindings: importKeybindings ? JSON.stringify(parsedMcSettings.keybindings) : "[]",
          gameSettings: importGameSettings ? JSON.stringify(parsedMcSettings.gameSettings) : "{}",
          ...(targetPresetId ? { presetId: targetPresetId } : {}),
        },
        { method: "post", action: "/me/import" }
      );
    }
  }, [activeTab, parsedRemaps, selectedRemaps, parsedMcSettings, importKeybindings, importGameSettings, targetPresetId, fetcher]);

  // fetcher完了時の処理。サーバーがエラーを返した場合（プリセット未作成・
  // 別タブでの切替検知等）は完了画面に遷移せず、エラーをダイアログ内に表示する
  const prevFetcherDataRef = useRef<typeof fetcher.data>(undefined);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data === prevFetcherDataRef.current) return;
    prevFetcherDataRef.current = fetcher.data;
    if (step !== "preview") return;
    const data = fetcher.data as { success?: boolean; error?: string };
    // success が true でなければ失敗として扱う（エラー文言が無くても完了画面へ進めない）
    if (data.success !== true) {
      setError(data.error ?? t("meImport.importFailed"));
    } else {
      setError(null);
      setStep("done");
      onSuccess?.();
    }
  }, [fetcher.state, fetcher.data, step, onSuccess, t]);

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

  // 閉じる経路（Esc・×・完了画面の「閉じる」）をすべてここに通し、状態を初期化する
  const handleOpenChange = (value: boolean) => {
    // 送信中は閉じない（resetState が走ると、成功しても完了画面が出ない）
    if (!value && isBusy) return;
    onOpenChange(value);
    if (!value) resetState();
  };

  // 手順を変えるときはエラーの帯を消す
  const goToStep = (next: ImportStep) => {
    setError(null);
    setStep(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (isBusy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isBusy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isBusy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          // DialogTrigger を持たないので、フォーカスはトリガーのボタンへ明示的に戻す
          if (returnFocusRef) {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }
        }}
      >
        {/* 閉じるボタン: 共有の DialogContent の既定は 16px。md 未満は 44px の押せる範囲にする */}
        <DialogClose disabled={isBusy} className="ring-offset-background disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-ring absolute top-1.5 right-1.5 inline-flex size-11 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden md:top-3 md:right-3 md:size-8">
          <X className="size-4" aria-hidden />
          <span className="sr-only">{t("common.close")}</span>
        </DialogClose>
        <DialogHeader className="pr-10">
          <DialogTitle>
            {source
              ? `${t("meImport.dialogTitle")}: ${source === "remap" ? t("meImport.remapTitle") : t("meImport.minecraftTitle")}`
              : t("meImport.dialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {source === null
              ? t("meImport.chooseSourceDescription")
              : source === "remap"
              ? t("meImport.ahkDescription")
              : t("meImport.mcSettingsDescription")}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {targetPresetName
            ? t("meImport.targetPreset", { name: targetPresetName })
            : t("meImport.targetPresetNone")}
        </p>

        {step !== "done" && (
          <h3 ref={stepHeadingRef} tabIndex={-1} className="sr-only">
            {step === "source"
              ? t("meImport.stepSource")
              : step === "select"
              ? t("meImport.stepSelect")
              : t("meImport.stepPreview")}
          </h3>
        )}

        {(step === "source" || step === "select") && (
          <NoticeBanner tone="info" icon={Info}>
            <p className="font-medium">{t("meImport.importInfoTitle")}</p>
            <p>{t("meImport.importInfoDescription")}</p>
          </NoticeBanner>
        )}

        {step === "source" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(["remap", "minecraft"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant="outline"
                onClick={() => {
                  setSource(value);
                  goToStep("select");
                }}
                className="h-auto min-h-11 flex-col items-start gap-1 whitespace-normal py-3 text-left"
              >
                <span className="font-medium">
                  {value === "remap" ? t("meImport.remapTitle") : t("meImport.minecraftTitle")}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {value === "remap" ? t("meImport.remapDescription") : t("meImport.minecraftDescription")}
                </span>
              </Button>
            ))}
          </div>
        )}

        {step === "select" && source && (
          <div className="space-y-4">
            <div className="text-sm">
              <p className="mb-2 text-muted-foreground">
                {source === "remap" ? t("meImport.supportedFormat") : t("meImport.supportedFiles")}
              </p>
              {source === "remap" ? (
                <div className="rounded bg-muted p-2 font-mono text-xs">
                  CapsLock::Ctrl<br />
                  a::b<br />
                  XButton1::e ; {t("meImport.ahkCommentExample")}
                </div>
              ) : (
                <>
                  <ul className="list-inside list-disc space-y-1 text-xs">
                    <li><code className="rounded bg-muted px-1">options.txt</code> - {t("meImport.minecraftFolder")}</li>
                    <li><code className="rounded bg-muted px-1">standardsettings.json</code> - StandardSettings Mod</li>
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">{t("meImport.minecraftScopeNote")}</p>
                </>
              )}
            </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => goToStep("source")} className="max-sm:min-h-11">
              {t("meImport.back")}
            </Button>
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
              <Button variant="outline" onClick={() => goToStep("select")} className="max-sm:min-h-11">
                {t("meImport.back")}
              </Button>
              <Button onClick={handleImport} disabled={selectedRemaps.size === 0 || isSubmitting} className="max-sm:min-h-11">
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("meImport.importing")}
                  </>
                ) : (
                  <>
                    <FileInput className="h-4 w-4 mr-2" />
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
              <Button variant="outline" onClick={() => goToStep("select")} className="max-sm:min-h-11">
                {t("meImport.back")}
              </Button>
              <Button
                onClick={handleImport}
                className="max-sm:min-h-11"
                disabled={(!importKeybindings && !importGameSettings) || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("meImport.importing")}
                  </>
                ) : (
                  <>
                    <FileInput className="h-4 w-4 mr-2" />
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
              <h3 ref={stepHeadingRef} tabIndex={-1} className="font-medium outline-hidden">
                {t("meImport.completed")}
              </h3>
              <p>{t("meImport.importedSuccessfully")}</p>
            </NoticeBanner>
            <div className="flex justify-end">
              <Button onClick={() => handleOpenChange(false)} className="max-sm:min-h-11">{t("common.close")}</Button>
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
