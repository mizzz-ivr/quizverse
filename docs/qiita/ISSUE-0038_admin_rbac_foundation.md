# Flask + Reactの仮管理者フラグをDBロールベースのRBACへ移行する

## はじめに

管理画面のMVPを素早く確認するため、ブラウザの`localStorage`や独自ヘッダーで管理者モードを切り替える実装を置くことがあります。しかし、クライアントから自由に変更できる値は本番の認可には使えません。

QuizVerseでは、既存のHttpOnly Cookie認証を維持しながら、管理APIと管理画面をDB上の`admin`ロールで保護するRBACへ移行しました。

## 移行前の問題

```text
localStorage["quizverse_is_admin"]
X-Admin-Mode: true
```

この方式では、利用者自身が管理者フラグを変更でき、管理者が誰なのかDBから追跡できません。認証済みであることと、管理操作を許可されていることも分離されていません。

## 1. ユーザーロールを追加する

```python
class UserRole(enum.Enum):
    user = "user"
    admin = "admin"


class User(db.Model):
    role = db.Column(
        db.Enum(UserRole, name="user_role"),
        nullable=False,
        default=UserRole.user,
        server_default=UserRole.user.value,
    )
```

アプリ側とDB側の両方で既定値を`user`にします。SQLAlchemyを経由しないINSERTでも、意図せず管理者になることを防げます。

## 2. PostgreSQLとSQLiteを考慮してmigrationする

PostgreSQL enumは、型作成と列追加の両方で`CREATE TYPE`が実行されないようにします。

```python
from sqlalchemy.dialects import postgresql


def _column_type(bind):
    if bind.dialect.name == "postgresql":
        return postgresql.ENUM(
            "user",
            "admin",
            name="user_role",
            create_type=False,
        )
    return sa.Enum("user", "admin", name="user_role")


def upgrade():
    bind = op.get_bind()
    column_type = _column_type(bind)
    if bind.dialect.name == "postgresql":
        column_type.create(bind, checkfirst=True)

    op.add_column(
        "users",
        sa.Column("role", column_type, nullable=False, server_default="user"),
    )
```

既存ユーザーを埋めるためDB既定値を保持します。SQLiteで未対応の`ALTER COLUMN ... DROP DEFAULT`を実行する必要もありません。

## 3. 認証と認可を分離する

JWTの検証は認証、DBロールの確認は認可です。

```python
def admin_required(view):
    @wraps(view)
    @jwt_required()
    def wrapped(*args, **kwargs):
        user, error = resolve_current_user()
        if error:
            return error
        if user.role != UserRole.admin:
            return error_response("admin/forbidden", "Admin role is required.", 403)

        g.current_user = user
        return view(*args, **kwargs)

    return wrapped
```

ロールをJWT claimだけで判断せず、リクエストごとにDB上の現在値を確認します。アカウント停止やロール変更が古いaccess tokenに遮られません。

## 4. 初期管理者のメール所有確認を必須にする

メールアドレスの許可リストは便利ですが、パスワード登録フォームへそのアドレスを入力しただけでは所有確認になりません。未登録の管理者メールを攻撃者が先に登録すると、管理者権限を奪えるためです。

QuizVerseでは、次の条件をすべて満たした場合だけ初期管理者へ昇格します。

- メールが`ADMIN_BOOTSTRAP_EMAILS`に含まれる
- ユーザーが`active`
- 同じメールアドレスのGoogle OAuth連携が存在する
- その連携はGoogle ID tokenの`email_verified`確認後に作成されている

```python
def _has_verified_google_email(user):
    account = (
        db.session.query(UserOauthAccount.id)
        .filter(
            UserOauthAccount.user_id == user.id,
            UserOauthAccount.provider == OauthProvider.google,
            func.lower(UserOauthAccount.provider_email) == user.email.lower(),
        )
        .first()
    )
    return account is not None
```

```env
ADMIN_BOOTSTRAP_EMAILS=admin@example.com
```

パスワード登録だけのアカウントは、設定メールと一致しても昇格しません。Google OAuthを利用しない環境では、DB管理者が対象アカウントを別経路で確認してから`users.role=admin`を明示設定します。

## 5. 管理APIを共通デコレータで保護する

```python
@admin_bp.get("/overview")
@admin_required
def get_admin_overview():
    ...
```

管理ダッシュボード、ユーザー一覧、クイズ一覧、SMTP設定、内部ステータスを同じ境界へ揃えます。

- 未認証: 401
- 一般ユーザー: 403
- suspended / withdrawn: 403
- activeかつadmin: 200
- `X-Admin-Mode`を追加しても昇格しない

## 6. React管理画面をCookie認証へ接続する

管理画面起動時に`GET /api/admin/session`を呼び、実際のロールを確認します。

```javascript
const payload = await adminApi.session()
```

管理APIクライアントはCookie資格情報を使用します。

```javascript
fetch(path, {
  credentials: 'same-origin',
  headers,
})
```

SMTP設定更新などの状態変更では、CSRF Cookieをヘッダーへ付与します。

```javascript
headers['X-CSRF-TOKEN'] = readCookie('quizverse_csrf_access')
```

管理者切替トグル、Authorizationヘッダー、`X-Admin-Mode`は一般ブラウザ画面から送信しません。

## 7. テストする境界

バックエンドでは次を固定しました。

- 未認証は401
- 一般ユーザーは403
- 仮ヘッダーを追加しても403
- 未確認パスワードアカウントはbootstrap対象外
- 確認済みGoogleメールだけがadminへ昇格
- 非active adminは403
- ユーザー一覧に平文メールやパスワードハッシュを含めない
- SMTPパスワードを平文で返さない
- migration revision、DB既定値、PostgreSQL enum設定

フロントエンドでは次を確認しました。

- Cookie資格情報を利用する
- Authorizationヘッダーを送らない
- `X-Admin-Mode`を送らない
- PUTへCSRFヘッダーを付ける
- 403を管理権限不足として扱う

## CI結果

初回実装時点では次の結果でした。

- バックエンド: 94件成功
- フロントエンド: 52件成功
- Production Build: 成功
- JavaScript: 272.17 kB（gzip 75.09 kB）
- CSS: 42.93 kB（gzip 7.33 kB）

レビュー後はメール所有確認テストとmigration互換テストを追加して再実行します。

## デプロイ時の注意

この変更にはDBマイグレーションが必要です。

```bash
cd backend
DATABASE_URL='<production database url>' flask --app app db upgrade
```

推奨手順は次のとおりです。

1. DBバックアップ
2. revision `20260804_0009`を適用
3. Google OAuthでメール確認済みの対象ユーザーを準備
4. `ADMIN_BOOTSTRAP_EMAILS`を設定してアプリを配信
5. 対象ユーザーがGoogleログインして`/admin`へアクセス
6. `role=admin`を確認
7. 必要に応じてbootstrap環境変数を空へ戻す

## まとめ

- クライアントから変更できる値を認可に使わない
- JWTの有効性とDB上の現在ロールを両方確認する
- メールアドレス一致だけで管理者へ昇格しない
- 確認済みIDプロバイダの証跡を所有確認に使う
- PostgreSQL enumとSQLiteのmigration差異を考慮する
- Cookie認証では状態変更時のCSRFも維持する

MVPの仮フラグは確認用途として便利ですが、本番へ進む段階では、サーバー側RBACと安全な初期管理者作成へ置き換えることが重要です。
