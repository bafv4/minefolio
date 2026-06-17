import { Moon, Sun, Eclipse, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** テーマの選択肢（デスクトップのドロップダウンとモバイルの切替で共有） */
export const THEME_OPTIONS = [
  { value: "light", label: "ライト", shortLabel: "ライト", icon: Sun },
  { value: "dark", label: "ダーク", shortLabel: "ダーク", icon: Moon },
  { value: "ultra-dark", label: "ウルトラダーク", shortLabel: "ウルトラ", icon: Eclipse },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="テーマを切り替え">
          {/* light = 太陽、dark / ultra-dark = 月（dark variant で切替） */}
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" aria-hidden />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" aria-hidden />
          <span className="sr-only">テーマを切り替え</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            className="cursor-pointer"
          >
            <Icon className="mr-2 h-4 w-4" />
            {label}
            {theme === value && <Check className="ml-auto h-4 w-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
