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
- `JWT_COOKIE_SECURE=true`
- `AUTH_EXPOSE_TOKEN_IN_RESPONSE=false`
- `AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false`
- `OTP_INCLUDE_CODE_IN_RESPONSE=false`
- `QUIZ_PUBLICATION_ENFORCED=true`

### 機能別環境変数
- `JWT_ACCESS_TOKEN_EXPIRES_SECONDS`
- `JWT_REFRESH_TOKEN_EXPIRES_SECONDS`
- `JWT_TOKEN_LOCATION`
- `JWT_COOKIE_SAMESITE`
- `JWT_COOKIE_DOMAIN`
- `ADMIN_BOOTSTRAP_EMAILS`
- `GOOGLE_OAUTH_CLIENT_ID`
- `EMAIL_SETTINGS_ENCRYPTION_KEY`
- `SERVICE_MAINTENANCE_MODE`
- `SERVICE_MAINTENANCE_TITLE`
- `SERVICE_MAINTENANCE_MESSAGE`
- `SERVICE_MAINTENANCE_SCHEDULED_UNTIL`
- OTP 関連設定（有効期限・再送間隔・試行上限）

### 初期管理者の設定

管理者RBACの初回セットアップ時は、管理者にするユーザーのメールアドレスを設定します。

```env
ADMIN_BOOTSTRAP_EMAILS=admin@example.com
```

メールアドレスを入力しただけのパスワード登録は所有確認にならないため、設定値に一致しても管理者へ昇格しません。対象ユーザーは、Google ID tokenの`email_verified`確認を通過した同一メールアドレスのGoogle OAuthアカウントでログインしたうえで`/admin`へアクセスしてください。条件を満たすとDB上の`users.role`が`admin`へ昇格して保存されます。

昇格確認後は、必要に応じて`ADMIN_BOOTSTRAP_EMAILS`を空へ戻して再デプロイしてください。環境変数を削除しても保存済みロールは自動降格しません。Google OAuthを使わない環境では、運用担当者が対象ユーザーの本人確認を行ったうえで、DB上の`users.role`を明示的に`admin`へ変更します。

### デプロイ後の確認
- `/`
- `/login`
- `/quizzes`
- `/quizzes/new`
- `/my/quizzes`
- `/my/quizzes/{quiz_id}/edit`
- `/rankings`
- `/api/health`
- `/api/status`
- `/status`
- `/admin`
- `/api/admin/session`

### DBマイグレーション
Vercel Function 起動時には自動マイグレーションを実行しません。外部 PostgreSQL のバックアップと対象リビジョンを確認したうえで、明示的に実行してください。

```bash
cd backend
DATABASE_URL='<production database url>' flask --app app db upgrade
```

管理者RBACではrevision `20260804_0009`で`users.role`を追加します。新しいアプリを配信する前に、対象DBへこのmigrationを適用してください。

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

`backend/pytest.ini`では`sqlalchemy.exc.LegacyAPIWarning`をエラーとして扱います。`Query.get()`などのSQLAlchemy Legacy APIが再導入された場合は、バックエンドCIが失敗します。

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

## 一般ユーザー向けフロントエンド（ISSUE-0018, ISSUE-0024, ISSUE-0026, ISSUE-0028, ISSUE-0030, ISSUE-0032）
既存APIへ接続した一般向けMVP画面を実装しています。

- `/`: ホーム・注目クイズ・ランキングプレビュー
- `/signup`: メールアドレスとパスワードによる新規登録
- `/login`: ログイン
- `/quizzes`: 公開中クイズの一覧・キーワード検索・カテゴリ絞り込み・ページング
- `/quizzes/new`: ログイン済みユーザー向けクイズ作成
- `/my/quizzes`: 自分の下書き・公開中・アーカイブ済みクイズ管理
- `/my/quizzes/{quiz_id}/edit`: プレイ履歴のない本人所有下書きの編集
- `/quizzes/{quiz_id}`: 公開クイズの詳細・回答・採点結果、または作成者向け非公開プレビュー
- `/rankings`: 現在公開中クイズを対象とした総合ランキング
- `/quizzes/{quiz_id}/rankings`: 公開中クイズのクイズ別ランキング

クイズ作成画面では、タイトル・説明・カテゴリ、1〜50問、各問題2〜6択、正答1件を入力し、HttpOnly Cookie認証とCSRFヘッダー付きで `POST /api/quizzes` へ送信します。作成結果は `draft` となり、作成者は詳細画面でプレビューした後、マイクイズ画面から編集・公開できます。

### クイズ公開ライフサイクル

- `draft`: 作成者だけがプレビュー可能。一般一覧・回答・ランキング対象外
- `published`: 一般一覧・詳細・回答・ランキング対象
- `archived`: 公開終了。作成者だけがプレビュー・再公開可能

非公開クイズへ非作成者がアクセスした場合は、存在を推測させないため404を返します。公開状態の境界は `QUIZ_PUBLICATION_ENFORCED=true` で有効化し、本番では必ず `true` を設定してください。

下書き編集は作成者本人かつプレイ履歴が存在しないクイズだけに限定しています。公開中・アーカイブ済みクイズは直接編集できません。また、一度でもプレイ履歴が保存されたクイズは、過去の採点結果と問題構造の整合性を守るため、下書きへ戻しても編集できません。

### ブラウザ認証セッション

一般ユーザー向けWeb画面は、access tokenとrefresh tokenをHttpOnly Cookieで受け取ります。JWT本体はJavaScriptから参照せず、`localStorage`には画面表示用の`quizverse_user`だけを保存します。旧`quizverse_access_token`キーは起動・ログイン・ログアウト時に削除します。

- access token: 短命Cookie、通常の保護APIで利用
- refresh token: `/api/auth/refresh`専用Cookie
- CSRF: JavaScriptから読めるCSRF Cookieを状態変更リクエストの`X-CSRF-TOKEN`へ設定
- API通信: `credentials: same-origin`
- access token期限切れ: 同時401を1つのrefresh Promiseへ集約し、成功後に元のAPIを1回だけ再試行
- 複数タブ排他: refresh・logout・login・register・Google loginをWeb Locks APIの共通`exclusive`ロックで直列化
- Web Locks API非対応環境: 既存の同一タブPromise制御へフォールバック
- refresh失敗: 表示キャッシュを削除し、復帰先付きログイン画面へ遷移

`quizverse_session_hint`はJWTを含まないセッション候補のヒントです。認証済みかどうかの最終確認は`GET /api/auth/me`で行います。CLI・既存APIクライアント向けのAuthorizationヘッダーJWT互換は残しますが、一般ユーザー向けWeb画面からは送信しません。

## 管理者RBAC（ISSUE-0038）

管理画面と管理APIは、DB上の`users.role=admin`で保護します。ブラウザの`localStorage`や`X-Admin-Mode`は管理者判定に使用しません。

- 未認証: 401
- 一般ユーザー: 403
- `suspended` / `withdrawn`: 403
- `active`かつ`admin`: 利用可能
- 認可時はJWT claimだけでなくDB上の現在ロールと状態を確認
- 初期管理者の自動昇格は、設定メールと一致する確認済みGoogle OAuth連携を必須とする
- 管理画面はHttpOnly Cookie認証を利用
- SMTP設定更新などの状態変更はCSRF二重送信で保護
- ユーザー一覧はメールアドレスをマスクし、パスワードハッシュを返さない

管理API:

- `GET /api/admin/session`: 現在の管理者セッションを確認
- `GET /api/admin/overview`: 管理ダッシュボード集計
- `GET /api/admin/users`: ユーザー一覧
- `GET /api/admin/quizzes`: クイズ一覧
- `GET /api/admin/email-settings`: SMTP設定取得
- `PUT /api/admin/email-settings`: SMTP設定更新
- `GET /api/admin/status`: 内部サービスステータス

## 認証API（ISSUE-0004, ISSUE-0005, ISSUE-0006, ISSUE-0007, ISSUE-0030, ISSUE-0032, ISSUE-0034, ISSUE-0038）
- JWT設定は環境変数で管理します（例: `JWT_SECRET_KEY`, `JWT_ACCESS_TOKEN_EXPIRES_SECONDS`, `JWT_REFRESH_TOKEN_EXPIRES_SECONDS`, `JWT_COOKIE_SECURE`）。
- ブラウザはHttpOnly Cookie認証、状態変更APIはCSRF二重送信を利用します。
- OTP設定は環境変数で管理します（例: `OTP_EXPIRES_SECONDS`, `OTP_MIN_RESEND_SECONDS`, `OTP_MAX_REQUESTS_PER_HOUR`, `OTP_MAX_VERIFY_ATTEMPTS`）。
- Google OAuth ログインを利用する場合は `GOOGLE_OAUTH_CLIENT_ID` を設定してください。
- メール設定暗号化キーは `EMAIL_SETTINGS_ENCRYPTION_KEY` で指定できます。未指定時は `SECRET_KEY` から導出した鍵を仮利用します。
- 本実装済みエンドポイント
  - `POST /api/quizzes`: JWT必須。クイズ本体 + 問題 + 選択肢を下書きとして一括作成（各問題2〜6択、正答は1つ）
  - `GET /api/quizzes`: `published` のクイズ一覧を取得（`q` キーワード検索, `category` 完全一致, `page`/`per_page` ページング）
  - `GET /api/quizzes/{quiz_id}`: 公開クイズ詳細を取得。非公開時はJWTで作成者本人のみプレビュー可能（正答は返さない）
  - `POST /api/quizzes/{quiz_id}/play`: JWT必須。公開中クイズへの回答送信・採点・プレイ履歴保存
  - `GET /api/quizzes/{quiz_id}/rankings`: 公開中クイズのランキング（ユーザーごとのベストプレイ採用）
  - `GET /api/rankings`: 現在公開中のクイズだけを対象に、ユーザー×クイズのベストスコアを合算
  - `GET /api/me/quizzes`: JWT必須。自分が作成したクイズを状態別に取得
  - `GET /api/me/quizzes/{quiz_id}`: JWT必須。本人所有かつ編集可能な下書きを正答情報付きで取得
  - `PUT /api/me/quizzes/{quiz_id}`: JWT必須。本人所有・プレイ履歴なしの下書き内容を一括更新
  - `PATCH /api/me/quizzes/{quiz_id}/status`: JWT必須。本人所有クイズの `draft / published / archived` を変更
  - `GET /api/admin/session`: adminロール必須。管理者セッションを返却
  - `GET /api/admin/overview`: adminロール必須。管理ダッシュボード向けサマリー
  - `GET /api/admin/users`: adminロール必須。メールをマスクしたユーザー一覧
  - `GET /api/admin/quizzes`: adminロール必須。作成者・ステータス・プレイ数を含むクイズ一覧
  - `GET /api/admin/email-settings`: adminロール必須。機密値をマスクしたメール設定取得
  - `PUT /api/admin/email-settings`: adminロール必須。SMTPパスワードを更新時のみ受け取り
  - `GET /api/status`: 一般公開向けサービスステータス
  - `GET /api/admin/status`: adminロール必須。管理向け詳細ステータス
  - `POST /api/auth/register`: メールアドレス・パスワードで新規登録し、access / refresh Cookieを発行
  - `POST /api/auth/login`: メールアドレス・パスワードを検証し、access / refresh Cookieを発行
  - `POST /api/auth/google`: Google ID token を検証し、access / refresh Cookieを発行
  - `POST /api/auth/refresh`: refresh CookieとCSRF値を検証し、新しいaccess Cookieを発行
  - `POST /api/auth/logout`: access / refresh / CSRF Cookieを削除
  - `POST /api/auth/otp/request`: OTPコードを発行・保存し、メール送信基盤で送信（MVPではemailのみ対応）
  - `POST /api/auth/otp/verify`: destination / purpose に紐づくOTPコードを検証し、成功時に使用済み化
  - `GET /api/auth/me`: CookieまたはAuthorizationヘッダーJWTからログイン中ユーザーの基本情報を返却
- 開発補助エンドポイント
  - `POST /api/auth/dev-token`: 開発/検証専用の仮トークン発行（`AUTH_ENABLE_DEV_TOKEN_ENDPOINT=true` の場合のみ）
- 検証用保護ルート
  - `GET /api/auth/protected`: JWT必須の保護エンドポイント
- `AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false` と `AUTH_EXPOSE_TOKEN_IN_RESPONSE=false` を本番で明示設定してください。
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
- Issue: `docs/issues/ISSUE-0026.md`
- Issue: `docs/issues/ISSUE-0028.md`
- Issue: `docs/issues/ISSUE-0030.md`
- Issue: `docs/issues/ISSUE-0032.md`
- Issue: `docs/issues/ISSUE-0034.md`
- Issue: `docs/issues/ISSUE-0036.md`
- Issue: `docs/issues/ISSUE-0038.md`
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
- Qiita下書き: `docs/qiita/ISSUE-0026_quiz_publication_management.md`
- Qiita下書き: `docs/qiita/ISSUE-0028_draft_quiz_editing.md`
- Qiita下書き: `docs/qiita/ISSUE-0030_cookie_auth_session.md`
- Qiita下書き: `docs/qiita/ISSUE-0032_cross_tab_auth_lock.md`
- Qiita下書き: `docs/qiita/ISSUE-0034_sqlalchemy2_legacy_api_cleanup.md`
- Qiita下書き: `docs/qiita/ISSUE-0036_github_actions_node24_runtime.md`
- Qiita下書き: `docs/qiita/ISSUE-0038_admin_rbac_foundation.md`

## フロントエンド（管理ダッシュボード / ISSUE-0014, ISSUE-0038）
- `/admin`配下は専用`AdminApp`で表示します。
- 起動時に`GET /api/admin/session`でサーバー側の実ロールを確認します。
- 一般ユーザーには403の権限不足画面、未ログインユーザーにはログイン導線を表示します。
- 管理APIはHttpOnly Cookieを利用し、状態変更時はCSRFヘッダーを送信します。
- ブラウザから切り替え可能な管理者モードと`X-Admin-Mode`は使用しません。

## フロントエンド（サービス状況表示 / ISSUE-0016）
- 公開向けステータスページを `/status` として実装。
- ステータスカードで `正常 / 注意 / 障害 / メンテナンス中` を色分け表示。
- skeleton loading / 空状態 / エラー状態 / 更新時刻表示を実装。

## フロントエンド（メール設定 / ISSUE-0015, ISSUE-0038）
- 管理画面のメール設定ルートを `/admin/settings/email` として実装。
- SMTP設定はadminロール必須の管理APIと連携します。
- SMTPパスワードは取得時に平文を返さず、変更時のみ送信します。
- 保存操作はHttpOnly Cookie認証とCSRF二重送信で保護します。
