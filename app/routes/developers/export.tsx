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
import { createTranslator, type MessageKey } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import type { Locale } from "@/lib/locale";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("developers.exportMetaTitle");
  const description = t("developers.exportMetaDescription");
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
  displayNameAlphabet: string | null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const locale = resolveLocale(request);

  // 設定（キー配置・リマップ・カスタムアクションのいずれか）が登録されている公開ユーザーを取得
  const allPlayers = await db.query.users.findMany({
    where: eq(users.profileVisibility, "public"),
    columns: {
      slug: true,
      mcid: true,
      displayName: true,
      displayNameAlphabet: true,
    },
    with: {
      keybindings: { columns: { id: true } },
      keyRemaps: { columns: { id: true } },
      customActions: { columns: { id: true } },
    },
  });

  const availableUsers: AvailableUser[] = allPlayers
    .filter((p) => p.keybindings.length > 0 || p.keyRemaps.length > 0 || p.customActions.length > 0)
    .map((p) => ({ slug: p.slug, mcid: p.mcid, displayName: p.displayName, displayNameAlphabet: p.displayNameAlphabet }))
    .sort((a, b) => {
      // 並び順は表示に使う名前に合わせる（英語表示ではアルファベット表記で並ぶ）
      const an = getLocalizedDisplayName(a, locale).toLowerCase();
      const bn = getLocalizedDisplayName(b, locale).toLowerCase();
      return an.localeCompare(bn);
    });

  return {
    appUrl: env.APP_URL ?? "https://minefolio.app",
    availableUsers,
  };
}

interface SectionDef {
  id: "actions" | "remaps" | "custom-actions" | "mouse";
  labelKey: MessageKey;
  icon: typeof Keyboard;
  descriptionKey: MessageKey;
  columnKeys: MessageKey[];
}

// ラベル・説明・列名は描画時に t() で解決する（モジュール評価時はロケールが未確定）
const SECTIONS: SectionDef[] = [
  {
    id: "actions",
    labelKey: "developers.sectionActions",
    icon: Keyboard,
    descriptionKey: "developers.sectionActionsDescription",
    columnKeys: [
      "developers.colCategory",
      "developers.colAction",
      "developers.colKeyCode",
      "developers.colDisplayLabel",
    ],
  },
  {
    id: "remaps",
    labelKey: "developers.sectionRemaps",
    icon: ArrowLeftRight,
    descriptionKey: "developers.sectionRemapsDescription",
    columnKeys: [
      "developers.colSourceKey",
      "developers.colTargetKey",
      "developers.colOutputMode",
      "developers.colSoftware",
      "developers.colNotes",
      "developers.colRemapType",
    ],
  },
  {
    id: "custom-actions",
    labelKey: "developers.sectionCustomActions",
    icon: Wand2,
    descriptionKey: "developers.sectionCustomActionsDescription",
    columnKeys: [
      "developers.colActionName",
      "developers.colCategory",
      "developers.colTriggerKey",
      "developers.colDescription",
    ],
  },
  {
    id: "mouse",
    labelKey: "developers.sectionMouse",
    icon: Mouse,
    descriptionKey: "developers.sectionMouseDescription",
    columnKeys: ["developers.colItem", "developers.colValue"],
  },
];

function getDisplayName(user: AvailableUser, locale: Locale): string {
  return getLocalizedDisplayName(user, locale);
}

export default function ExportPage() {
  const t = useT();
  const locale = useLocale();
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
        (u.displayName?.toLowerCase().includes(q) ?? false) ||
        (u.displayNameAlphabet?.toLowerCase().includes(q) ?? false)
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
            {t("developers.heading")}
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Download className="h-6 w-6" />
        <h1 className="text-2xl font-bold">{t("developers.exportTitle")}</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("developers.exportLead")}
      </p>

      {/* セクション選択 */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-5 w-5" />
                {t("developers.exportSections")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("developers.exportSectionsHint")}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={toggleAllSections}>
              {allSectionsSelected ? t("developers.exportDeselectAll") : t("developers.exportSelectAll")}
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
                    <h3 className="font-semibold">{t(section.labelKey)}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t(section.descriptionKey)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {section.columnKeys.map((col) => (
                        <Badge key={col} variant="secondary" className="text-xs font-mono">
                          {t(col)}
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
                {t("developers.exportTargets")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("developers.exportTargetsHint", { count: availableUsers.length })}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedUsers(new Set())}
              disabled={selectedUsers.size === 0}
            >
              <X className="h-4 w-4 mr-1" />
              {t("developers.exportClearSelection")}
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
              placeholder={t("developers.exportSearchPlaceholder")}
              className="pl-9"
            />
          </div>

          {/* ユーザー一覧 */}
          <div className="rounded-lg border max-h-80 overflow-y-auto">
            {filteredUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("developers.exportNoUsers")}
              </p>
            ) : (
              <div className="divide-y">
                {filteredUsers.map((user) => {
                  const isChecked = selectedUsers.has(user.slug);
                  const name = getDisplayName(user, locale);
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
        {t("developers.exportNote")}
      </p>

      {/* ダウンロードバー（ページ末尾） */}
      <div className="rounded-xl border-2 border-primary/20 bg-card/95 p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {selectedSections.size === 0 ? (
            t("developers.exportPickSections")
          ) : (
            <>
              {t("developers.exportSummary", {
                sections: selectedSections.size,
                users: targetUserCount,
              })}
              {isAllUsersMode && (
                <span className="text-xs ml-1.5 text-muted-foreground">
                  {t("developers.exportAllUsersSuffix")}
                </span>
              )}
            </>
          )}
        </div>
        <Button
          onClick={handleDownload}
          disabled={selectedSections.size === 0 || availableUsers.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          {t("developers.exportDownload")}
        </Button>
      </div>
    </div>
  );
}
