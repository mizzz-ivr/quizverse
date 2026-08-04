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

## 3. active adminを失わない

対象ユーザーをロックしてから、active admin数を確認します。

```python
active_admins = (
    db.session.query(func.count(User.id))
    .filter(
        User.role == UserRole.admin,
        User.status == UserStatus.active,
    )
    .scalar()
)
```

最後のactive adminを降格・停止する変更は409で拒否します。自己保護と組み合わせることで、通常の管理画面操作から管理者不在になることを防ぎます。

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

## 5. JWTの有効期限だけで停止を判断しない

JWTが有効期限内でも、DB上のユーザーが停止済みならアクセスを拒否する必要があります。Flask-JWT-Extendedの追加検証コールバックで、JWT identityに対応するユーザーの現在statusを毎回確認します。

```python
@jwt.token_verification_loader
def verify_active_user_token(_jwt_header, jwt_payload):
    user = load_user(jwt_payload.get("sub"))
    return bool(user and user.status == UserStatus.active)
```

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

## まとめ

- クライアント表示だけでなくサーバー側で自己保護を行う
- active adminが失われる変更を拒否する
- role/status変更を監査ログへ残す
- JWT期限ではなくDBの現在statusを毎回確認する
- 停止ルールをlogin、OTP、refresh、保護APIへ一貫適用する
- 管理画面では機密情報を返さない

管理ユーザー機能は単なるCRUDではなく、復旧可能性と監査可能性を守る運用機能として設計することが重要です。