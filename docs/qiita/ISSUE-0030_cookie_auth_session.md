# Flask + ReactのJWTをlocalStorageからHttpOnly Cookieへ移行した

QuizVerseでは、ReactフロントエンドがJWTアクセストークンを`localStorage`へ保存し、APIごとに`Authorization: Bearer`を付与していました。

実装が単純な一方、XSSが発生するとJavaScriptからトークンを読み取られるため、ブラウザ向け認証を次の構成へ移行しました。

- 短命access token: HttpOnly Cookie
- 長命refresh token: HttpOnly Cookie
- 状態変更API: CSRF二重送信
- access token期限切れ: refresh後に元のAPIを1回再試行
- `localStorage`: JWTを保存せず、表示用ユーザー情報だけ保存

## Flask-JWT-ExtendedをCookieとヘッダーの併用にする

ブラウザはCookie認証へ移行しますが、既存CLIやバックエンドテスト向けにAuthorizationヘッダー互換を残します。

```python
JWT_TOKEN_LOCATION = ["cookies", "headers"]
JWT_COOKIE_CSRF_PROTECT = True
JWT_CSRF_IN_COOKIES = True
JWT_COOKIE_SECURE = True
JWT_COOKIE_SAMESITE = "Lax"
```

本番では必ずSecure Cookieを有効にします。ローカルHTTP開発時だけ`JWT_COOKIE_SECURE=false`を利用します。

## ログイン成功時に2種類のトークンをCookieへ設定する

```python
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    set_access_cookies,
    set_refresh_cookies,
)


def set_auth_cookies(response, user_id, auth_method):
    claims = {"scope": "user", "auth_method": auth_method}
    access_token = create_access_token(
        identity=str(user_id),
        additional_claims=claims,
    )
    refresh_token = create_refresh_token(
        identity=str(user_id),
        additional_claims=claims,
    )
    set_access_cookies(response, access_token)
    set_refresh_cookies(response, refresh_token)
```

JWT本体をJSONへ返さず、Cookieだけでブラウザへ渡します。テスト互換が必要な場合だけ設定でJSON公開を許可します。

## CSRF二重送信

HttpOnly CookieはJavaScriptから読めませんが、ブラウザは同一オリジンのAPIへ自動送信します。そのため、状態変更リクエストではCSRF対策が必要です。

Flask-JWT-ExtendedはJWT内のCSRF値と、JavaScriptから読めるCSRF Cookieを組み合わせて検証します。

```javascript
const csrf = readCookie('quizverse_csrf_access')

await fetch('/api/quizzes', {
  method: 'POST',
  credentials: 'same-origin',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-TOKEN': csrf,
  },
  body: JSON.stringify(payload),
})
```

GET / HEAD / OPTIONSにはCSRFヘッダーを付けず、POST / PUT / PATCHなどに付けます。refresh endpointではrefresh専用CSRF Cookieを使います。

## refresh endpoint

```python
@auth_session_bp.post('/refresh')
@jwt_required(refresh=True, locations=['cookies'])
def refresh_session():
    identity = get_jwt_identity()
    access_token = create_access_token(identity=identity)
    response = jsonify({'status': 'refreshed'})
    set_access_cookies(response, access_token)
    return response
```

refresh tokenは専用Pathへ限定し、通常APIへ不要に送らないようにします。

## 同時401を1回のrefreshへまとめる

画面表示時は複数APIが並行します。access tokenの期限切れ直後に全APIが401になると、各APIがrefreshを実行してしまいます。

そこでモジュール内に共有Promiseを保持しました。

```javascript
let refreshPromise = null

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = requestRefresh()
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}
```

保護APIは次の順で処理します。

1. 元のAPIが401
2. 共有refresh Promiseを待つ
3. refresh成功後、元のAPIを1回だけ再試行
4. refresh失敗時はローカル表示キャッシュを削除
5. 現在URLを保存してログインへ遷移

無限再試行を防ぐため、再試行済みフラグを必ず持たせます。

## localStorageからJWTを削除する

旧バージョンで保存されたトークンも残さないよう、起動時・ログイン成功時・ログアウト時に削除します。

```javascript
localStorage.removeItem('quizverse_access_token')
```

ユーザー名などの表示キャッシュは残せますが、認証判定の根拠にはしません。最終的なログイン状態は`GET /api/auth/me`で確認します。

## logout

logoutはCookie削除レスポンスを返します。

```python
@auth_session_bp.post('/logout')
def logout_session():
    response = jsonify({'status': 'logged_out'})
    unset_jwt_cookies(response)
    return response
```

access tokenが期限切れでもCookieを消せるよう、logout自体はJWT必須にしていません。

## テストした内容

バックエンドでは次を確認しました。

- access / refresh CookieがHttpOnly
- CSRF CookieはJavaScriptから参照可能
- 本番JSONレスポンスにJWTを含めない
- Cookieだけで`/auth/me`へアクセス可能
- CSRFなしPOSTを拒否
- refreshで新しいaccess Cookieを発行
- logout後に保護APIが401

フロントエンドでは次を確認しました。

- JWTを`localStorage`へ保存しない
- unsafe methodへCSRFヘッダーを付与
- Authorizationヘッダーを送信しない
- 同時401でもrefreshは1回
- refresh失敗時に復帰先付きログインへ遷移

最終CIは次の結果でした。

- フロントエンド: 36件成功
- バックエンド: 76件成功
- Production Build: 成功

## 今後

今回のrefresh tokenはステートレスJWTです。次の段階では、DBまたはRedisを利用したセッション管理へ拡張できます。

- refresh tokenの失効リスト
- 端末・セッション一覧
- デバイス単位のログアウト
- token rotationと再利用検知
- 管理者による強制ログアウト

まずはブラウザからJWT本体を触れない構成へ移行し、その後にサーバー側セッション管理を段階的に追加する方針です。
