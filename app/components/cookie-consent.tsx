import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const { hasConsent, acceptCookies, declineCookies } = useCookieConsent();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 外部からshowが指定されている場合はそれを優先
    if (externalShow !== undefined) {
      setIsVisible(externalShow && hasConsent === null);
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

  if (!isVisible || hasConsent !== null) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:max-w-md">
      <Card className="border-2 shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Cookie className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1 space-y-3">
              <div>
                <p className="font-medium text-sm">Cookieの使用について</p>
                <p className="text-xs text-muted-foreground mt-1">
                  お気に入り機能を利用するためにCookieを使用します。
                  Cookieにはお気に入りに登録したプレイヤーのIDのみが保存されます。
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAccept}>
                  同意する
                </Button>
                <Button size="sm" variant="outline" onClick={handleDecline}>
                  拒否する
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={handleDecline}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
