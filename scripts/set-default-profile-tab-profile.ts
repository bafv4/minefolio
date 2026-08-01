// 既存ユーザーの default_profile_tab（プロフィールの初期表示タブ）を 'profile' へ揃える一回限りのスクリプト。
//
// 背景: 旧仕様では列デフォルトが 'keybindings' で、/me/edit を保存すると未変更でも
// 'keybindings' が明示保存されるため、「意図的な選択」と「暗黙デフォルト」を区別できない。
// 初期表示をプロフィールタブへ変更する方針（2026-08-01 ユーザー決定: 既存保存値も一括変更）に伴い、
// 'keybindings'・NULL・廃止済み enum 値 'settings' の行を 'profile' に更新する。
// それ以外（stats / devices / items / searchcraft / playstyle）は意図的な選択とみなし残す。
//
// 実行:
//   pnpm exec tsx scripts/set-default-profile-tab-profile.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/set-default-profile-tab-profile.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/set-default-profile-tab-profile.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/set-default-profile-tab-profile.ts --remote --apply  # リモートに適用
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`接続先: ${url}`);
console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

const WHERE = `default_profile_tab = 'keybindings' OR default_profile_tab IS NULL OR default_profile_tab = 'settings'`;

const before = await client.execute(
  `SELECT default_profile_tab AS tab, COUNT(*) AS n FROM users GROUP BY default_profile_tab ORDER BY n DESC;`,
);
console.log("現在の分布:", JSON.stringify(before.rows));

const target = await client.execute(`SELECT COUNT(*) AS n FROM users WHERE ${WHERE};`);
console.log(`更新対象（keybindings / NULL / settings）: ${target.rows[0].n} 行`);

if (!apply) {
  console.log("ℹ️  dry-run のため変更していません（--apply 付きで実行すると適用します）。");
  process.exit(0);
}

await client.execute(`UPDATE users SET default_profile_tab = 'profile' WHERE ${WHERE};`);

const verify = await client.execute(`SELECT COUNT(*) AS n FROM users WHERE ${WHERE};`);
if (Number(verify.rows[0].n) !== 0) {
  console.error(`❌ 適用後も対象行が ${verify.rows[0].n} 行残っています。`);
  process.exit(1);
}

console.log("✅ 適用完了。");
process.exit(0);
