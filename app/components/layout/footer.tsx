import { Link } from "react-router";
import { useT } from "@/hooks/use-locale";
import { MessageSquare, Heart, Code, Shield, ScrollText } from "lucide-react";
import { Github } from "@/components/brand-icons";
import { version } from "../../../package.json";

export function Footer() {
  const t = useT();
  return (
    <footer className="border-t border-border bg-background">
      {/* 下の余白: ページ末尾で出る「トップへ戻る」（右下 fixed、下端インセット＋1.5rem から高さ 44px）が
          折り返したリンクに重ならないよう、lg 未満はボタンの高さぶん（約 4.25rem）以上を空ける */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-20 lg:pb-8">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center">
            <div className="flex items-center space-x-2">
              <img src="/icon.png" alt="" className="h-8 w-8" />
              <span className="text-xl font-bold">Minefolio</span>
              <span className="text-xs text-muted-foreground ml-1">{version}</span>
              <span className="text-xs text-muted-foreground ml-1">by bfmkn</span>
            </div>
          </div>

          {/* リンクはモバイルで高さ 44px（行の間隔は高さで取る）。sm 以上は文字の高さに戻す */}
          <div className="flex flex-wrap items-center justify-center gap-x-3 sm:gap-y-1.5 text-xs text-muted-foreground">
            <Link
              to="/feedback"
              className="hover:text-foreground transition-colors flex min-h-11 items-center gap-1 sm:min-h-6"
            >
              <MessageSquare className="h-3 w-3" />
              <span>{t("nav.feedback")}</span>
            </Link>
            <Link
              to="/developers"
              className="hover:text-foreground transition-colors flex min-h-11 items-center gap-1 sm:min-h-6"
            >
              <Code className="h-3 w-3" />
              <span>{t("nav.developers")}</span>
            </Link>
            <Link
              to="/privacy"
              className="hover:text-foreground transition-colors flex min-h-11 items-center gap-1 sm:min-h-6"
            >
              <Shield className="h-3 w-3" />
              <span>{t("nav.privacy")}</span>
            </Link>
            <Link
              to="/terms"
              className="hover:text-foreground transition-colors flex min-h-11 items-center gap-1 sm:min-h-6"
            >
              <ScrollText className="h-3 w-3" />
              <span>{t("nav.terms")}</span>
            </Link>
            <a
              href="https://github.com/bafv4/minefolio"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex min-h-11 items-center gap-1 sm:min-h-6"
            >
              <Github className="h-3 w-3" />
              <span>GitHub</span>
            </a>
            <a
              href="https://ofuse.me/f818fea3"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex min-h-11 items-center gap-1 sm:min-h-6"
            >
              <Heart className="h-3 w-3" />
              <span>{t("nav.donate")}</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
