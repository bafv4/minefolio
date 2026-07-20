// scripts/ 配下の一回限り DB スクリプト共通の環境変数ローダー。
//
// 背景: 共有の .env をリモート接続情報に書き換えると、同時に動いている
// dev サーバーや別スクリプトまで巻き添えでリモート DB に接続してしまう。
// そのため .env は常にローカル（file:local.db）固定とし、リモート接続情報は
// .env.remote（gitignore 済み）に分離して、--remote フラグ付きのときだけ読み込む。
//
// 使い方（各スクリプトの冒頭で）:
//   import { loadDbEnv } from "./lib/db-env";
//   const { url, authToken } = loadDbEnv();
//   const client = createClient({ url, authToken });
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

export interface DbTarget {
  url: string;
  authToken: string | undefined;
  /** --remote フラグで .env.remote を読み込んだかどうか */
  remote: boolean;
}

/**
 * --remote フラグの有無に応じて .env.remote / .env を読み込み、接続先を返す。
 * 接続先の取り違えを防ぐため、ファイルと URL スキームの組み合わせを検証する:
 * - --remote あり → .env.remote 必須、URL は file: 以外（libsql:// 等）であること
 * - --remote なし → URL は file:（ローカル）であること。リモート URL なら中断
 */
export function loadDbEnv(): DbTarget {
  const remote = process.argv.includes("--remote");
  const envFile = remote ? ".env.remote" : ".env";
  const envPath = resolve(process.cwd(), envFile);

  if (!existsSync(envPath)) {
    throw new Error(
      remote
        ? ".env.remote がありません。リモートの TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を .env.remote に記載してください。"
        : ".env がありません（リポジトリ直下で実行してください）。",
    );
  }

  // override: シェルや既存の process.env に残った値より、指定ファイルの値を優先する
  config({ path: envPath, override: true, quiet: true });

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(`TURSO_DATABASE_URL が未設定です（${envFile} を確認）`);
  }

  const isLocalFile = url.startsWith("file:");
  if (remote && isLocalFile) {
    throw new Error(
      ".env.remote の TURSO_DATABASE_URL がローカルファイルを指しています。リモート URL（libsql://...）を設定してください。",
    );
  }
  if (!remote && !isLocalFile) {
    throw new Error(
      ".env の TURSO_DATABASE_URL がリモートを指しています。.env は file:local.db 固定とし、リモートに適用する場合は接続情報を .env.remote に移して --remote を付けて実行してください。",
    );
  }

  console.log(`接続先: ${url}（${envFile}${remote ? " / リモート" : " / ローカル"}）`);

  return { url, authToken: process.env.TURSO_AUTH_TOKEN, remote };
}
