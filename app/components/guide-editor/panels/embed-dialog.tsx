// キーバインド / サーチクラフト埋め込みの入力ダイアログ。
// 旧 index.tsx の手動オーバーレイを shadcn Dialog に置換。
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

export type EmbedKind = "keybind" | "searchcraft";

interface EmbedDialogProps {
  /** 開いている埋め込み種別。null で非表示 */
  kind: EmbedKind | null;
  onOpenChange: (open: boolean) => void;
  onInsert: (kind: EmbedKind, slug: string, preset: string) => void;
}

export function EmbedDialog({ kind, onOpenChange, onInsert }: EmbedDialogProps) {
  const t = useT();
  const [slug, setSlug] = useState("");
  const [preset, setPreset] = useState("");

  // 開くたびに入力をリセット
  useEffect(() => {
    if (kind) {
      setSlug("");
      setPreset("");
    }
  }, [kind]);

  const submit = () => {
    if (!kind || !slug.trim()) return;
    onInsert(kind, slug.trim(), preset.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {kind === "searchcraft"
              ? t("guideEditor.embedSearchCraftTitle")
              : t("guideEditor.embedKeybindTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("guideEditor.embedUserSlug")}</label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="mcid or slug"
              className="h-8"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("guideEditor.embedPresetName")}</label>
            <Input
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="h-8"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("guideEditor.embedCancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={!slug.trim()}>
            {t("guideEditor.embedInsert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
