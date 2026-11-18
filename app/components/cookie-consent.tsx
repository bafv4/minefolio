import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
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

/**
 * 自動表示を見合わせるパス（ログインと初期設定）。中央のカードの主ボタン（ログイン・次へ）に
 * 下端固定のバナーが重なるため。ここを離れたら（未回答なら）いつもどおり表示する
 */
const AUTO_BANNER_DEFERRED_PATHS = ["/login", "/onboarding", "/dev/login"];

export function CookieConsentBanner({ show: externalShow, onAccept, onDecline }: CookieConsentBannerProps = {}) {
  const t = useT();
  const { pathname } = useLocation();
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
  // ログイン・初期設定の画面では、自動表示を出さない（外部から show を指定したときはそのまま）
  const deferred =
    externalShow === undefined &&
    AUTO_BANNER_DEFERRED_PATHS.includes(pathname.replace(/\/+$/, "") || "/");
  const shouldRender = externalShow !== undefined ? isVisible : isVisible && hasConsent === null && !deferred;

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
      role="region"
      aria-label={t("cookieConsent.title")}
      className="fixed bottom-[calc(1rem+var(--bottom-dock-height,0px))] left-4 right-4 z-50 md:left-auto md:right-4 md:max-w-md"
    >
      {/* モバイルは Card 基底の py-6 を外し、CardContent の p-3 だけにする（下端固定で画面を覆う高さを抑える） */}
      <Card className="border border-border/70 py-0 shadow-lg sm:py-6">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-start gap-2 sm:gap-3">
            <Cookie className="hidden h-5 w-5 text-muted-foreground shrink-0 mt-0.5 sm:block" aria-hidden />
            <div className="flex-1 space-y-2 sm:space-y-3">
              <div>
                <p className="sr-only font-medium text-sm sm:not-sr-only">{t("cookieConsent.title")}</p>
                <p className="text-xs text-muted-foreground sm:mt-1">
                  <span className="sm:hidden">{t("cookieConsent.bodyShort")}</span>
                  <span className="hidden sm:inline">
                    {t("cookieConsent.body1")}{" "}
                    {t("cookieConsent.body2")}
                  </span>{" "}
                  <Link
                    to="/privacy"
                    className="-my-3 inline-flex min-h-11 items-center underline underline-offset-2 sm:my-0 sm:min-h-0"
                  >
                    {t("cookieConsent.details")}
                  </Link>
                </p>
              </div>
              {/* 同意と拒否は同じ重さ（どちらかへ誘導しない） */}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={handleAccept}>
                  {t("cookieConsent.accept")}
                </Button>
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={handleDecline}>
                  {t("cookieConsent.decline")}
                </Button>
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 -m-1.5 size-11 sm:m-0 sm:size-8"
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
