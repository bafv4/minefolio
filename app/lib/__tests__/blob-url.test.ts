import { describe, it, expect } from "vitest";
import { parseVercelBlobUrl, isVercelBlobUrl } from "../blob-url";

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
