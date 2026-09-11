import { describe, it, expect } from "vitest";
import {
  parseVercelBlobUrl,
  isVercelBlobUrl,
  blobUrlToPathname,
  collectBlobPathnames,
} from "../blob-url";

describe("parseVercelBlobUrl", () => {
  it("accepts a real Vercel Blob public URL (store subdomain)", () => {
    const url =
      "https://xoyxpvz1ekgqx8xy.public.blob.vercel-storage.com/skins/user123/skin.png";
    expect(parseVercelBlobUrl(url)).toBe(url);
    expect(isVercelBlobUrl(url)).toBe(true);
  });

  it("accepts the apex Vercel Blob host exactly", () => {
    const url = "https://blob.vercel-storage.com/skins/x.png";
    expect(isVercelBlobUrl(url)).toBe(true);
  });

  it("rejects nullish / empty input", () => {
    expect(parseVercelBlobUrl(null)).toBeNull();
    expect(parseVercelBlobUrl(undefined)).toBeNull();
    expect(parseVercelBlobUrl("")).toBeNull();
    expect(isVercelBlobUrl(null)).toBe(false);
  });

  it("rejects the #fragment substring bypass (SSRF to link-local metadata)", () => {
    // Old includes() check passed this; the fragment is not part of the hostname.
    const url =
      "https://169.254.169.254/latest/meta-data/#blob.vercel-storage.com";
    expect(parseVercelBlobUrl(url)).toBeNull();
    expect(isVercelBlobUrl(url)).toBe(false);
  });

  it("rejects the query-string substring bypass", () => {
    expect(
      isVercelBlobUrl("https://evil.example.com/?x=blob.vercel-storage.com")
    ).toBe(false);
  });

  it("rejects the userinfo (@) substring bypass", () => {
    // Host is evil.com; the credentials segment merely looks trusted.
    expect(
      isVercelBlobUrl("https://blob.vercel-storage.com@evil.com/skin.png")
    ).toBe(false);
  });

  it("rejects a look-alike suffix domain", () => {
    expect(
      isVercelBlobUrl("https://blob.vercel-storage.com.evil.com/skin.png")
    ).toBe(false);
    expect(isVercelBlobUrl("https://notblob.vercel-storage.com/x")).toBe(false);
  });

  it("rejects non-https protocols", () => {
    expect(
      isVercelBlobUrl("http://xxx.public.blob.vercel-storage.com/skin.png")
    ).toBe(false);
    expect(
      isVercelBlobUrl("file:///xxx.public.blob.vercel-storage.com")
    ).toBe(false);
  });

  it("rejects private / link-local IP literal hosts", () => {
    expect(isVercelBlobUrl("https://169.254.169.254/latest/meta-data/")).toBe(
      false
    );
    expect(isVercelBlobUrl("https://127.0.0.1/skin.png")).toBe(false);
    expect(isVercelBlobUrl("https://10.0.0.1/skin.png")).toBe(false);
    expect(isVercelBlobUrl("https://[::1]/skin.png")).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(parseVercelBlobUrl("not a url")).toBeNull();
    expect(parseVercelBlobUrl("://missing-scheme")).toBeNull();
  });
});

describe("blobUrlToPathname", () => {
  it("strips the leading slash and decodes the pathname", () => {
    expect(
      blobUrlToPathname("https://xxx.public.blob.vercel-storage.com/skins/user123/skin.png")
    ).toBe("skins/user123/skin.png");
  });

  it("decodes percent-encoded characters (e.g. spaces)", () => {
    expect(
      blobUrlToPathname(
        "https://xxx.public.blob.vercel-storage.com/guides/u1/g1/images/my%20image.png"
      )
    ).toBe("guides/u1/g1/images/my image.png");
  });

  it("returns null for unparseable input", () => {
    expect(blobUrlToPathname("not a url")).toBeNull();
    expect(blobUrlToPathname("://missing-scheme")).toBeNull();
  });
});

describe("collectBlobPathnames", () => {
  it("extracts multiple Blob URLs from HTML-like text", () => {
    const html =
      '<p><img src="https://xxx.public.blob.vercel-storage.com/guides/u1/g1/images/a.png"></p>' +
      '<p><img src="https://xxx.public.blob.vercel-storage.com/guides/u1/g1/images/b.png"></p>';
    const result = collectBlobPathnames([html]);
    expect(result).toEqual(
      new Set(["guides/u1/g1/images/a.png", "guides/u1/g1/images/b.png"])
    );
  });

  it("excludes non-Blob hosts embedded in the same text", () => {
    const html =
      '<img src="https://example.com/not-a-blob.png">' +
      '<img src="https://xxx.public.blob.vercel-storage.com/skins/u1/skin.png">';
    const result = collectBlobPathnames([html]);
    expect(result).toEqual(new Set(["skins/u1/skin.png"]));
  });

  it("ignores null/undefined entries", () => {
    const result = collectBlobPathnames([
      null,
      undefined,
      "https://xxx.public.blob.vercel-storage.com/skins/u1/skin.png",
    ]);
    expect(result).toEqual(new Set(["skins/u1/skin.png"]));
  });

  it("deduplicates repeated URLs across multiple inputs", () => {
    const url = "https://xxx.public.blob.vercel-storage.com/guides/u1/g1/cover-abc.png";
    const result = collectBlobPathnames([url, `<img src="${url}">`, url]);
    expect(result).toEqual(new Set(["guides/u1/g1/cover-abc.png"]));
  });

  it("returns an empty set when nothing matches", () => {
    expect(collectBlobPathnames([])).toEqual(new Set());
    expect(collectBlobPathnames(["no urls here", null])).toEqual(new Set());
  });
});
