# ISSUE-0017: Vercelデプロイ基盤を整備する

## 背景
QuizVerse は Docker Compose によるローカル開発基盤までは整備されている一方、Preview / Production 環境へのデプロイ設定が未整備だった。PR ごとの画面確認と main マージ後の継続的な公開を可能にするため、Vercel 向けの構成を追加する。

## 目的
- Vite frontend と Flask API を単一の Vercel プロジェクトで配信する。
- `/api/*` を Flask の Python Function にルーティングする。
- `/status` や `/admin/*` の直接アクセスを SPA で処理できるようにする。
- 本番用環境変数と DB マイグレーション手順を明文化する。

## 採用構成
- Static frontend: `frontend/dist`
- Python Function: `api/index.py`
- Flask application: `backend/app:create_app`
- Routing:
  - `/api/*` → `/api/index.py`
  - その他 → `/index.html`
- Database: 外部 PostgreSQL を `DATABASE_URL` で接続

## 仮置き仕様
- Vercel 内に PostgreSQL コンテナは配置しない。
- DB マイグレーションはデプロイ時に自動実行しない。
- Preview / Production の各環境へ同じキー名の環境変数を設定する。
- 本番環境では開発用認証・OTPコード返却を無効化する。

## 必須環境変数
- `DATABASE_URL`
- `SECRET_KEY`
- `JWT_SECRET_KEY`
- `AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false`
- `OTP_INCLUDE_CODE_IN_RESPONSE=false`

## 任意・機能別環境変数
- `GOOGLE_OAUTH_CLIENT_ID`
- `EMAIL_SETTINGS_ENCRYPTION_KEY`
- `SERVICE_MAINTENANCE_MODE`
- `SERVICE_MAINTENANCE_TITLE`
- `SERVICE_MAINTENANCE_MESSAGE`
- `SERVICE_MAINTENANCE_SCHEDULED_UNTIL`
- OTP 関連の有効期限・レート制限設定

## 変更対象
- `api/index.py`
- `requirements.txt`
- `vercel.json`
- `.vercelignore`
- `backend/tests/test_vercel_deployment.py`
- `.env.example`
- `README.md`
- `docs/qiita/ISSUE-0017_vercel_deployment_foundation.md`

## 受け入れ条件
- Vercel で frontend build が完了する。
- `/api/health` が Python Function 経由で応答する。
- `/status` の直接アクセスで SPA が表示される。
- Vercel 設定の自動テストが通過する。
- 必須環境変数とリリース手順が文書化されている。

## セキュリティ・運用上の注意
- 秘密情報を `vercel.json` や GitHub に書かない。
- `DATABASE_URL` は Preview / Production ごとに分離することを推奨する。
- マイグレーションは本番 DB のバックアップと対象リビジョンを確認してから実行する。
- `AUTH_ENABLE_DEV_TOKEN_ENDPOINT` と `OTP_INCLUDE_CODE_IN_RESPONSE` は本番で必ず `false` にする。
