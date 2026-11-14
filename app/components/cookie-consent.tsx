import { useState, useEffect, useRef } from "react";
import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Cookie, X } from "lucide-react";

const COOKIE_CONSENT_KEY = "minefolio_cookie_consent";

export function useCookieConsent() {
  const [hasConsent, setHasConsent] = useState<boolean | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // クライアントサイドでのみ実行
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (consent === "true") {
      setHasConsent(true);
    } else if (consent === "false") {
      setHasConsent(false);
    } else {
      setHasConsent(null);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "true");
    setHasConsent(true);
    setShowBanner(false);
  };

  const declineCookies = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "false");
    setHasConsent(false);
    setShowBanner(false);
  };

  const requestConsent = () => {
    if (hasConsent === null) {
      setShowBanner(true);
    }
  };

  return { hasConsent, acceptCookies, declineCookies, requestConsent, showBanner, setShowBanner };
}

interface CookieConsentBannerProps {
  show?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
}

export function CookieConsentBanner({ show: externalShow, onAccept, onDecline }: CookieConsentBannerProps = {}) {
  const t = useT();
  const { hasConsent, acceptCookies, declineCookies } = useCookieConsent();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 外部からshowが指定されている場合はそれを優先（承諾状態に関係なく表示）
    if (externalShow !== undefined) {
      setIsVisible(externalShow && hasConsent !== true);
      return;
    }

    // 初回アクセス時の自動表示
    if (hasConsent === null) {
      const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
      if (consent === null) {
        // 初回アクセス時は少し遅延させて表示
        const timer = setTimeout(() => setIsVisible(true), 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [hasConsent, externalShow]);

  const handleAccept = () => {
    acceptCookies();
    setIsVisible(false);
    onAccept?.();
  };

  const handleDecline = () => {
    declineCookies();
    setIsVisible(false);
    onDecline?.();
  };

  // 外部からshowが指定されている場合は、承諾済みでも表示しない。
  // 自動表示の場合は、承諾済みなら表示しない
  const shouldRender = externalShow !== undefined ? isVisible : isVisible && hasConsent === null;

  // 表示中は「バナーの高さ + 余白」を --cookie-banner-offset として公開する。
  // 画面下部の固定要素（FloatingSaveBar 等）がこの値を bottom に足して重なりを避ける
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bannerRef.current;
    if (!shouldRender || !el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--cookie-banner-offset", `${el.offsetHeight + 16}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--cookie-banner-offset");
    };
  }, [shouldRender]);

  if (!shouldRender) return null;

  return (
    <div
      ref={bannerRef}
      className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:max-w-md"
    >
      <Card className="border-2 shadow-lg">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-start gap-2 sm:gap-3">
            <Cookie className="hidden h-5 w-5 text-muted-foreground shrink-0 mt-0.5 sm:block" />
            <div className="flex-1 space-y-2 sm:space-y-3">
              <div>
                <p className="font-medium text-sm">{t("cookieConsent.title")}</p>
                <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
                  {t("cookieConsent.body1")}{" "}
                  {t("cookieConsent.body2")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAccept}>
                  {t("cookieConsent.accept")}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDecline}>
                  {t("cookieConsent.decline")}
                </Button>
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label={t("cookieConsent.declineAndClose")}
                  onClick={handleDecline}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("cookieConsent.declineAndClose")}</TooltipContent>
            </Tooltip>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
