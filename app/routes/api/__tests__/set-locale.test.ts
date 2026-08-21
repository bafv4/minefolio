// /api/set-locale のオープンリダイレクトガードと Cookie 発行の回帰テスト。
//
// このルートは「Referer に書かれた場所へ戻す」ため、素直に実装すると
// 外部サイトへ 302 を出せてしまう（オープンリダイレクト）。実装は
//   1. Referer のオリジンがリクエストと一致するときだけ採用する
//   2. 採用時も pathname + search + hash しか使わない（オリジン部を捨てる）
// の2段で防いでいるので、どちらが欠けても落ちるようにケースを並べる。
//
// DB もセッションも使わないルートなので、Request を直接組んで action を呼ぶ。
import { describe, it, expect } from "vitest";
import { LOCALE_COOKIE } from "@/lib/locale";
import { action } from "../set-locale";

const ROUTE_URL = "https://minefolio.app/api/set-locale";

function makeRequest(locale: string | null, referer?: string): Request {
  const formData = new FormData();
  if (locale !== null) formData.set("locale", locale);

  const headers = new Headers();
  if (referer !== undefined) headers.set("Referer", referer);

  return new Request(ROUTE_URL, { method: "POST", body: formData, headers });
}

async function callAction(locale: string | null, referer?: string): Promise<Response> {
  return action({ request: makeRequest(locale, referer) });
}

describe("オープンリダイレクトガード", () => {
  it("クロスオリジンの Referer は捨てて '/' へ戻す", async () => {
    const res = await callAction("en", "https://evil.example/path");

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("ホスト名が接頭辞一致するだけの別ドメインも '/' へ戻す", async () => {
    const res = await callAction("en", "https://minefolio.app.evil.example/player/runner");

    expect(res.headers.get("Location")).toBe("/");
  });

  it("同一ホストでもスキームが違えば別オリジンとして '/' へ戻す", async () => {
    const res = await callAction("en", "http://minefolio.app/browse");

    expect(res.headers.get("Location")).toBe("/");
  });

  it("同一ホストでもポートが違えば別オリジンとして '/' へ戻す", async () => {
    const res = await callAction("en", "https://minefolio.app:8443/browse");

    expect(res.headers.get("Location")).toBe("/");
  });

  it("同一オリジンなら pathname + search + hash だけを採用する（オリジン部を含まない）", async () => {
    const res = await callAction("en", "https://minefolio.app/player/runner?tab=records#top");

    const location = res.headers.get("Location");
    expect(location).toBe("/player/runner?tab=records#top");
    expect(location).not.toContain("minefolio.app");
    expect(location?.startsWith("/")).toBe(true);
  });

  it("同一オリジンでも userinfo 付きの Referer は採用しない（別オリジン扱い）", async () => {
    const res = await callAction("en", "https://minefolio.app@evil.example/path");

    expect(res.headers.get("Location")).toBe("/");
  });

  it("パース不能な Referer は '/' へ戻す", async () => {
    const res = await callAction("en", "not a url");

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("スキーム相対（//evil.example/path）の Referer も '/' へ戻す", async () => {
    const res = await callAction("en", "//evil.example/path");

    expect(res.headers.get("Location")).toBe("/");
  });

  it("Referer ヘッダーが無い場合は '/' へ戻す", async () => {
    const res = await callAction("en");

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });
});

describe("locale の検証と Cookie 発行", () => {
  it.each([["ja"], ["en"]])("有効な locale（%s）は 302 + Set-Cookie を返す", async (locale) => {
    const res = await callAction(locale);

    expect(res.status).toBe(302);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${LOCALE_COOKIE}=${locale}`);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it.each([
    ["未対応の言語コード", "fr"],
    ["空文字", ""],
    ["locale 欠落", null],
  ])("%s は 400 で Set-Cookie を付けない", async (_label, locale) => {
    const res = await callAction(locale);

    expect(res.status).toBe(400);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(await res.json()).toEqual({ error: "Invalid locale" });
  });

  it("不正な locale では同一オリジン Referer があってもリダイレクトしない", async () => {
    const res = await callAction("fr", "https://minefolio.app/browse");

    expect(res.status).toBe(400);
    expect(res.headers.get("Location")).toBeNull();
  });
});
