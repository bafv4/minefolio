// 言語切り替え。選択は Cookie に保存し、リロードして全体を切り替える
// （文言はサーバー側で決まるため、クライアント state だけでは切り替わらない）。
import { Languages, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useLocale, useT, useSetLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "@/lib/locale";

export function LocaleSwitcher() {
  const currentLocale = useLocale();
  const setLocale = useSetLocale();
  const t = useT();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("nav.changeLanguage")}>
          <Languages className="h-5 w-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => setLocale(locale)}
            aria-current={currentLocale === locale}
          >
            {LOCALE_NAMES[locale]}
            {currentLocale === locale && <Check className="ml-auto h-4 w-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
