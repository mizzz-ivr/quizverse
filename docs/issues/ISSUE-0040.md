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

### 並行実行時のactive admin保護

対象行だけをロックして件数を数える方式では、2人の管理者が同時に相互降格・停止した場合、両トランザクションが変更前の件数を参照する可能性がある。

PostgreSQLでは、role/status変更の冒頭で全管理者変更に共通する`pg_advisory_xact_lock`を取得する。共有ロック取得後、操作元管理者を`FOR UPDATE`で再読込し、現在も`active/admin`であることを再検証する。その後に対象行の`FOR UPDATE`とactive admin数確認を行う。

ロックはcommit/rollbackまで保持されるため、後続操作は先行変更の確定後に最新の操作元権限とactive admin数を確認する。これにより、相互降格・停止だけでなく、共有ロック待機中に操作元が別トランザクションで降格・停止された場合のTOCTOUも防止する。

SQLiteはテスト専用であり、DBレベルのwrite serializationを利用する。

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

本番PostgreSQLでは`audit_logs.id`を明示指定せず、既存のBIGSERIALシーケンスへ原子的な採番を委ねる。in-memory SQLiteの既存BIGINTテストスキーマだけはROWID自動採番にならないため、テスト互換用IDをアプリ側で補う。

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

ユーザー不存在時は共通JWT検証で応答を上書きせず、各既存APIの401/404契約を維持する。開発用の非数値identityは既存dev-token互換のため、ユーザーstatus検証対象外とする。本番では`AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false`を維持する。

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

## テスト結果

- バックエンド: 104件成功
- フロントエンド: 54件成功、失敗0件
- Production Build: 成功
  - JavaScript: 287.43 kB（gzip 78.29 kB）
  - CSS: 44.33 kB（gzip 7.54 kB）
  - build: 1.53秒

追加確認:

- 管理APIの401/403/409境界
- 検索・フィルター・ページング
- role/status更新
- 自己変更拒否
- active admin変更の共有advisory lock
- 共有ロック取得後の操作元role/status再検証
- audit_logsのbefore/afterとSQLite互換ID
- 不正値400
- 停止ユーザーのlogin/OTP/access JWT/refresh拒否
- ユーザー不存在時の既存API契約
- 管理APIクライアントのCookie・CSRF契約

## 対象外

- ユーザーの物理削除
- 一括ロール変更・一括停止
- 監査ログ閲覧UI
- 停止通知メール
- 複雑な権限マトリクス