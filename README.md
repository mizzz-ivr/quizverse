# QuizVerse
クイズ作成・プレイ・ランキングを軸としたWebプラットフォーム。

## 技術スタック
- Frontend: React + Tailwind + Vite
- Backend: Flask + Flask-JWT-Extended + Flask-Migrate + SQLAlchemy
- DB: PostgreSQL
- Local Infra: Docker Compose
- Deployment: Vercel（Vite Static + Flask Python Function）

## クイックスタート
1. `.env.example` をコピーして `.env` を作成
2. 起動
   ```bash
   docker compose up --build
   ```
3. backendヘルスチェック
   - `http://localhost:5000/api/health`
4. frontend
   - `http://localhost:5173`

## Vercel デプロイ
QuizVerse は単一の Vercel プロジェクトで frontend と backend を配信します。

- Vite build output: `frontend/dist`
- Flask Function entrypoint: `api/index.py`
- `/api/*`: Flask Function へ rewrite
- その他のパス: SPA の `index.html` へ rewrite
- DB: 外部 PostgreSQL を `DATABASE_URL` で接続

### Vercel Project Settings
1. GitHub リポジトリ `mizzz-ivr/quizverse` を Vercel に Import
2. Root Directory はリポジトリルートのままにする
3. Framework Preset は `Other` または自動判定を利用
4. `vercel.json` の install/build/output 設定を利用
5. Preview / Production の環境変数を登録

### 必須環境変数
- `DATABASE_URL`
- `SECRET_KEY`
- `JWT_SECRET_KEY`
- `AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false`
- `OTP_INCLUDE_CODE_IN_RESPONSE=false`

### 機能別環境変数
- `GOOGLE_OAUTH_CLIENT_ID`
- `EMAIL_SETTINGS_ENCRYPTION_KEY`
- `SERVICE_MAINTENANCE_MODE`
- `SERVICE_MAINTENANCE_TITLE`
- `SERVICE_MAINTENANCE_MESSAGE`
- `SERVICE_MAINTENANCE_SCHEDULED_UNTIL`
- OTP 関連設定（有効期限・再送間隔・試行上限）

### デプロイ後の確認
- `/`
- `/login`
- `/quizzes`
- `/quizzes/new`
- `/rankings`
- `/api/health`
- `/api/status`
- `/status`
- `/admin`

### DBマイグレーション
Vercel Function 起動時には自動マイグレーションを実行しません。外部 PostgreSQL のバックアップと対象リビジョンを確認したうえで、明示的に実行してください。

```bash
cd backend
DATABASE_URL='<production database url>' flask --app app db upgrade
```

## DBマイグレーション
```bash
cd backend
flask --app app db upgrade
```

モデル変更時:
```bash
cd backend
flask --app app db migrate -m "describe change"
flask --app app db upgrade
```

## テスト
バックエンド:

```bash
cd backend && PYTHONPATH=. pytest
```

フロントエンド回帰テスト:

```bash
npm --prefix frontend test
```

Vercel 設定のみ確認する場合:

```bash
cd backend && PYTHONPATH=. pytest tests/test_vercel_deployment.py
```

フロントエンドのProduction Build:

```bash
npm --prefix frontend install
npm --prefix frontend run build
```

## 一般ユーザー向けフロントエンド（ISSUE-0018, ISSUE-0024）
既存APIへ接続した一般向けMVP画面を実装しています。

- `/`: ホーム・注目クイズ・ランキングプレビュー
- `/signup`: メールアドレスとパスワードによる新規登録
- `/login`: ログイン
- `/quizzes`: 一覧・キーワード検索・カテゴリ絞り込み・ページング
- `/quizzes/new`: ログイン済みユーザー向けクイズ作成
- `/quizzes/{quiz_id}`: 詳細・回答・採点結果
- `/rankings`: 総合ランキング
- `/quizzes/{quiz_id}/rankings`: クイズ別ランキング

クイズ作成画面では、タイトル・説明・カテゴリ、1〜50問、各問題2〜6択、正答1件を入力し、JWT付きで `POST /api/quizzes` へ送信します。作成結果は既存API仕様に従って `draft` になり、成功後はクイズ詳細へ遷移します。

MVPの認証情報は次のキーで `localStorage` に保存します。

- `quizverse_access_token`
- `quizverse_user`

起動時に `GET /api/auth/me` でトークンを確認し、401応答時は保存済み認証情報を削除します。HttpOnly Cookie / refresh tokenへの移行は今後の課題です。

## 認証API（ISSUE-0004, ISSUE-0005, ISSUE-0006, ISSUE-0007）
- JWT設定は環境変数で管理します（例: `JWT_SECRET_KEY`, `JWT_ACCESS_TOKEN_EXPIRES_SECONDS`, `AUTH_ENABLE_DEV_TOKEN_ENDPOINT`）。
- OTP設定は環境変数で管理します（例: `OTP_EXPIRES_SECONDS`, `OTP_MIN_RESEND_SECONDS`, `OTP_MAX_REQUESTS_PER_HOUR`, `OTP_MAX_VERIFY_ATTEMPTS`）。
- Google OAuth ログインを利用する場合は `GOOGLE_OAUTH_CLIENT_ID` を設定してください。
- メール設定暗号化キーは `EMAIL_SETTINGS_ENCRYPTION_KEY` で指定できます。未指定時は `SECRET_KEY` から導出した鍵を仮利用します。
- 本実装済みエンドポイント
  - `POST /api/quizzes`: JWT必須。クイズ本体 + 問題 + 選択肢を一括作成（MVP: 4択等の選択式、各問題2〜6択、正答は1つ）
  - `GET /api/quizzes`: クイズ一覧を取得（`q` キーワード検索, `category` 完全一致, `page`/`per_page` ページング）
  - `GET /api/quizzes/{quiz_id}`: クイズ詳細を取得（問題・選択肢を返却、正答は返さない）
  - `POST /api/quizzes/{quiz_id}/play`: JWT必須。回答送信・採点・プレイ履歴保存（`quiz_plays`/`quiz_play_answers`）
  - `GET /api/quizzes/{quiz_id}/rankings`: クイズ単位ランキング（ユーザーごとのベストプレイ採用、同点時は score/correct_count/played_at/play_id で決定）
  - `GET /api/rankings`: 総合ランキング（ユーザー×クイズのベストスコアを合算、ページング対応）
  - `GET /api/admin/overview`: 管理ダッシュボード向けサマリー（ユーザー数 / クイズ数 / プレイ数 / サービス状況）
  - `GET /api/admin/users`: 管理向けユーザー一覧（emailはマスクした値のみ返却）
  - `GET /api/admin/quizzes`: 管理向けクイズ一覧（作成者・ステータス・プレイ数）
  - `GET /api/admin/email-settings`: 管理向けメール設定取得（機密値はマスクのみ返却、`X-Admin-Mode: true` が必要）
  - `PUT /api/admin/email-settings`: 管理向けメール設定保存（SMTPパスワードは更新時のみ受け取り）
  - `GET /api/status`: 一般公開向けサービスステータス（アプリ/API/DB/認証/メール/メンテナンス）
  - `GET /api/admin/status`: 管理向け詳細ステータス（仮置き管理判定: `X-Admin-Mode: true`）
  - `POST /api/auth/register`: メールアドレス・パスワードで新規登録しJWTを発行
  - `POST /api/auth/login`: メールアドレス・パスワードでJWTを発行
  - `POST /api/auth/google`: Google ID token を検証し、OAuthログインでJWTを発行
  - `POST /api/auth/otp/request`: OTPコードを発行・保存し、メール送信基盤で送信（MVPではemailのみ対応）
  - `POST /api/auth/otp/verify`: destination / purpose に紐づくOTPコードを検証し、成功時に使用済み化
  - `GET /api/auth/me`: JWTからログイン中ユーザーの基本情報を返却
- 開発補助エンドポイント
  - `POST /api/auth/dev-token`: 開発/検証専用の仮トークン発行（`AUTH_ENABLE_DEV_TOKEN_ENDPOINT=true` の場合のみ）
- 検証用保護ルート
  - `GET /api/auth/protected`: JWT必須の保護エンドポイント
- `AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false` を本番で明示設定し、`dev-token` を無効化してください。
- `channel=phone` は将来拡張用のインターフェースのみで、MVPでは `auth/otp_channel_not_implemented` を返します。

## ドキュメント
- ロードマップ: `docs/roadmap.md`
- Issue: `docs/issues/ISSUE-0001.md`
- Issue: `docs/issues/ISSUE-0002.md`
- Issue: `docs/issues/ISSUE-0003.md`
- Issue: `docs/issues/ISSUE-0004.md`
- Issue: `docs/issues/ISSUE-0005.md`
- Issue: `docs/issues/ISSUE-0006.md`
- Issue: `docs/issues/ISSUE-0007.md`
- Issue: `docs/issues/ISSUE-0008.md`
- Issue: `docs/issues/ISSUE-0009.md`
- Issue: `docs/issues/ISSUE-0010.md`
- Issue: `docs/issues/ISSUE-0011.md`
- Issue: `docs/issues/ISSUE-0014.md`
- Issue: `docs/issues/ISSUE-0015.md`
- Issue: `docs/issues/ISSUE-0016.md`
- Issue: `docs/issues/ISSUE-0017.md`
- Issue: `docs/issues/ISSUE-0018.md`
- Issue: `docs/issues/ISSUE-0020.md`
- Issue: `docs/issues/ISSUE-0024.md`
- スキーマ定義: `docs/schema/mvp_core_tables.md`
- Qiita下書き: `docs/qiita/ISSUE-0001_mvp_infra_bootstrap.md`
- Qiita下書き: `docs/qiita/ISSUE-0002_flask_migrate_foundation.md`
- Qiita下書き: `docs/qiita/ISSUE-0003_mvp_db_design.md`
- Qiita下書き: `docs/qiita/ISSUE-0004_jwt_auth_foundation.md`
- Qiita下書き: `docs/qiita/ISSUE-0005_email_register_login.md`
- Qiita下書き: `docs/qiita/ISSUE-0006_google_oauth_login.md`
- Qiita下書き: `docs/qiita/ISSUE-0007_otp_verification_foundation.md`
- Qiita下書き: `docs/qiita/ISSUE-0008_quiz_create_api.md`
- Qiita下書き: `docs/qiita/ISSUE-0009_quiz_list_search_detail_api.md`
- Qiita下書き: `docs/qiita/ISSUE-0010_quiz_play_scoring_api.md`
- Qiita下書き: `docs/qiita/ISSUE-0011_ranking_api.md`
- Qiita下書き: `docs/qiita/ISSUE-0014_admin_dashboard_foundation.md`
- Qiita下書き: `docs/qiita/ISSUE-0015_email_settings_ui_and_smtp_api.md`
- Qiita下書き: `docs/qiita/ISSUE-0016_service_status_page_and_ops_visibility.md`
- Qiita下書き: `docs/qiita/ISSUE-0017_vercel_deployment_foundation.md`
- Qiita下書き: `docs/qiita/ISSUE-0018_public_quiz_experience_ui.md`
- Qiita下書き: `docs/qiita/ISSUE-0024_quiz_create_ui.md`

## フロントエンド（管理ダッシュボード / ISSUE-0014）
- `/admin` 配下に管理ダッシュボード基盤を追加しました。
- 仮置きの admin 判定として `localStorage["quizverse_is_admin"]` を利用します。
- 初回アクセス時は一般ユーザー扱いのため、画面内トグルで管理者モードへ切り替えて確認してください。
- MVPとして、ローディング（skeleton）/ 空状態 / エラー状態を基本実装しています。

## フロントエンド（サービス状況表示 / ISSUE-0016）
- 公開向けステータスページを `/status` として実装。
- ステータスカードで `正常 / 注意 / 障害 / メンテナンス中` を色分け表示。
- skeleton loading / 空状態 / エラー状態 / 更新時刻表示を実装。

## フロントエンド（メール設定 / ISSUE-0015）
- 管理画面のメール設定ルートを `/admin/settings/email` として実装。
- SMTP設定は管理APIと連携し、ローディング・保存成功・エラー表示を行う。
- SMTPパスワードは取得時に平文を返さず、変更時のみ送信する。
- 管理APIの権限判定は **仮置き** として `X-Admin-Mode: true` を利用。
