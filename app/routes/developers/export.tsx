import { Link } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/export";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, Keyboard, ArrowLeftRight, Wand2, Mouse, FileSpreadsheet, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const meta: Route.MetaFunction = ({ data }) => {
  const title = "データエクスポート - Developers - Minefolio";
  const description = "自分のキー配置・リマップ・カスタムアクション・マウス設定をCSV形式でダウンロード";
  const appUrl = data?.appUrl || "https://minefolio.pages.dev";
  const ogImage = `${appUrl}/og-image`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
  ];
};

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.env;
  return { appUrl: env?.APP_URL ?? "https://minefolio.pages.dev" };
}

interface SectionDef {
  id: "actions" | "remaps" | "custom-actions" | "mouse";
  label: string;
  icon: typeof Keyboard;
  description: string;
  columns: string[];
}

const SECTIONS: SectionDef[] = [
  {
    id: "actions",
    label: "キー配置",
    icon: Keyboard,
    description: "Minecraft の各操作（前進・攻撃・インベントリ等）に割り当てたキーの一覧。",
    columns: ["カテゴリ", "操作", "キーコード", "表示ラベル"],
  },
  {
    id: "remaps",
    label: "キーリマップ",
    icon: ArrowLeftRight,
    description: "外部ソフトウェア等で行うキーリマップ設定（ソースキー → ターゲットキー）。",
    columns: ["ソースキー", "ターゲットキー", "出力モード", "ソフトウェア", "メモ"],
  },
  {
    id: "custom-actions",
    label: "カスタムアクション",
    icon: Wand2,
    description: "マクロ・ツール起動など、ユーザー定義のアクションとトリガーキー。",
    columns: ["アクション名", "カテゴリ", "トリガーキー", "説明"],
  },
  {
    id: "mouse",
    label: "マウス設定",
    icon: Mouse,
    description: "DPI・ゲーム感度・Raw Input・Windows 速度設定など、マウス周りの数値。",
    columns: ["項目", "値"],
  },
];

export default function ExportPage() {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["actions", "remaps", "custom-actions", "mouse"]),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(SECTIONS.map((s) => s.id)));
  };

  const clearAll = () => {
    setSelected(new Set());
  };

  const handleDownload = () => {
    if (selected.size === 0) return;
    const sections = Array.from(selected).join(",");
    window.location.href = `/api/keybindings-csv?sections=${sections}`;
  };

  const allSelected = selected.size === SECTIONS.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/developers">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Developers
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Download className="h-7 w-7" />
        <h1 className="text-3xl font-bold">データエクスポート</h1>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-5 w-5" />
                キー配置データ CSV
              </CardTitle>
              <CardDescription className="mt-1">
                出力する項目を選択してダウンロードしてください。複数項目を選択すると、それぞれのテーブルが順に並んだ単一の CSV ファイルとして出力されます。
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={allSelected ? clearAll : selectAll}
              >
                {allSelected ? "すべて解除" : "すべて選択"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isChecked = selected.has(section.id);
            return (
              <button
                type="button"
                key={section.id}
                onClick={() => toggle(section.id)}
                className={cn(
                  "w-full text-left rounded-lg border p-4 transition-colors",
                  "hover:bg-accent/50",
                  isChecked
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card",
                )}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isChecked}
                    className="mt-0.5 pointer-events-none"
                    tabIndex={-1}
                  />
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                      isChecked
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-semibold">{section.label}</h3>
                      {isChecked && (
                        <Badge variant="default" className="shrink-0">
                          <Check className="h-3 w-3 mr-1" />
                          選択中
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {section.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {section.columns.map((col) => (
                        <Badge
                          key={col}
                          variant="secondary"
                          className="text-xs font-mono"
                        >
                          {col}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* 注意書き */}
      <p className="text-xs text-muted-foreground">
        ※ ログイン中のアカウントの設定がエクスポートされます。Excel など一部のソフトでは UTF-8 BOM 付き CSV として開く必要がある場合があります。
      </p>

      {/* 固定ダウンロードバー */}
      <div className="sticky bottom-4 z-30">
        <div className="rounded-xl border-2 border-primary/20 bg-card/95 backdrop-blur-sm shadow-xl p-3 sm:p-4 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {selected.size > 0 ? (
              <>
                <span className="font-medium text-foreground">{selected.size}</span>
                {" 項目を選択中"}
                {someSelected && <span className="text-xs ml-2">（{SECTIONS.length} 項目中）</span>}
              </>
            ) : (
              "項目を選択してください"
            )}
          </div>
          <Button onClick={handleDownload} disabled={selected.size === 0}>
            <Download className="h-4 w-4 mr-2" />
            CSV をダウンロード
          </Button>
        </div>
      </div>
    </div>
  );
}
