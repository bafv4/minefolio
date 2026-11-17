import { Moon, Sun, Eclipse, Check } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import type { MessageKey } from "@/lib/messages";
import { useTheme } from "next-themes";
import { useContrast } from "@/hooks/use-contrast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  const { enabled: highContrast, setEnabled: setHighContrast } = useContrast();

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
        {/* ハイコントラストはテーマとは別のオン・オフ（3テーマそれぞれに効く）。
            メニューの中なので、役割はチェック項目（role=menuitemcheckbox・aria-checked は Radix が付ける）のまま、
            見た目だけトグルスイッチにする（ui/switch.tsx と同じクラス。操作できる button を項目の中に入れ子にしない）。
            切り替えてもメニューは閉じない（結果をその場で見られるように） */}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={highContrast}
          onCheckedChange={setHighContrast}
          onSelect={(event) => event.preventDefault()}
          className="cursor-pointer justify-between gap-3 pl-2 [&>span:first-child]:hidden"
        >
          {t("theme.highContrast")}
          <span
            aria-hidden="true"
            data-slot="switch"
            data-state={highContrast ? "checked" : "unchecked"}
            className="inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80"
          >
            <span
              data-slot="switch-thumb"
              data-state={highContrast ? "checked" : "unchecked"}
              className="block size-4 rounded-full bg-background transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground"
            />
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
