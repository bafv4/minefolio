import changelogMd from "@/content/changelog.md?raw";
import { parseChangelog } from "@/lib/changelog";

// changelog.md 全文（?raw）＋パース処理は、共通レイアウトの初期チャンクから
// 分離するため whats-new.tsx から動的 import される専用モジュールに切り出す。
// ここでモジュール読み込み時に一度だけパースする。
export const entries = parseChangelog(changelogMd);
export const changelogMarkdown = changelogMd;
