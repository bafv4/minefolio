# Cron設定ガイド

## PaceManキャッシュ自動更新

PaceManのペース情報を定期的にキャッシュするために、Vercel Cronを使用しています。

## 設定方法

### 1. vercel.jsonの設定

プロジェクトルートの`vercel.json`に以下のCron設定が含まれています：

```json
{
  "crons": [
    {
      "path": "/api/cron/update-paceman-cache",
      "schedule": "*/30 * * * *"
    }
  ]
}
```

**スケジュール**: `*/30 * * * *` = 30分ごとに実行

### 2. 環境変数の設定

Vercelダッシュボードで以下の環境変数を設定してください：

- `CRON_SECRET`: Cron認証用のシークレットトークン（推奨）

#### 設定手順

1. Vercelダッシュボードにアクセス
2. プロジェクトを選択
3. Settings → Environment Variables
4. `CRON_SECRET`を追加（強力なランダム文字列を使用）

### 3. デプロイ

環境変数を設定後、プロジェクトを再デプロイしてください：

```bash
vercel --prod
```

または、GitHubにプッシュして自動デプロイを実行します。

## Cronの動作

### 実行内容

1. **ユーザー取得**: MCIDを持つすべてのユーザーを取得
2. **データ取得**: PaceMan APIから過去1週間のペース情報を取得
3. **キャッシュ保存**: DBの`paceman_paces`テーブルに保存
4. **古いデータ削除**: 1週間より古いデータを自動削除

### 実行頻度

- **間隔**: 30分ごと
- **取得期間**: 過去1週間（168時間）
- **最低プレイ回数**: 5回
- **最大取得件数**: 100件

## トラブルシューティング

### Cronが実行されない

1. Vercelダッシュボードで「Deployments」→「Functions」タブを確認
2. Cron実行ログを確認（Vercel CLI: `vercel logs`）
3. 環境変数`CRON_SECRET`が正しく設定されているか確認

### 手動テスト

開発環境でエンドポイントを手動で呼び出すことができます：

```bash
# CRON_SECRETなしでテスト（開発環境）
curl http://localhost:5173/api/cron/update-paceman-cache

# CRON_SECRETありでテスト（本番環境）
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://minefolio.pages.dev/api/cron/update-paceman-cache
```

## セキュリティ

- `CRON_SECRET`環境変数を設定することで、不正なアクセスを防止
- Vercel Cronは自動的に`Authorization`ヘッダーにシークレットを設定
- 環境変数が設定されていない場合は認証をスキップ（開発環境用）

## 関連ファイル

- `/app/routes/api/cron/update-paceman-cache.ts` - Cronエンドポイント
- `/app/lib/paceman-cache.ts` - キャッシュ管理ロジック
- `/app/lib/schema.ts` - `paceman_paces`テーブル定義
- `/vercel.json` - Vercel Cron設定
