import { Link, useLoaderData } from "react-router";
import { useState, useMemo } from "react";
import type { Route } from "./+types/export";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, keyRemaps, customActions } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Download, Keyboard, ArrowLeftRight, Wand2, Mouse, FileSpreadsheet, Search, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = "データエクスポート - Developers - Minefolio";
  const description = "全ユーザーまたは指定ユーザーのキー配置・リマップ・カスタムアクション・マウス設定をCSV形式でダウンロード";
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
  ];
};

interface AvailableUser {
  slug: string;
  mcid: string | null;
  displayName: string | null;
}

export async function loader() {
  const env = getEnv();
  const db = createDb();

  // 設定（キー配置・リマップ・カスタムアクションのいずれか）が登録されている公開ユーザーを取得
  const allPlayers = await db.query.users.findMany({
    where: eq(users.profileVisibility, "public"),
    columns: {
      slug: true,
      mcid: true,
      displayName: true,
    },
    with: {
      keybindings: { columns: { id: true } },
      keyRemaps: { columns: { id: true } },
      customActions: { columns: { id: true } },
    },
  });

  const availableUsers: AvailableUser[] = allPlayers
    .filter((p) => p.keybindings.length > 0 || p.keyRemaps.length > 0 || p.customActions.length > 0)
    .map((p) => ({ slug: p.slug, mcid: p.mcid, displayName: p.displayName }))
    .sort((a, b) => {
      const an = (a.displayName ?? a.mcid ?? a.slug).toLowerCase();
      const bn = (b.displayName ?? b.mcid ?? b.slug).toLowerCase();
      return an.localeCompare(bn);
    });

  return {
    appUrl: env.APP_URL ?? "https://minefolio.app",
    availableUsers,
  };
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
    columns: ["ソースキー", "ターゲットキー", "出力モード", "ソフトウェア", "メモ", "種別"],
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

function getDisplayName(user: AvailableUser): string {
  return user.displayName ?? user.mcid ?? user.slug;
}

export default function ExportPage() {
  const { availableUsers } = useLoaderData<typeof loader>();
  const [selectedSections, setSelectedSections] = useState<Set<string>>(
    new Set(["actions", "remaps", "custom-actions", "mouse"]),
  );
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");

  const toggleSection = (id: string) => {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSectionsSelected = selectedSections.size === SECTIONS.length;
  const toggleAllSections = () => {
    setSelectedSections(allSectionsSelected ? new Set() : new Set(SECTIONS.map((s) => s.id)));
  };

  const toggleUser = (slug: string) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return availableUsers;
    return availableUsers.filter((u) => {
      return (
        u.slug.toLowerCase().includes(q) ||
        (u.mcid?.toLowerCase().includes(q) ?? false) ||
        (u.displayName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [availableUsers, userSearch]);

  const handleDownload = () => {
    if (selectedSections.size === 0) return;
    const params = new URLSearchParams();
    params.set("sections", Array.from(selectedSections).join(","));
    if (selectedUsers.size > 0) {
      params.set("userSlugs", Array.from(selectedUsers).join(","));
    }
    window.location.href = `/api/keybindings-csv?${params.toString()}`;
  };

  const isAllUsersMode = selectedUsers.size === 0;
  const targetUserCount = isAllUsersMode ? availableUsers.length : selectedUsers.size;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-0">
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

      <p className="text-sm text-muted-foreground">
        Minefolio に登録された設定データを CSV 形式でダウンロードできます。デフォルトでは設定登録済みの全ユーザーが対象ですが、特定のユーザーだけを選択することも可能です。
      </p>

      {/* セクション選択 */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-5 w-5" />
                出力する項目
              </CardTitle>
              <CardDescription className="mt-1">
                複数項目を選択すると、それぞれのテーブルが順に並んだ単一の CSV として出力されます。
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={toggleAllSections}>
              {allSectionsSelected ? "すべて解除" : "すべて選択"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isChecked = selectedSections.has(section.id);
            return (
              <button
                type="button"
                key={section.id}
                onClick={() => toggleSection(section.id)}
                className={cn(
                  "w-full text-left rounded-lg border p-4 transition-colors hover:bg-accent/50",
                  isChecked ? "border-primary bg-primary/5" : "border-border bg-card",
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
                      isChecked ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">{section.label}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {section.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {section.columns.map((col) => (
                        <Badge key={col} variant="secondary" className="text-xs font-mono">
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

      {/* 対象ユーザー */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-5 w-5" />
                対象ユーザー
              </CardTitle>
              <CardDescription className="mt-1">
                何も選択していない場合は<strong>全 {availableUsers.length} 人</strong>がエクスポート対象になります。特定ユーザーだけ出力したい場合は下のリストから選択してください。
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedUsers(new Set())}
              disabled={selectedUsers.size === 0}
            >
              <X className="h-4 w-4 mr-1" />
              選択をクリア
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 検索 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="ユーザー名・MCID で検索..."
              className="pl-9"
            />
          </div>

          {/* ユーザー一覧 */}
          <div className="rounded-lg border max-h-80 overflow-y-auto">
            {filteredUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                該当するユーザーが見つかりませんでした
              </p>
            ) : (
              <div className="divide-y">
                {filteredUsers.map((user) => {
                  const isChecked = selectedUsers.has(user.slug);
                  const name = getDisplayName(user);
                  return (
                    <button
                      type="button"
                      key={user.slug}
                      onClick={() => toggleUser(user.slug)}
                      className={cn(
                        "w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors flex items-center gap-2",
                        isChecked && "bg-primary/5",
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        className="pointer-events-none"
                        tabIndex={-1}
                      />
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="font-medium truncate">{name}</span>
                        {user.mcid && user.displayName && user.mcid !== user.displayName && (
                          <span className="text-xs text-muted-foreground truncate">
                            @{user.mcid}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        ※ 公開プロフィール（profileVisibility = public）のみが対象です。Excel など一部のソフトでは UTF-8 BOM 付き CSV として開く必要がある場合があります。
      </p>

      {/* ダウンロードバー（ページ末尾） */}
      <div className="rounded-xl border-2 border-primary/20 bg-card/95 p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {selectedSections.size === 0 ? (
            "項目を選択してください"
          ) : (
            <>
              <span className="font-medium text-foreground">{selectedSections.size}</span>
              {" 項目 × "}
              <span className="font-medium text-foreground">{targetUserCount}</span>
              {" 人"}
              {isAllUsersMode && (
                <span className="text-xs ml-1.5 text-muted-foreground">（全ユーザー）</span>
              )}
            </>
          )}
        </div>
        <Button
          onClick={handleDownload}
          disabled={selectedSections.size === 0 || availableUsers.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          CSV をダウンロード
        </Button>
      </div>
    </div>
  );
}
