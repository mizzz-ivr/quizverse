# ISSUE-0038 管理者RBAC基盤と管理画面の実権限チェック

## 背景

従来の管理画面は、ブラウザの`localStorage["quizverse_is_admin"]`と`X-Admin-Mode: true`を使った仮判定だった。利用者自身が値を変更できるため、本番運用で管理権限として使用できない。

## 目的

- 管理者権限をDB上のユーザーロールで管理する
- 管理APIの認可判断をサーバーへ集約する
- 管理画面を既存のHttpOnly Cookie認証・CSRF基盤へ接続する
- 初回管理者を環境変数から安全に作成できるようにする

## データモデル

`users.role`を追加する。

- `user`: 一般ユーザー。既定値
- `admin`: 管理APIを利用できる管理者

Alembic revisionは`20260804_0009`、親revisionは`20260422_0008`とする。既存ユーザーと新規ユーザーにはDB既定値`user`を適用する。

PostgreSQLでは`user_role` enumを`checkfirst=True`で作成し、列追加時は`create_type=False`を使って型の二重作成を防ぐ。SQLiteではDB既定値を保持することで、未対応の`ALTER COLUMN`を実行しない。

## 初期管理者

`ADMIN_BOOTSTRAP_EMAILS`へカンマ区切りでメールアドレスを設定する。

```env
ADMIN_BOOTSTRAP_EMAILS=admin@example.com
```

メールアドレスを入力するだけのパスワード登録は所有確認にならないため、設定値への一致だけでは昇格しない。Google ID tokenの`email_verified`検証後に作成された`user_oauth_accounts`が、同一メールアドレスで紐づいているユーザーだけを`admin`へ昇格して保存する。

- 未確認のパスワード登録アカウント: 昇格しない
- 確認済みGoogle OAuthアカウント: 設定メールと一致した場合だけ昇格
- 設定値に含まれないアカウント: 昇格しない
- 環境変数削除後: 保存済みロールを自動降格しない

Google OAuthを利用しない環境では、DB管理者が対象ユーザーを確認したうえで`users.role=admin`を明示設定する。

## 認可

共通`admin_required`デコレータは次の順で判定する。

1. access JWTをCookieまたはAuthorizationヘッダーから検証
2. JWT identityに対応するユーザーをDBから取得
3. `status=active`を確認
4. 確認済みGoogleメールと初期管理者設定を確認
5. `role=admin`を確認

応答境界:

- 未認証: 401
- 不正identity・ユーザー不存在: 401
- suspended / withdrawn: 403
- 一般ユーザー: 403 `admin/forbidden`

`X-Admin-Mode`は認可に使用しない。

## 対象API

- `GET /api/admin/session`
- `GET /api/admin/overview`
- `GET /api/admin/users`
- `GET /api/admin/quizzes`
- `GET /api/admin/email-settings`
- `PUT /api/admin/email-settings`
- `GET /api/admin/status`

ユーザー一覧ではメールアドレスをマスクし、パスワードハッシュなどの機密情報を返さない。

## フロントエンド

`/admin`配下を`AdminApp`へ分離した。

- 起動時に`/api/admin/session`で実権限を確認
- 401では復帰先付きログイン導線を表示
- 403では管理権限不足を表示
- 管理APIは`credentials: same-origin`でCookieを送信
- PUTではaccess CSRF Cookieを`X-CSRF-TOKEN`へ設定
- `X-Admin-Mode`と管理者切替トグルを廃止
- 公開`/status`画面は管理画面から独立

## テスト結果

レビュー対応後の最終CI:

- バックエンド: 95件成功
- フロントエンド: 52件成功、失敗0件
- Production Build: 成功
  - JavaScript: 272.17 kB（gzip 75.09 kB）
  - CSS: 42.93 kB（gzip 7.33 kB）
  - build: 1.42秒

未確認パスワードアカウントの昇格拒否、確認済みGoogleメールの昇格、PostgreSQL enum型の二重作成防止、SQLite互換性、スキーマ文書を追加検証した。

## マージ後作業

1. DBバックアップを確認
2. `flask --app app db upgrade`でrevision `20260804_0009`を適用
3. Google OAuthでメール所有確認済みの対象ユーザーを用意
4. Preview / Productionへ`ADMIN_BOOTSTRAP_EMAILS`を設定して再デプロイ
5. 対象ユーザーがGoogleログイン後、`/admin`へアクセス
6. `/api/admin/session`が`role=admin`を返すことを確認
7. 初回昇格後、必要に応じて`ADMIN_BOOTSTRAP_EMAILS`を空へ戻して再デプロイ

Google OAuthを使わない場合は、手順3〜7の代わりにDB上で確認済み対象ユーザーの`role`を明示的に`admin`へ変更する。

## 対象外

- 管理画面からのロール変更
- ユーザー停止・復旧操作
- 最終管理者保護
- 一括操作
- 監査ログ閲覧画面

これらは後続Issueで実装する。
