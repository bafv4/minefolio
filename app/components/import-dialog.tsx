import { useState, useCallback, useRef } from "react";
import { useFetcher } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Upload,
  FileText,
  Keyboard,
  Settings,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  parseAutoHotkeyScript,
  parseMinecraftSettings,
  type ParsedRemap,
  type ParsedMinecraftSettings,
} from "@/lib/import-parser";
import { getKeyLabel, getActionLabel } from "@/lib/keybindings";

interface ImportDialogProps {
  onSuccess?: () => void;
}

type ImportStep = "select" | "preview" | "done";

export function ImportDialog({ onSuccess }: ImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ImportStep>("select");
  const [activeTab, setActiveTab] = useState<"remap" | "minecraft">("remap");

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

      try {
        const content = await file.text();

        if (activeTab === "remap") {
          // AutoHotkeyスクリプト解析
          const remaps = parseAutoHotkeyScript(content);
          if (remaps.length === 0) {
            setError("リマップ設定が見つかりませんでした。AutoHotkeyスクリプト形式 (例: CapsLock::Ctrl) を確認してください。");
            return;
          }
          setParsedRemaps(remaps);
          setSelectedRemaps(new Set(remaps.map((_, i) => i)));
          setStep("preview");
        } else {
          // Minecraft設定解析
          const settings = parseMinecraftSettings(content, file.name);
          if (settings.keybindings.length === 0 && Object.keys(settings.gameSettings).length === 0) {
            setError("設定が見つかりませんでした。options.txt または standardsettings.json 形式を確認してください。");
            return;
          }
          setParsedMcSettings(settings);
          setStep("preview");
        }
      } catch {
        setError("ファイルの読み込みに失敗しました。");
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

  // fetcher完了時の処理
  if (fetcher.state === "idle" && fetcher.data && step === "preview") {
    setStep("done");
    onSuccess?.();
  }

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
        <Button variant="outline">
          <Upload className="h-4 w-4 mr-2" />
          インポート
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>設定をインポート</DialogTitle>
          <DialogDescription>
            外部ファイルから設定を読み込みます
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "remap" | "minecraft")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="remap" className="flex items-center gap-2">
                <Keyboard className="h-4 w-4" />
                リマップ
              </TabsTrigger>
              <TabsTrigger value="minecraft" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Minecraft設定
              </TabsTrigger>
            </TabsList>

            <TabsContent value="remap" className="space-y-4">
              <div className="rounded-lg border p-4 space-y-3">
                <h4 className="font-medium">AutoHotkeyスクリプト</h4>
                <p className="text-sm text-muted-foreground">
                  AutoHotkeyのリマップスクリプト (.ahk) を読み込んで、キーリマップ設定をインポートします。
                </p>
                <div className="text-xs text-muted-foreground bg-muted p-2 rounded font-mono">
                  対応形式: CapsLock::Ctrl, a::b など
                </div>
              </div>

              <div className="flex justify-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ahk,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button onClick={() => fileInputRef.current?.click()}>
                  <FileText className="h-4 w-4 mr-2" />
                  .ahkファイルを選択
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="minecraft" className="space-y-4">
              <div className="rounded-lg border p-4 space-y-3">
                <h4 className="font-medium">Minecraft設定ファイル</h4>
                <p className="text-sm text-muted-foreground">
                  Minecraftの設定ファイルからキーバインドとゲーム設定をインポートします。
                </p>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>対応ファイル:</p>
                  <ul className="list-disc list-inside ml-2">
                    <li><code>options.txt</code> - .minecraft フォルダ内</li>
                    <li><code>standardsettings.json</code> - StandardSettings Mod</li>
                  </ul>
                </div>
              </div>

              <div className="flex justify-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button onClick={() => fileInputRef.current?.click()}>
                  <FileText className="h-4 w-4 mr-2" />
                  ファイルを選択
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {step === "preview" && activeTab === "remap" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">
                リマップ設定 ({selectedRemaps.size}/{parsedRemaps.length}件選択)
              </h4>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllRemaps}>
                  全て選択
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAllRemaps}>
                  全て解除
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
                    <Badge variant="secondary">{getKeyLabel(remap.sourceKey)}</Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="outline">{getKeyLabel(remap.targetKey)}</Badge>
                  </div>
                  {remap.notes && (
                    <span className="text-xs text-muted-foreground">{remap.notes}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("select")}>
                戻る
              </Button>
              <Button onClick={handleImport} disabled={selectedRemaps.size === 0 || isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    インポート中...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    {selectedRemaps.size}件をインポート
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
                      キーバインド ({parsedMcSettings.keybindings.length}件)
                    </Label>
                  </div>
                  {importKeybindings && (
                    <div className="max-h-40 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-2">
                        {parsedMcSettings.keybindings.map((kb, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">{getActionLabel(kb.action)}:</span>
                            <Badge variant="secondary" className="text-xs">
                              {getKeyLabel(kb.keyCode)}
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
                      ゲーム設定
                    </Label>
                  </div>
                  {importGameSettings && (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {parsedMcSettings.gameSettings.toggleSprint !== undefined && (
                        <div>切替ダッシュ: {parsedMcSettings.gameSettings.toggleSprint ? "オン" : "オフ"}</div>
                      )}
                      {parsedMcSettings.gameSettings.toggleSneak !== undefined && (
                        <div>切替スニーク: {parsedMcSettings.gameSettings.toggleSneak ? "オン" : "オフ"}</div>
                      )}
                      {parsedMcSettings.gameSettings.autoJump !== undefined && (
                        <div>自動ジャンプ: {parsedMcSettings.gameSettings.autoJump ? "オン" : "オフ"}</div>
                      )}
                      {parsedMcSettings.gameSettings.fov !== undefined && (
                        <div>FOV: {parsedMcSettings.gameSettings.fov}</div>
                      )}
                      {parsedMcSettings.gameSettings.guiScale !== undefined && (
                        <div>GUIスケール: {parsedMcSettings.gameSettings.guiScale}</div>
                      )}
                      {parsedMcSettings.gameSettings.rawInput !== undefined && (
                        <div>生入力: {parsedMcSettings.gameSettings.rawInput ? "オン" : "オフ"}</div>
                      )}
                      {parsedMcSettings.gameSettings.gameLanguage && (
                        <div>言語: {parsedMcSettings.gameSettings.gameLanguage}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("select")}>
                戻る
              </Button>
              <Button
                onClick={handleImport}
                disabled={(!importKeybindings && !importGameSettings) || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    インポート中...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    インポート
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertTitle>インポート完了</AlertTitle>
              <AlertDescription>
                設定が正常にインポートされました。
              </AlertDescription>
            </Alert>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>閉じる</Button>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>エラー</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
