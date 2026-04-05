import { useState } from "react";
import { Link } from "react-router";
import { Github, MessageSquare, Heart, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import packageJson from "../../../package.json";

const CSV_SECTIONS = [
  { id: "actions", label: "キー配置" },
  { id: "remaps", label: "キーリマップ" },
  { id: "custom-actions", label: "カスタムアクション" },
  { id: "mouse", label: "マウス設定" },
] as const;

export function Footer() {
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [selectedSections, setSelectedSections] = useState<Set<string>>(
    new Set(["actions"])
  );

  const toggleSection = (id: string) => {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDownload = () => {
    if (selectedSections.size === 0) return;
    const sections = Array.from(selectedSections).join(",");
    window.location.href = `/api/keybindings-csv?sections=${sections}`;
    setCsvDialogOpen(false);
  };

  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-8">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center">
            <div className="flex items-center space-x-2">
              <img src="/icon.png" alt="Minefolio" className="h-8 w-8" />
              <span className="text-xl font-bold">Minefolio</span>
              <span className="text-xs text-muted-foreground ml-1">{packageJson.version}</span>
              <span className="text-xs text-muted-foreground ml-1">by bafv4</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link
              to="/feedback"
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <MessageSquare className="h-3 w-3" />
              <span>フィードバック</span>
            </Link>
            <a
              href="https://github.com/bafv4/minefolio"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1"
              aria-label="GitHub Repository"
            >
              <Github className="h-3 w-3" />
              <span>GitHub</span>
            </a>
            <a
              href="https://ofuse.me/f818fea3"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1"
              aria-label="Ofuse"
            >
              <Heart className="h-3 w-3" />
              <span>Donate Me!</span>
            </a>
            <button
              onClick={() => setCsvDialogOpen(true)}
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Download className="h-3 w-3" />
              <span>CSVエクスポート</span>
            </button>
          </div>
        </div>
      </div>

      <Dialog open={csvDialogOpen} onOpenChange={setCsvDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>キー配置データ CSVエクスポート</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              出力する項目を選択してください。
            </p>
            {CSV_SECTIONS.map((section) => (
              <div key={section.id} className="flex items-center gap-2">
                <Checkbox
                  id={`csv-${section.id}`}
                  checked={selectedSections.has(section.id)}
                  onCheckedChange={() => toggleSection(section.id)}
                />
                <Label htmlFor={`csv-${section.id}`} className="cursor-pointer">
                  {section.label}
                </Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCsvDialogOpen(false)}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleDownload}
              disabled={selectedSections.size === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              ダウンロード
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </footer>
  );
}
