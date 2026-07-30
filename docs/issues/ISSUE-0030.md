# ISSUE-0030: HttpOnly Cookieとrefresh tokenによる認証セッションへ移行する

## 背景

一般ユーザー向けフロントエンドはJWTアクセストークンを`localStorage`へ保存し、保護APIへ`Authorization: Bearer`として送信していた。

この方式ではXSSが発生した場合にJavaScriptからトークンを読み取られるため、ブラウザ向け認証をHttpOnly Cookieへ移行する。また、短命access tokenが期限切れになったときに、編集中のクイズを失わず認証を更新できるrefresh経路を追加する。

## 方針

### ブラウザ

- access tokenとrefresh tokenはサーバーがHttpOnly Cookieへ保存する
- JavaScriptはJWT本体を読み書きしない
- `localStorage`には画面表示用のユーザー情報だけを保存する
- `quizverse_session_hint` Cookieでセッション候補の有無だけを判定する
- API通信は`credentials: same-origin`を利用する
- POST / PUT / PATCHなどの状態変更ではCSRF Cookieを`X-CSRF-TOKEN`へ複写する

### 非ブラウザクライアント

既存CLI・APIテストとの互換性を維持するため、Flask-JWT-Extendedのtoken locationは`cookies,headers`を既定値とする。一般ユーザー向けWeb画面はAuthorizationヘッダーを送信しない。

## Cookie

| Cookie | HttpOnly | Path | 用途 |
| --- | --- | --- | --- |
| `quizverse_access_token` | Yes | `/` | 短命access token |
| `quizverse_refresh_token` | Yes | `/api/auth/refresh` | refresh token |
| `quizverse_csrf_access` | No | `/` | access token用CSRF値 |
| `quizverse_csrf_refresh` | No | `/` | refresh token用CSRF値 |
| `quizverse_session_hint` | No | `/` | JWTを含まないセッション有無のヒント |

本番・Previewでは`JWT_COOKIE_SECURE=true`を設定する。既定のSameSiteは`Lax`とする。

## API

### 認証成功

次の既存エンドポイントが成功した場合、access / refresh CookieとCSRF Cookieを設定する。

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`

本番レスポンスはJWT文字列をJSONへ含めず、`token_type: Cookie`とユーザー情報を返す。テスト環境または`AUTH_EXPOSE_TOKEN_IN_RESPONSE=true`では既存テスト互換のためaccess tokenを残す。

### `POST /api/auth/refresh`

refresh Cookieと`quizverse_csrf_refresh`の値を送信し、新しいaccess Cookieを発行する。

```http
POST /api/auth/refresh
X-CSRF-TOKEN: <quizverse_csrf_refresh>
```

成功レスポンス:

```json
{
  "status": "refreshed",
  "token_type": "Cookie",
  "user": {
    "id": "1",
    "email": "user@example.com",
    "display_name": "User",
    "status": "active"
  }
}
```

### `POST /api/auth/logout`

access / refresh / CSRF Cookieと`quizverse_session_hint`を削除する。アクセストークンが期限切れの場合でもローカルセッションを終了できるよう、JWT必須にはしない。

`quizverse_session_hint=1`が存在する場合は、`quizverse_csrf_access`または`quizverse_csrf_refresh`のどちらかを`X-CSRF-TOKEN`へ設定する。access Cookieが期限切れ・削除済みでもrefresh用CSRF値で安全にログアウトできる。セッションヒントがない場合は冪等なCookie削除として成功する。

## フロントエンド再試行

保護APIが401を返した場合、次の順で処理する。

1. `quizverse_session_hint`を確認する
2. 同時実行中のrefresh Promiseがあれば共有する
3. なければ`POST /api/auth/refresh`を1回実行する
4. refresh成功後、元のAPIを1回だけ再試行する
5. refresh失敗時はユーザー表示キャッシュを削除し、復帰先付きログイン画面へ遷移する

同時に複数APIが401になってもrefresh endpointを多重実行しない。

## クイズ編集との連携

ISSUE-0028で実装した編集中データは`sessionStorage`へ保存される。refreshが成功した場合は画面遷移せず元のPUTを再試行する。refreshも失敗してログイン画面へ遷移した場合は、再認証後にサーバー`updated_at`が一致するときだけ編集中データを復元する。

## 環境変数

- `JWT_ACCESS_TOKEN_EXPIRES_SECONDS`（既定: 900）
- `JWT_REFRESH_TOKEN_EXPIRES_SECONDS`（既定: 2592000）
- `JWT_TOKEN_LOCATION`（既定: `cookies,headers`）
- `JWT_COOKIE_SECURE`（本番: `true`）
- `JWT_COOKIE_SAMESITE`（既定: `Lax`）
- `JWT_COOKIE_DOMAIN`
- `AUTH_EXPOSE_TOKEN_IN_RESPONSE`（本番: `false`）

## セキュリティ境界

- HttpOnlyによりJavaScriptからJWT本体を参照できない
- CSRF二重送信によりCookie認証の状態変更APIを保護する
- logoutもセッション存在時はaccessまたはrefresh用CSRF値を要求する
- access tokenを短命化し、refresh tokenを専用Pathへ限定する
- JWT CookieとCSRF Cookieはサーバー側ライブラリが同一トークンに紐づけて検証する
- `quizverse_session_hint`とユーザー表示キャッシュは認証判定の根拠にせず、最終確認は`GET /api/auth/me`で行う
- Authorizationヘッダー互換は非ブラウザ用途であり、Web画面からは送信しない

## テスト

```bash
cd backend && PYTHONPATH=. pytest
npm --prefix frontend test
npm --prefix frontend run build
```

確認項目:

- login / registerでHttpOnly access・refresh Cookieが設定される
- CSRF CookieとセッションヒントはJavaScriptから参照できる
- 本番レスポンスにJWT文字列を含めない
- Cookieだけで`GET /api/auth/me`を利用できる
- CSRFヘッダーなしの保護POSTを拒否する
- 正しいCSRFヘッダー付きPOSTを許可する
- refreshで新しいaccess Cookieを発行する
- セッション中のlogoutはCSRFなしを拒否する
- access Cookie消失後はrefresh用CSRFでlogoutできる
- セッションなしのlogoutは冪等成功する
- logoutでCookieを削除する
- `localStorage`へJWTを保存しない
- 状態変更リクエストへCSRFヘッダーを付ける
- 同時401でrefreshを1回だけ実行する
- refresh失敗時に復帰先付きログインへ遷移する

## CI確認結果

最新headの実測値をPRマージ前に更新する。

## 対象外

- refresh tokenのDB永続化
- token blocklist / Redis
- 端末・セッション一覧
- デバイス単位の強制ログアウト
- Google OAuth認可コードフローへの変更
- Authorizationヘッダー互換の廃止

## 関連

- GitHub Issue #30
- GitHub PR #31
- `backend/app/api/auth_session.py`
- `frontend/src/public/api.js`
