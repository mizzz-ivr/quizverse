# QuizVerse

クイズ作成・公開・プレイ・ランキング・学習履歴を扱うWebプラットフォームです。

## 技術スタック

- Frontend: React + Tailwind CSS + Vite
- Backend: Flask + Flask-JWT-Extended + Flask-Migrate + SQLAlchemy
- Database: PostgreSQL
- Local: Docker Compose
- Deployment: Vercel（Vite Static + Flask Python Function）

## クイックスタート

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:5000/api/health`

## テスト

```bash
cd backend && PYTHONPATH=. pytest
npm --prefix frontend test
npm --prefix frontend run build
```

`backend/pytest.ini`ではSQLAlchemy Legacy API警告をエラーとして扱います。

## 一般ユーザー向け画面

- `/`: ホーム
- `/signup`: 新規登録
- `/login`: ログイン
- `/quizzes`: 公開クイズ一覧・検索・カテゴリ絞り込み
- `/quizzes/{quiz_id}`: クイズ詳細・回答・採点結果
- `/quizzes/{quiz_id}/rankings`: クイズ別ランキング
- `/rankings`: 総合ランキング
- `/quizzes/new`: クイズ作成
- `/my/quizzes`: 自分のクイズ管理
- `/my/quizzes/{quiz_id}/edit`: 下書き編集
- `/profile`: プロフィール・成績・プレイ履歴
- `/status`: 公開サービス状況

## プロフィール・プレイ履歴（ISSUE-0042）

`/profile`では、認証済みユーザーが次を確認できます。

- 表示名・メールアドレス・登録日・最終ログイン
- 表示名編集
- 平均正答率
- プレイ回数
- 挑戦したクイズ数
- 累計正解数
- 全問正解回数
- 作成クイズ数
- 提出済みプレイ履歴
- 問題ごとの選択肢・正誤・獲得点・解説

履歴は次の区分で絞り込めます。

- `perfect`: 正答率100%
- `passed`: 70%以上100%未満
- `review`: 70%未満

非公開・アーカイブ済みクイズの過去結果も本人には表示します。再挑戦導線は現在`published`のクイズだけ有効です。

プロフィールAPI:

- `GET /api/me/profile`
- `PATCH /api/me/profile`
- `GET /api/me/plays`
- `GET /api/me/plays/{play_id}`

すべてJWT/Cookie認証必須です。他ユーザーの履歴は404として扱い、正答と解説は本人の`submitted`済みプレイ詳細でのみ返します。

詳細仕様: `docs/issues/ISSUE-0042.md`

## クイズ公開ライフサイクル

- `draft`: 作成者だけがプレビュー可能
- `published`: 一般一覧・詳細・回答・ランキング対象
- `archived`: 公開終了。作成者だけがプレビュー・再公開可能

非公開クイズへ非作成者がアクセスした場合は404を返します。本番では`QUIZ_PUBLICATION_ENFORCED=true`を設定してください。

下書き編集は、作成者本人かつプレイ履歴が存在しないクイズだけに限定しています。一度でもプレイ履歴が保存されたクイズは、採点結果との整合性を守るため問題構造を編集できません。

## ブラウザ認証

一般ユーザー向けWeb画面はHttpOnly Cookie認証を使用します。

- access token: 短命Cookie
- refresh token: `/api/auth/refresh`専用Cookie
- CSRF: CSRF Cookieを`X-CSRF-TOKEN`へ設定
- API通信: `credentials: same-origin`
- access token期限切れ: refresh後に元リクエストを1回再試行
- 複数タブ: Web Locks APIでrefresh・logout・loginを直列化
- JWT本体をlocalStorageへ保存しない

`quizverse_session_hint`はJWTを含まないセッション候補のヒントです。認証状態の最終確認は`GET /api/auth/me`で行います。

## 認証API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `POST /api/auth/otp/request`
- `POST /api/auth/otp/verify`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

`suspended / withdrawn`ユーザーはlogin、OTP、access JWT、refresh Cookieを403 `auth/account_inactive`で拒否します。

## クイズAPI

- `POST /api/quizzes`: クイズ一括作成
- `GET /api/quizzes`: 公開クイズ一覧
- `GET /api/quizzes/{quiz_id}`: 詳細
- `POST /api/quizzes/{quiz_id}/play`: 回答・採点
- `GET /api/rankings`: 総合ランキング
- `GET /api/quizzes/{quiz_id}/rankings`: クイズ別ランキング
- `GET /api/me/quizzes`: 自分のクイズ一覧
- `GET /api/me/quizzes/{quiz_id}`: 編集用データ
- `PUT /api/me/quizzes/{quiz_id}`: 下書き更新
- `PATCH /api/me/quizzes/{quiz_id}/status`: 公開状態変更

クイズ作成条件:

- 1〜50問
- 各問題2〜6択
- 正答は各問題1件
- 作成直後は`draft`

## 管理者機能（ISSUE-0038, ISSUE-0040）

管理画面と管理APIはDB上の`users.role=admin`で保護します。

- `/admin`: 管理ダッシュボード
- `/admin/users`: ユーザー管理
- `/admin/settings/email`: SMTP設定

管理API:

- `GET /api/admin/session`
- `GET /api/admin/overview`
- `GET /api/admin/users`
- `GET /api/admin/users/{user_id}`
- `PATCH /api/admin/users/{user_id}/role`
- `PATCH /api/admin/users/{user_id}/status`
- `GET /api/admin/quizzes`
- `GET /api/admin/email-settings`
- `PUT /api/admin/email-settings`
- `GET /api/admin/status`

安全条件:

- 未認証は401
- 一般ユーザーは403
- 自分自身の降格・停止は禁止
- 最後のactive adminを失う変更は禁止
- PostgreSQL advisory lockで管理者変更を直列化
- role/status変更を`audit_logs`へ記録
- ユーザー一覧・詳細はメールをマスク

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

Vercel Function起動時には自動マイグレーションを実行しません。デプロイ前に外部PostgreSQLのバックアップと対象revisionを確認し、明示的に適用してください。

ISSUE-0040とISSUE-0042は既存テーブルを利用するため追加migrationはありません。

## Vercelデプロイ

QuizVerseは単一Vercelプロジェクトでfrontendとbackendを配信します。

- Vite output: `frontend/dist`
- Flask Function: `api/index.py`
- `/api/*`: Flask Functionへrewrite
- その他: SPA `index.html`へrewrite
- Database: 外部PostgreSQL

必須環境変数:

```env
DATABASE_URL=
SECRET_KEY=
JWT_SECRET_KEY=
JWT_COOKIE_SECURE=true
AUTH_EXPOSE_TOKEN_IN_RESPONSE=false
AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false
OTP_INCLUDE_CODE_IN_RESPONSE=false
QUIZ_PUBLICATION_ENFORCED=true
```

主な追加設定:

- `JWT_ACCESS_TOKEN_EXPIRES_SECONDS`
- `JWT_REFRESH_TOKEN_EXPIRES_SECONDS`
- `JWT_COOKIE_SAMESITE`
- `JWT_COOKIE_DOMAIN`
- `ADMIN_BOOTSTRAP_EMAILS`
- `GOOGLE_OAUTH_CLIENT_ID`
- `EMAIL_SETTINGS_ENCRYPTION_KEY`
- OTP関連設定
- サービスメンテナンス設定

初期管理者は`ADMIN_BOOTSTRAP_EMAILS`へメールアドレスを設定します。自動昇格には、同一メールアドレスでGoogle OAuthの`email_verified`確認を通過している必要があります。

デプロイ後の主な確認先:

- `/`
- `/login`
- `/quizzes`
- `/quizzes/new`
- `/my/quizzes`
- `/profile`
- `/rankings`
- `/status`
- `/admin`
- `/admin/users`
- `/api/health`
- `/api/status`

## ドキュメント

- ロードマップ: `docs/roadmap.md`
- Issue仕様: `docs/issues/`
- DBスキーマ: `docs/schema/mvp_core_tables.md`
- Qiita下書き: `docs/qiita/`
- ISSUE-0042仕様: `docs/issues/ISSUE-0042.md`
- ISSUE-0042記事: `docs/qiita/ISSUE-0042_profile_play_history.md`
