import { Languages } from "lucide-react";
import { NoticeBanner } from "@/components/notice-banner";
import { useLocale, useT } from "@/hooks/use-locale";

/** 日本語だけで提供している文書（開発者向けページ）の先頭に、日本語以外のロケールでだけ出す断り書き */
export function JaOnlyNotice() {
  const t = useT();
  const locale = useLocale();
  if (locale === "ja") return null;
  return (
    <NoticeBanner tone="info" icon={Languages}>
      {t("developers.jaOnlyNotice")}
    </NoticeBanner>
  );
}
