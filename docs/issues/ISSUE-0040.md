# ISSUE-0040 管理者向けユーザー管理とアカウント停止制御

## 背景

ISSUE-0038で管理APIをDBロールベースのRBACへ移行したが、管理ユーザー画面は参照専用だった。また、`users.status`は存在していても一般のJWT保護APIやrefreshで一貫して検証されていなかった。

## 管理API

- `GET /api/admin/users`
  - `q`: 表示名・メールアドレスの部分一致
  - `role`: `user / admin`
  - `status`: `active / suspended / withdrawn`
  - `page / per_page`: ページング
- `GET /api/admin/users/{user_id}`
- `PATCH /api/admin/users/{user_id}/role`
- `PATCH /api/admin/users/{user_id}/status`

すべて`admin_required`で保護し、Cookie認証時のPATCHは既存CSRF二重送信を利用する。

## 安全条件

- 自分自身のadminロールは削除できない
- 自分自身を`suspended / withdrawn`へ変更できない
- active adminが失われる変更を409で拒否する
- 不正なrole/statusは400
- 対象ユーザー不存在は404
- 一覧・詳細ではメールアドレスをマスクし、パスワードハッシュ、OAuth識別子、OTP、JWTを返さない

## 監査ログ

ロール・状態が実際に変更された場合だけ`audit_logs`へ記録する。

- `actor_user_id`: 操作した管理者
- `action`: `update`
- `entity_type`: `user`
- `entity_id`: 対象ユーザーID
- `metadata.field`: `role`または`status`
- `metadata.before / after`: 変更前後の値
- `metadata.actor_role`: 操作時の管理者ロール

同一値への更新は成功扱いだが、監査ログは追加しない。

## 停止アカウントの認証境界

Flask-JWT-Extendedの追加検証コールバックで、数値ユーザーIDを持つJWTについてリクエストごとにDBの現在statusを確認する。

`suspended / withdrawn`は次を403 `auth/account_inactive`で拒否する。

- access JWTを使う全保護API
- refresh Cookie
- `/api/auth/me`
- `/api/auth/protected`
- 管理API
- OTP request / verify
- パスワードログイン・Google OAuthログインの成功レスポンスからのセッション発行

開発用の非数値identityは既存dev-token互換のため、ユーザーstatus検証対象外とする。本番では`AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false`を維持する。

## フロントエンド

`/admin/users`は専用エントリで表示する。

- 管理者セッション確認
- 名前／メール検索
- role/statusフィルター
- ページング
- PCテーブル／モバイルカード
- ユーザー詳細サイドパネル
- role/status変更確認
- 更新成功・APIエラー表示
- 自己降格・自己停止操作の無効化

## DB変更

新規migrationは不要。既存の`users.role`、`users.status`、`audit_logs`を使用する。

## テスト対象

- 管理APIの401/403
- 検索・フィルター・ページング
- role/status更新
- 自己変更拒否
- active admin保護
- audit_logsのbefore/after
- 不正値400
- 停止ユーザーのlogin/OTP/access JWT/refresh拒否
- 管理APIクライアントのCookie・CSRF契約
- フロントエンドテスト・Production Build

## 対象外

- ユーザーの物理削除
- 一括ロール変更・一括停止
- 監査ログ閲覧UI
- 停止通知メール
- 複雑な権限マトリクス