import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isBotProbePath } from "../bot-probe";

describe("isBotProbePath", () => {
  it.each([
    "/wp-login.php",
    "/wp-admin/setup-config.php",
    "/wp-content/plugins/x/y.js",
    "/wordpress/wp-login.php",
    "/xmlrpc.php",
    "/.env",
    "/.env.local",
    "/app/.env",
    "/.git/config",
    "/.aws/credentials",
    "/cgi-bin/luci",
    "/phpmyadmin/index.php",
    "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php",
    "/backup.sql",
    "/db.bak",
    "/config.ini",
    "/admin/login.aspx",
    "/shell.jsp",
    "/WP-LOGIN.PHP",
    "/xmlrpc.php.data",
  ])("探りとして判定する: %s", (p) => {
    expect(isBotProbePath(p)).toBe(true);
  });

  it.each([
    "/",
    "/login",
    "/playerz/foo",
    "/player/Notch",
    "/player/Notch/stats",
    "/guides/alice/my-first-guide",
    "/me/edit",
    "/keybindings/visual",
    "/developers/changelog",
    "/api/auth/callback/discord",
    "/api/cron/update-rankings",
    "/api/.env",
    "/og-image",
    "/__manifest",
    "/_root.data",
    "/paces.data",
    "/.well-known/security.txt",
    "/favicon.ico",
    "/icon.png",
    "/mcitems/1.16.1/items/minecraft_diamond.png",
    "/fonts/foo.ttf",
    "/skins/abc.png",
    "/wps/foo",
    "/vendors",
    "/wpad",
  ])("正規のパスは判定しない: %s", (p) => {
    expect(isBotProbePath(p)).toBe(false);
  });

  it("public 直下の実在ファイル・ディレクトリは判定しない", () => {
    for (const name of readdirSync(join(process.cwd(), "public"))) {
      expect(isBotProbePath(`/${name}`)).toBe(false);
    }
  });
});
