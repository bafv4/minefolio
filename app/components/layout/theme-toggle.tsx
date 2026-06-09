import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const isDark = (theme === "system" ? resolvedTheme : theme) === "dark";
  const nextLabel = isDark ? "ライトモードに切り替え" : "ダークモードに切り替え";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={nextLabel}
      aria-pressed={isDark}
      title={nextLabel}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" aria-hidden />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" aria-hidden />
      <span className="sr-only">{nextLabel}</span>
    </Button>
  );
}
