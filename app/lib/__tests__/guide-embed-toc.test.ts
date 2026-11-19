import { describe, expect, it } from "vitest";
import { buildTableOfContents } from "../guide-toc";
import { demoteGuideHeadings } from "../guide-heading-demote";
import { embedGroupHeadingId, mergeEmbedGroupsIntoToc, type TocSegment } from "../guide-embed-toc";

/** 本文を loader と同じ順（目次 → 降格）で整え、html 断片として返す */
function body(html: string) {
  const { html: withIds, toc } = buildTableOfContents(html);
  return { content: demoteGuideHeadings(withIds), toc };
}

const embed = (index: number, titles: string[], name = "名前"): TocSegment => ({
  kind: "embed",
  index,
  name,
  groups: titles.map((title) => ({ timing: title.toLowerCase(), title })),
});

describe("mergeEmbedGroupsIntoToc", () => {
  it("見出しつきの埋め込みが無ければ本文の目次のまま", () => {
    const { content, toc } = body("<h1>A</h1><p>x</p>");
    expect(mergeEmbedGroupsIntoToc([{ kind: "html", content }, embed(0, [])], toc)).toBe(toc);
  });

  it("文書順に、直前の見出しの1つ下の段で差し込む", () => {
    const { content, toc } = body("<h1>A</h1>");
    const { content: c2, toc: t2 } = body("<h1>A</h1><h1>B</h1>");
    expect(c2).toContain("heading-2");
    const first = mergeEmbedGroupsIntoToc([{ kind: "html", content }, embed(0, ["OW", "Bastion"])], toc);
    expect(first.map((i) => [i.text, i.level])).toEqual([["A", 1], ["OW", 2], ["Bastion", 2]]);
    // 2つの見出しの間に置いた埋め込みは A の後・B の前
    const cut = c2.indexOf("<h2", c2.indexOf("<h2") + 1);
    const merged = mergeEmbedGroupsIntoToc(
      [
        { kind: "html", content: c2.slice(0, cut) },
        embed(0, ["OW"]),
        { kind: "html", content: c2.slice(cut) },
      ],
      t2,
    );
    expect(merged.map((i) => i.text)).toEqual(["A", "OW", "B"]);
  });

  it("元のレベル 3 の見出しの下は目次の最大段を超えるので載せない", () => {
    const { content, toc } = body("<h3>深い</h3>");
    expect(mergeEmbedGroupsIntoToc([{ kind: "html", content }, embed(0, ["OW"])], toc)).toEqual(toc);
  });

  it("前に見出しが無ければ本文の最小レベルの1つ下（見出しが全く無ければ 2）", () => {
    const { content, toc } = body("<h1>後ろの見出し</h1>");
    const merged = mergeEmbedGroupsIntoToc([embed(0, ["OW"]), { kind: "html", content }], toc);
    expect(merged.map((i) => [i.text, i.level])).toEqual([["OW", 2], ["後ろの見出し", 1]]);
    expect(mergeEmbedGroupsIntoToc([embed(0, ["OW"])], []).map((i) => i.level)).toEqual([2]);
  });

  it("同じ節に埋め込みが複数あるときは名前で区別し、id は埋め込みごとに一意", () => {
    const { content, toc } = body("<h1>A</h1>");
    const merged = mergeEmbedGroupsIntoToc(
      [{ kind: "html", content }, embed(0, ["OW"], "甲"), embed(1, ["OW"], "乙")],
      toc,
    );
    expect(merged.map((i) => i.text)).toEqual(["A", "OW — 甲", "OW — 乙"]);
    expect(new Set(merged.map((i) => i.id)).size).toBe(3);
    expect(merged[1].id).toBe(embedGroupHeadingId(0, "ow"));
  });

  it("本文の目次と断片の見出しが合わないときは本文の目次のまま", () => {
    const { toc } = body("<h1>A</h1>");
    expect(mergeEmbedGroupsIntoToc([{ kind: "html", content: "<p>無い</p>" }, embed(0, ["OW"])], toc)).toBe(toc);
  });
});
