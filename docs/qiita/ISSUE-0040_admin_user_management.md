# Flask + Reactで安全な管理ユーザー操作とアカウント停止を実装する

## はじめに

管理画面をDBロールベースのRBACへ移行しても、ユーザーのロール変更や停止操作には追加の安全条件が必要です。特に、最後の管理者を失う操作、自分自身の権限を消す操作、停止後も既存JWTが利用できる状態は避けなければなりません。

QuizVerseでは、既存の`users.role`、`users.status`、`audit_logs`を使い、管理ユーザー操作と全JWT経路の停止制御を追加しました。

## 1. 一覧APIへ検索とフィルターを追加する

管理画面では次の条件をサーバー側へ送ります。

- 表示名・メールアドレスの部分一致
- `user / admin`
- `active / suspended / withdrawn`
- ページ番号と1ページ件数

検索対象にメールアドレスを使っても、レスポンスではマスク値だけを返します。パスワードハッシュ、OAuth識別子、OTP、JWTは返しません。

## 2. 自己降格と自己停止を拒否する

管理者自身が自分の`admin`ロールを削除したり、自分を停止したりすると、運用復旧が難しくなります。

```python
if target.id == g.current_user.id and next_role != UserRole.admin:
    return error_response(
        "admin/self_role_change_forbidden",
        "You cannot remove your own admin role.",
        409,
    )
```

状態変更も同様に、自分自身を`active`以外へ変更できないようにします。

## 3. active adminを並行操作から守る

active admin数を数えて1人以下なら拒否するだけでは、並行実行に弱い場合があります。2人の管理者が同時に相互降格すると、それぞれが変更前の「2人」を確認して両方commitできる可能性があります。

QuizVerseでは、PostgreSQLのtransaction advisory lockを全role/status変更で共有します。

```python
_ADMIN_MUTATION_LOCK_KEY = 0x51565F41444D494E


def serialize_admin_mutation():
    db.session.execute(
        db.text("SELECT pg_advisory_xact_lock(:lock_key)"),
        {"lock_key": _ADMIN_MUTATION_LOCK_KEY},
    )
```

処理順は次のとおりです。

1. 共通advisory lockを取得
2. 対象ユーザー行を`FOR UPDATE`で取得
3. active admin数を確認
4. role/statusと監査ログを更新
5. commitまたはrollbackでロック解放

後続トランザクションは先行変更の確定後に件数を確認するため、相互降格や相互停止でもactive adminが0人になることを防げます。

## 4. 変更を監査ログへ残す

ロール・状態が実際に変わった場合だけ、次を保存します。

```json
{
  "field": "status",
  "before": "active",
  "after": "suspended",
  "actor_role": "admin"
}
```

操作した管理者、対象ユーザー、変更前後、時刻を追跡できます。同一値への更新は成功扱いにしつつ、監査ログを増やしません。

監査ログIDを`max(id) + 1`で作ると、並行トランザクションが同じIDを選ぶ可能性があります。本番PostgreSQLではIDを指定せず、既存のBIGSERIALシーケンスへ採番を委ねます。

```python
AuditLog(
    actor_user_id=g.current_user.id,
    action=AuditAction.update,
    entity_type="user",
    entity_id=str(target.id),
    metadata_json=metadata,
)
```

in-memory SQLiteの既存BIGINTテストスキーマはROWID自動採番にならないため、SQLiteだけに互換用IDを設定しています。本番の採番競合には影響しません。

## 5. JWTの有効期限だけで停止を判断しない

JWTが有効期限内でも、DB上のユーザーが停止済みならアクセスを拒否する必要があります。Flask-JWT-Extendedの追加検証コールバックで、JWT identityに対応するユーザーの現在statusを毎回確認します。

```python
@jwt.token_verification_loader
def verify_active_user_token(_jwt_header, jwt_payload):
    user, is_user_identity = load_user(jwt_payload.get("sub"))
    if not is_user_identity or user is None:
        return True
    return user.status == UserStatus.active
```

ユーザー不存在は共通コールバックで応答を決めず、`/api/auth/me`など各APIの既存401/404契約へ処理を委ねます。実在する`suspended / withdrawn`だけを403 `auth/account_inactive`で拒否します。

これにより、access JWT、refresh Cookie、クイズAPI、管理APIなど、`jwt_required`を使う経路全体へ同じ停止ルールを適用できます。

## 6. ログインとOTPも停止する

JWT発行前の処理には追加検証が必要です。

- パスワードログイン
- Google OAuthログイン
- OTP request / verify

成功レスポンスからCookieセッションを発行する直前にもDB statusを確認し、停止済みなら403を返します。

## 7. React管理画面

`/admin/users`では次を実装しました。

- 検索・role/statusフィルター
- ページング
- PC向けテーブルとモバイルカード
- 詳細サイドパネル
- role/status変更確認
- loading / empty / error / success
- 自己変更ボタンの無効化

PATCHリクエストは既存のHttpOnly Cookie認証を使い、JavaScriptから読めるCSRF Cookieを`X-CSRF-TOKEN`へ設定します。

## CI結果

- バックエンド: 103件成功
- フロントエンド: 54件成功、失敗0件
- Production Build: 成功
- JavaScript: 287.43 kB（gzip 78.29 kB）
- CSS: 44.33 kB（gzip 7.54 kB）
- build: 1.53秒

## まとめ

- クライアント表示だけでなくサーバー側で自己保護を行う
- active admin判定を共有advisory lockで直列化する
- role/status変更を監査ログへ残す
- 監査ログIDをPostgreSQLシーケンスへ委ねる
- JWT期限ではなくDBの現在statusを毎回確認する
- 停止ルールをlogin、OTP、refresh、保護APIへ一貫適用する
- 管理画面では機密情報を返さない

管理ユーザー機能は単なるCRUDではなく、復旧可能性・並行実行の安全性・監査可能性を守る運用機能として設計することが重要です。