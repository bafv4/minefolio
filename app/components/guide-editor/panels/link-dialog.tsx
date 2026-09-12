// リンク挿入の URL / テキスト入力ダイアログ。
// 旧 index.tsx の window.prompt を EmbedDialog / YoutubeDialog と同じ shadcn Dialog 構成に置換。
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-locale";

interface LinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * ダイアログを開いた時点の選択範囲が空か。
   * 空の場合のみリンクテキスト欄を表示する（選択範囲があればその文字列をそのままリンク化する）。
   */
  selectionEmpty: boolean;
  onInsert: (href: string, text: string) => void;
}

export function LinkDialog({ open, onOpenChange, selectionEmpty, onInsert }: LinkDialogProps) {
  const t = useT();
  const [url, setUrl] = useState("https://");
  const [text, setText] = useState("");

  // 開くたびに入力をリセット
  useEffect(() => {
    if (open) {
      setUrl("https://");
      setText("");
    }
  }, [open]);

  const submit = () => {
    const href = url.trim();
    if (!href) return;
    // テキスト未入力なら URL をそのまま表示テキストにする（旧 window.prompt 実装と同じ挙動）
    onInsert(href, text.trim() || href);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("guideEditor.ui.linkDialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("guideEditor.ui.linkUrlPrompt")}
            </label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="https://"
              className="h-8"
              autoFocus
            />
          </div>
          {selectionEmpty && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t("guideEditor.ui.linkTextPrompt")}
              </label>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={url}
                className="h-8"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("guideEditor.embedCancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={!url.trim()}>
            {t("guideEditor.embedInsert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
