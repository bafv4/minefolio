// 言語切り替え。選択は Cookie に保存し、リロードして全体を切り替える
// （文言はサーバー側で決まるため、クライアント state だけでは切り替わらない）。
import { Languages, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale, useT, useSetLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, LOCALE_NAMES, type Locale } from "@/lib/locale";

/** ラジオ項目を DropdownMenuItem と同じ見た目にする（左の丸印を隠し、余白とアイコン色を揃える） */
const MENU_RADIO_ITEM_CLASS =
  "py-2.5 pl-2 md:py-1.5 [&>span:first-child]:hidden [&_svg:not([class*='text-'])]:text-muted-foreground";

export function LocaleSwitcher() {
  const currentLocale = useLocale();
  const setLocale = useSetLocale();
  const t = useT();

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("nav.changeLanguage")}>
              <Languages aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>{t("nav.changeLanguage")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {/* 選択肢はラジオ項目（role=menuitemradio・aria-checked で現在の言語が読み上げられる）。
            右端のチェックは飾り（aria-hidden） */}
        <DropdownMenuRadioGroup
          value={currentLocale}
          onValueChange={(value) => setLocale(value as Locale)}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <DropdownMenuRadioItem
              key={locale}
              value={locale}
              className={MENU_RADIO_ITEM_CLASS}
            >
              {LOCALE_NAMES[locale]}
              {currentLocale === locale && <Check className="ml-auto h-4 w-4" aria-hidden />}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
