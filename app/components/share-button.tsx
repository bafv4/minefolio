import { useState } from "react";
import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Share2, Link2, Check } from "lucide-react";
import { Twitter } from "@/components/brand-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ShareButtonProps {
  title: string;
  url?: string;
  description?: string;
  includeTab?: boolean; // 現在のタブをURLに含めるか
  /** md 未満はアイコンのみ（ラベルは sr-only で残す）。既定 false */
  compactOnMobile?: boolean;
  /** compactOnMobile の切り替え幅。既定 "md"（md 未満でアイコンのみ）、"sm" なら sm 未満 */
  compactBelow?: "sm" | "md";
  /** トリガーボタンへの追加クラス（モバイルの 44px 化など。既定は変えない） */
  className?: string;
}

export function ShareButton({ title, url, description, includeTab = false, compactOnMobile = false, compactBelow = "md", className }: ShareButtonProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const getShareUrl = () => {
    if (url) return url;
    if (typeof window !== "undefined") {
      // includeTabがtrueの場合、現在のURLをそのまま使用（タブパラメータ含む）
      // falseの場合、タブパラメータを除外
      if (!includeTab) {
        const urlObj = new URL(window.location.href);
        // タブパラメータがあれば除外
        if (urlObj.searchParams.has("tab")) {
          urlObj.searchParams.delete("tab");
          return urlObj.toString();
        }
      }
      return window.location.href;
    }
    return "";
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(getShareUrl());
      setCopied(true);
      toast.success(t("share.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("share.copyFailed"));
    }
  };

  const handleShareTwitter = () => {
    const shareUrl = getShareUrl();
    const shareText = description ?? title;
    const twitterUrl = new URL("https://twitter.com/intent/tweet");
    twitterUrl.searchParams.set("text", `${shareText}\n${shareUrl}`);
    window.open(twitterUrl.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <Share2 className={cn("h-4 w-4", compactOnMobile ? (compactBelow === "sm" ? "sm:mr-2" : "md:mr-2") : "mr-2")} aria-hidden />
          <span className={cn(compactOnMobile && (compactBelow === "sm" ? "max-sm:sr-only" : "max-md:sr-only"))}>{t("share.label")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleShareTwitter}>
          <Twitter className="h-4 w-4 mr-2" />
          {t("share.shareOnX")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyLink}>
          {copied ? (
            <Check className="h-4 w-4 mr-2 text-success" />
          ) : (
            <Link2 className="h-4 w-4 mr-2" />
          )}
          {t("share.copyLink")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
