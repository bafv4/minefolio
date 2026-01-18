// 言語切り替えコンポーネント
import { useFetcher } from "react-router";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { supportedLocales, type Locale } from "@/lib/i18n";

interface LocaleSwitcherProps {
  currentLocale: Locale;
}

export function LocaleSwitcher({ currentLocale }: LocaleSwitcherProps) {
  const fetcher = useFetcher();

  const handleLocaleChange = (locale: Locale) => {
    const formData = new FormData();
    formData.append("locale", locale);
    fetcher.submit(formData, {
      method: "post",
      action: "/api/set-locale",
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change language">
          <Globe className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {Object.entries(supportedLocales).map(([locale, { nativeName }]) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => handleLocaleChange(locale as Locale)}
            className={currentLocale === locale ? "bg-accent" : ""}
          >
            {nativeName}
            {currentLocale === locale && (
              <span className="ml-auto">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
