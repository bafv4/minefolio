import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Cookie, X } from "lucide-react";

const COOKIE_CONSENT_KEY = "minefolio_cookie_consent";

export function useCookieConsent() {
  const [hasConsent, setHasConsent] = useState<boolean | null>(null);

  useEffect(() => {
    // クライアントサイドでのみ実行
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    setHasConsent(consent === "true");
  }, []);

  const acceptCookies = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "true");
    setHasConsent(true);
  };

  const declineCookies = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "false");
    setHasConsent(false);
  };

  return { hasConsent, acceptCookies, declineCookies };
}

export function CookieConsentBanner() {
  const { hasConsent, acceptCookies, declineCookies } = useCookieConsent();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 承諾状態が未設定（null以外でundefinedでもない）の場合のみ表示
    if (hasConsent === null) {
      // localStorageを確認
      const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
      if (consent === null) {
        setIsVisible(true);
      }
    }
  }, [hasConsent]);

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
                <Button size="sm" onClick={acceptCookies}>
                  同意する
                </Button>
                <Button size="sm" variant="outline" onClick={declineCookies}>
                  拒否する
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={declineCookies}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
