// YouTube 動画埋め込みの URL 入力ダイアログ。
// 旧 index.tsx の window.prompt を EmbedDialog と同じ shadcn Dialog 構成に置換。
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

interface YoutubeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (url: string) => void;
}

export function YoutubeDialog({ open, onOpenChange, onInsert }: YoutubeDialogProps) {
  const t = useT();
  const [url, setUrl] = useState("");

  // 開くたびに入力をリセット
  useEffect(() => {
    if (open) setUrl("");
  }, [open]);

  const submit = () => {
    if (!url.trim()) return;
    onInsert(url.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("guideEditor.youtube")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {t("guideEditor.youtubeUrlPrompt")}
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
            placeholder="https://www.youtube.com/watch?v=..."
            className="h-8"
            autoFocus
          />
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
