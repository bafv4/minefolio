import { Fragment } from "react";
import { useT } from "@/hooks/use-locale";
import { isHttpUrl } from "@/lib/safe-url";
import { ExternalLink } from "lucide-react";

// 自由入力欄（マウスパッド・ドラッグテープ等）に購入ページ URL がそのまま入力されることがある。
// 長い生 URL をそのまま出すと表示が崩れ、リンク先も判別できないため、http/https の URL を
// 「{ドメイン} で見る」の外部リンクに置き換える。URL 以外の文字列はそのまま残す。
const URL_PATTERN = /https?:\/\/[^\s<>"'）)」』]+/g;

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinkifiedText({ text }: { text: string }) {
  const t = useT();
  const parts: { text: string; url?: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index) });
    // 末尾の句読点は URL に含めない
    const raw = match[0].replace(/[.,;:!?、。]+$/, "");
    if (isHttpUrl(raw)) parts.push({ text: raw, url: raw });
    else parts.push({ text: match[0] });
    if (raw.length < match[0].length) parts.push({ text: match[0].slice(raw.length) });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });

  return (
    <>
      {parts.map((part, i) =>
        part.url ? (
          <a
            key={i}
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            title={part.url}
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            {t("playerProfile.externalLinkLabel", { host: hostLabel(part.url) })}
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
