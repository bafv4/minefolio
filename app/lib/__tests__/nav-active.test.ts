import { describe, it, expect } from "vitest";
import { findActiveNavHref } from "../nav-active";

const hrefs = ["/browse", "/keybindings", "/rankings", "/guides"];

describe("findActiveNavHref", () => {
  it("完全一致", () => {
    expect(findActiveNavHref("/guides", hrefs)).toBe("/guides");
  });
  it("サブルートでも親が現在地", () => {
    expect(findActiveNavHref("/guides/bfmkn/some-guide", hrefs)).toBe("/guides");
    expect(findActiveNavHref("/guides/templates/xxx", hrefs)).toBe("/guides");
  });
  it("接頭辞だけ同じ別パスは一致しない", () => {
    expect(findActiveNavHref("/guides-foo", hrefs)).toBeNull();
  });
  it("ホームは完全一致のみ", () => {
    expect(findActiveNavHref("/", ["/", "/guides"])).toBe("/");
    expect(findActiveNavHref("/guides", ["/", "/guides"])).toBe("/guides");
    expect(findActiveNavHref("/other", ["/", "/guides"])).toBeNull();
  });
  it("複数一致は最長だけ", () => {
    expect(findActiveNavHref("/guides/templates/x", ["/guides", "/guides/templates"])).toBe(
      "/guides/templates",
    );
  });
});
