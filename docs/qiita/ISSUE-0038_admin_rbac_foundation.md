# Flask + Reactの仮管理者フラグをDBロールベースのRBACへ移行する

## はじめに

管理画面のMVPを素早く確認するため、ブラウザの`localStorage`や独自ヘッダーで管理者モードを切り替える実装を置くことがあります。しかし、クライアントから自由に変更できる値は本番の認可には使えません。

QuizVerseでは、既存のHttpOnly Cookie認証を維持しながら、管理APIと管理画面をDB上の`admin`ロールで保護するRBACへ移行しました。

## 移行前の問題

移行前は次の値を管理者判定に使っていました。

```text
localStorage["quizverse_is_admin"]
X-Admin-Mode: true
```

この方式には次の問題があります。

- 利用者がブラウザから自由に変更できる
- APIを直接呼び出すだけで管理モードを偽装できる
- 認証と認可の責務が分離されていない
- 管理者が誰なのかDBから追跡できない

## 1. ユーザーロールを追加する

ユーザーテーブルへ`user`と`admin`の2値を持つロールを追加します。

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

アプリ側のdefaultだけでなく、DB側にも`user`の既定値を持たせます。SQLAlchemyを経由しないINSERTでも管理者にならない安全側の値を使えます。

## 2. Alembicで既存ユーザーを安全に移行する

```python
user_role = sa.Enum("user", "admin", name="user_role")


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        user_role.create(bind, checkfirst=True)

    op.add_column(
        "users",
        sa.Column("role", user_role, nullable=False, server_default="user"),
    )
```

既存レコードがある状態でNOT NULL列を追加するため、追加時点からDB既定値を設定します。

## 3. 認証と認可を分離する

JWTの検証は認証、DBロールの確認は認可です。管理APIでは両方を実行する共通デコレータを用意しました。

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

JWT claimに保存されたロールだけを信頼せず、リクエストごとにDBの現在値を確認します。これにより、ロールやアカウント状態を変更した際に古いaccess tokenが残っていても最新の権限が反映されます。

## 4. 初期管理者を環境変数で作る

管理APIがadminだけに制限されると、最初のadminを作る経路が必要になります。QuizVerseではメールアドレスの許可リストを環境変数で設定しました。

```env
ADMIN_BOOTSTRAP_EMAILS=admin@example.com
```

ログイン済みユーザーのメールアドレスが一致した場合だけ、DBロールを`admin`へ昇格して保存します。

運用上は次の手順にします。

1. 環境変数へ対象メールを設定
2. 対象ユーザーが通常ログイン
3. 管理画面へアクセス
4. DB上の`role=admin`を確認
5. 必要に応じて環境変数を空へ戻す

環境変数を削除しても保存済みロールは自動で降格させません。

## 5. 管理APIを共通デコレータで保護する

```python
@admin_bp.get("/overview")
@admin_required
def get_admin_overview():
    ...
```

管理ダッシュボード、ユーザー一覧、クイズ一覧、SMTP設定、内部ステータスを同じ認可境界へ揃えます。仮ヘッダーは完全に無視します。

期待する応答は次のとおりです。

- 未認証: 401
- 一般ユーザー: 403
- suspended / withdrawn: 403
- activeかつadmin: 200

## 6. React管理画面をCookie認証へ接続する

管理画面起動時に専用セッションAPIを呼び出します。

```javascript
const payload = await adminApi.session()
```

管理APIクライアントでは次を共通化します。

```javascript
fetch(path, {
  credentials: 'same-origin',
  headers,
})
```

状態変更リクエストでは、既存のCSRF Cookieをヘッダーへ付与します。

```javascript
headers['X-CSRF-TOKEN'] = readCookie('quizverse_csrf_access')
```

管理者切替トグルや`X-Admin-Mode`は送信しません。

## 7. テストする境界

バックエンドでは次を固定しました。

- 未認証は401
- 一般ユーザーは403
- 仮ヘッダーを追加しても403
- bootstrap対象メールだけがadminへ昇格
- 非active adminは403
- ユーザー一覧に平文メールやパスワードハッシュを含めない
- SMTPパスワードを平文で返さない
- Alembic revisionとDB既定値

フロントエンドでは次を確認しました。

- Cookie資格情報を利用する
- Authorizationヘッダーを送らない
- `X-Admin-Mode`を送らない
- PUTへCSRFヘッダーを付ける
- 403を管理権限不足として扱う

## CI結果

- バックエンド: 94件成功
- フロントエンド: 52件成功
- Production Build: 成功
- JavaScript: 272.17 kB（gzip 75.09 kB）
- CSS: 42.93 kB（gzip 7.33 kB）

## デプロイ時の注意

この変更にはDBマイグレーションが必要です。

```bash
cd backend
DATABASE_URL='<production database url>' flask --app app db upgrade
```

マイグレーションより先に新しいアプリを配信すると、`users.role`が存在せず管理APIや認証処理が失敗します。バックアップ、マイグレーション、アプリ配信の順序を決めてから実施します。

## まとめ

- クライアントから変更できる値を認可に使わない
- JWTの有効性とDB上の現在ロールを両方確認する
- 管理API全体を共通デコレータで保護する
- 初期管理者の作成経路を環境変数で明示する
- Cookie認証では状態変更時のCSRFも維持する
- マイグレーションと初回管理者設定をデプロイ手順へ含める

MVPの仮フラグは確認用途として便利ですが、本番へ進む段階では早めにサーバー側RBACへ置き換えることが重要です。
