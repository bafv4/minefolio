// DB 接続先（.env / .env.remote）の読み込みとガードの単一実装。
// scripts/ 配下の一回限りスクリプトと、drizzle 設定（drizzle.config.ts /
// drizzle.remote.config.ts）の両方がここを使う。
//
// 背景: 共有の .env をリモート接続情報に書き換えると、同時に動いている
// dev サーバーや別スクリプトまで巻き添えでリモート DB に接続してしまう。
// そのため .env は常にローカル（file:local.db）固定とし、リモート接続情報は
// .env.remote（gitignore 済み）に分離して、リモート指定のときだけ読み込む。
//
// スクリプトでの使い方（--remote フラグで .env.remote に切り替わる）:
//   import { loadDbEnv } from "./lib/db-env";
//   const { url, authToken } = loadDbEnv();
//   const client = createClient({ url, authToken });
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { isLocalDbUrl } from "../../app/lib/db-url";

export interface DbTarget {
  url: string;
  authToken: string | undefined;
}

export interface LoadDbEnvOptions {
  /** リモート（.env.remote）を読むか。省略時は process.argv の --remote フラグから判定 */
  remote?: boolean;
  /**
   * ローカル側で .env や TURSO_DATABASE_URL が無い場合に file:local.db へフォールバックする
   * （drizzle 設定用 — createDb() のフォールバックと揃える）。
   * スクリプトは既定で厳格（未設定はエラー）: 適用先が暗黙に決まるのを防ぐ。
   */
  fallbackLocal?: boolean;
}

/**
 * リモート指定に応じて .env.remote / .env を読み込み、接続先を返す。
 * 接続先の取り違えを防ぐため、ファイルと URL スキームの組み合わせを検証する:
 * - リモート → .env.remote 必須、URL は file: 以外（libsql:// 等）であること
 * - ローカル → URL は file: であること。リモート URL なら中断
 */
export function loadDbEnv(options: LoadDbEnvOptions = {}): DbTarget {
  const remote = options.remote ?? process.argv.includes("--remote");
  const envFile = remote ? ".env.remote" : ".env";
  const envPath = resolve(process.cwd(), envFile);

  if (existsSync(envPath)) {
    // override: シェルや既存の process.env に残った値より、指定ファイルの値を優先する
    config({ path: envPath, override: true, quiet: true });
  } else if (remote) {
    throw new Error(
      ".env.remote がありません。リモートの TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を .env.remote に記載してください。",
    );
  } else if (!options.fallbackLocal) {
    throw new Error(".env がありません（リポジトリ直下で実行してください）。");
  }

  let url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    if (remote || !options.fallbackLocal) {
      throw new Error(`TURSO_DATABASE_URL が未設定です（${envFile} を確認）`);
    }
    url = "file:local.db";
  }

  if (remote && isLocalDbUrl(url)) {
    throw new Error(
      ".env.remote の TURSO_DATABASE_URL がローカルファイルを指しています。リモート URL（libsql://...）を設定してください。",
    );
  }
  if (!remote && !isLocalDbUrl(url)) {
    throw new Error(
      ".env の TURSO_DATABASE_URL がリモートを指しています。.env は file:local.db 固定とし、リモートに適用する場合は接続情報を .env.remote に移して --remote（drizzle-kit は pnpm db:push:remote）で実行してください。",
    );
  }

  console.log(
    remote
      ? `⚠️  接続先: ${url}（.env.remote / リモート）`
      : `接続先: ${url}（.env / ローカル）`,
  );

  return { url, authToken: process.env.TURSO_AUTH_TOKEN };
}
