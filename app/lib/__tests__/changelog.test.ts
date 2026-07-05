import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseChangelog, unreadEntries, type ChangelogEntry } from "../changelog";

const SAMPLE = `## v1.6.0（2026/07/04）

### プロフィール
- サーチクラフトタブの表示を刷新しました。

### Playground
- Playground を追加しました（\`/playground\`）。

## v1.5.2（2026/06/17）

### 共有機能

- プロフィール共有用のボタンを追加しました。

## v1.5.1（2026/06/13）

### その他
- スキン画像をアプリ全体で共有・キャッシュするようにしました。
`;

describe("parseChangelog", () => {
  it("バージョン・日付・カテゴリ・本文を新しい順に抽出する", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries).toHaveLength(3);
    expect(entries[0].version).toBe("v1.6.0");
    expect(entries[0].date).toBe("2026/07/04");
    expect(entries[0].categories).toEqual(["プロフィール", "Playground"]);
    expect(entries[0].body).toContain("### プロフィール");
    expect(entries[0].body).toContain("サーチクラフトタブの表示を刷新しました。");
    expect(entries[0].body).not.toContain("v1.5.2");
    expect(entries[1].version).toBe("v1.5.2");
    expect(entries[2].version).toBe("v1.5.1");
  });

  it("本文はバージョン見出し行を含まず、前後の空行がトリムされる", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries[0].body.startsWith("### プロフィール")).toBe(true);
    expect(entries[0].body.endsWith("。")).toBe(true);
  });

  it("先頭のバージョン見出しより前のテキストは無視する", () => {
    const entries = parseChangelog(`# 更新履歴\n\nはじめに\n\n${SAMPLE}`);
    expect(entries).toHaveLength(3);
    expect(entries[0].version).toBe("v1.6.0");
  });

  it("CRLF改行でもパースできる", () => {
    const entries = parseChangelog(SAMPLE.replace(/\n/g, "\r\n"));
    expect(entries).toHaveLength(3);
    expect(entries[0].categories).toEqual(["プロフィール", "Playground"]);
  });

  it("規約フォーマットに一致しない見出しはバージョンとして扱わない", () => {
    // 半角括弧・vなし・パッチ番号なしはいずれも不一致
    const invalid = [
      "## v1.6.0(2026/07/04)",
      "## 1.6.0（2026/07/04）",
      "## v1.6（2026/07/04）",
    ].join("\n\n- 内容\n\n");
    expect(parseChangelog(invalid)).toEqual([]);
  });

  it("空文字列からは空配列を返す", () => {
    expect(parseChangelog("")).toEqual([]);
  });
});

describe("unreadEntries", () => {
  const entries: ChangelogEntry[] = parseChangelog(SAMPLE);

  it("既読がnull（キーなし）の場合は最新1件のみを未読として返す", () => {
    const unread = unreadEntries(entries, null);
    expect(unread).toHaveLength(1);
    expect(unread[0].version).toBe("v1.6.0");
  });

  it("既読が最新と一致する場合は空を返す", () => {
    expect(unreadEntries(entries, "v1.6.0")).toEqual([]);
  });

  it("既読より新しいエントリだけを新しい順で返す", () => {
    const unread = unreadEntries(entries, "v1.5.1");
    expect(unread.map((e) => e.version)).toEqual(["v1.6.0", "v1.5.2"]);
  });

  it("既読バージョンが見つからない場合は全件を未読として返す", () => {
    const unread = unreadEntries(entries, "v0.9.0");
    expect(unread).toHaveLength(3);
  });

  it("エントリが空なら常に空を返す", () => {
    expect(unreadEntries([], null)).toEqual([]);
    expect(unreadEntries([], "v1.6.0")).toEqual([]);
  });
});

describe("実データ（app/content/changelog.md）", () => {
  // changelog.md の見出しフォーマット崩れ（半角括弧など）をCIで検知する保険
  it("先頭セクションが規約フォーマットでパースできる", () => {
    const changelogPath = fileURLToPath(
      new URL("../../content/changelog.md", import.meta.url),
    );
    const md = readFileSync(changelogPath, "utf-8");
    const entries = parseChangelog(md);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(entries[0].date).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    expect(entries[0].body.length).toBeGreaterThan(0);
    // "## " 行がすべてバージョン見出しとしてパースできていること。
    // 先頭・中間どこかの見出しが崩れると件数が合わなくなり、ここで検知できる
    const headingCount = (md.match(/^## /gm) ?? []).length;
    expect(entries.length).toBe(headingCount);
  });
});
