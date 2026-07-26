import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { LocaleProvider } from "@/hooks/use-locale";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

interface ProvidersProps {
  children: React.ReactNode;
  /** 表示ロケール。root ローダーが決めた値（未取得時は既定） */
  locale?: Locale;
}

export function Providers({ children, locale = DEFAULT_LOCALE }: ProvidersProps) {
  return (
    <LocaleProvider locale={locale}>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={["light", "dark", "ultra-dark"]}
    >
      {children}
      <Toaster position="top-right" />
    </ThemeProvider>
    </LocaleProvider>
  );
}
