import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { isLocale } from "@/lib/locale";
import { loadLocaleMessages } from "@/lib/messages";

// 英語カタログは遅延読み込み。サーバーが描いたロケール（root.tsx が <html lang> に出す）の
// 文言をハイドレーション前に読み終えておき、初回描画が日本語になる不一致を防ぐ。
const lang = document.documentElement.lang;
if (isLocale(lang)) {
  await loadLocaleMessages(lang).catch(() => undefined);
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
