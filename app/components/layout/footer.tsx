import { Link } from "react-router";
import { useT } from "@/hooks/use-locale";
import { Github, MessageSquare, Heart, Code } from "lucide-react";
import packageJson from "../../../package.json";

export function Footer() {
  const t = useT();
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-8">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center">
            <div className="flex items-center space-x-2">
              <img src="/icon.png" alt="Minefolio" className="h-8 w-8" />
              <span className="text-xl font-bold">Minefolio</span>
              <span className="text-xs text-muted-foreground ml-1">{packageJson.version}</span>
              <span className="text-xs text-muted-foreground ml-1">by bafv4</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link
              to="/feedback"
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <MessageSquare className="h-3 w-3" />
              <span>{t("nav.feedback")}</span>
            </Link>
            <a
              href="https://github.com/bafv4/minefolio"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1"
              aria-label="GitHub Repository"
            >
              <Github className="h-3 w-3" />
              <span>GitHub</span>
            </a>
            <a
              href="https://ofuse.me/f818fea3"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1"
              aria-label="Ofuse"
            >
              <Heart className="h-3 w-3" />
              <span>{t("nav.donate")}</span>
            </a>
            <Link
              to="/developers"
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Code className="h-3 w-3" />
              <span>{t("nav.developers")}</span>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
