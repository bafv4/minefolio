import { Moon, Sun, Eclipse, Check } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import type { MessageKey } from "@/lib/messages";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** テーマの選択肢（デスクトップのドロップダウンとモバイルの切替で共有） */
// ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定）
export const THEME_OPTIONS = [
  { value: "light", labelKey: "theme.light", shortLabelKey: "theme.lightShort", icon: Sun },
  { value: "dark", labelKey: "theme.dark", shortLabelKey: "theme.darkShort", icon: Moon },
  { value: "ultra-dark", labelKey: "theme.ultraDark", shortLabelKey: "theme.ultraDarkShort", icon: Eclipse },
] as const satisfies readonly { value: string; labelKey: MessageKey; shortLabelKey: MessageKey; icon: unknown }[];

export function ThemeToggle() {
  const t = useT();
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("theme.toggle")}>
          {/* light = 太陽、dark / ultra-dark = 月（dark variant で切替） */}
          <Sun className="rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" aria-hidden />
          <Moon className="absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" aria-hidden />
          <span className="sr-only">{t("theme.toggle")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            className="cursor-pointer"
          >
            <Icon className="mr-2 h-4 w-4" />
            {t(labelKey)}
            {theme === value && <Check className="ml-auto h-4 w-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
