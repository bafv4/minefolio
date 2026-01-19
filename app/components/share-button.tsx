import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Share2, Twitter, Link2, Check } from "lucide-react";
import { toast } from "sonner";

interface ShareButtonProps {
  title: string;
  url?: string;
  description?: string;
  includeTab?: boolean; // 現在のタブをURLに含めるか
}

export function ShareButton({ title, url, description, includeTab = false }: ShareButtonProps) {
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
      toast.success("リンクをコピーしました");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("コピーに失敗しました");
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
        <Button variant="outline" size="sm">
          <Share2 className="h-4 w-4 mr-2" />
          シェア
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleShareTwitter}>
          <Twitter className="h-4 w-4 mr-2" />
          Xでシェア
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyLink}>
          {copied ? (
            <Check className="h-4 w-4 mr-2 text-green-500" />
          ) : (
            <Link2 className="h-4 w-4 mr-2" />
          )}
          リンクをコピー
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
