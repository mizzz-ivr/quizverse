# ISSUE-0030: HttpOnly Cookieとrefresh tokenによる認証セッションへ移行する

## 背景

一般ユーザー向けフロントエンドはJWTアクセストークンを`localStorage`へ保存し、保護APIへ`Authorization: Bearer`として送信していた。XSS時のトークン窃取リスクを下げ、短命access tokenの期限切れ時にも編集中データを維持するため、ブラウザ認証をHttpOnly Cookieへ移行する。

## 認証方式

### ブラウザ

- access tokenとrefresh tokenはHttpOnly Cookieへ保存する
- JWT本体をJavaScriptや`localStorage`へ保存しない
- `localStorage`には表示用ユーザー情報だけを保存する
- API通信は`credentials: same-origin`を利用する
- 状態変更APIではCSRF Cookieを`X-CSRF-TOKEN`へ複写する
- access token期限切れ時はrefresh後に元のAPIを1回だけ再試行する

### 非ブラウザAPIクライアント

- `JWT_TOKEN_LOCATION=headers,cookies`とし、明示されたBearer tokenをCookieより優先する
- `Origin`と`Referer`がない認証リクエストはAPIクライアントとして扱い、既存Bearerレスポンスを維持する
- 一般ユーザー向けWeb画面はAuthorizationヘッダーを送信しない

## Origin境界

Cookieセッションを発行するブラウザ認証リクエストは、リクエスト処理前にOriginまたはRefererを検証する。

- リクエスト自身のOrigin
- `AUTH_TRUSTED_ORIGINS`で明示したフロントエンドOrigin

不正Originは`auth/untrusted_origin`の403で拒否し、登録・GoogleログインなどのDB更新処理へ到達させない。Originなしの非ブラウザクライアントにはCookieを発行しない。

## Cookie

| Cookie | HttpOnly | Path | 用途 |
| --- | --- | --- | --- |
| `quizverse_access_token` | Yes | `/` | 短命access token |
| `quizverse_refresh_token` | Yes | `/api/auth/refresh` | refresh token |
| `quizverse_csrf_access` | No | `/` | access token用CSRF値 |
| `quizverse_csrf_refresh` | No | `/` | refresh token用CSRF値 |
| `quizverse_session_hint` | No | `/` | JWTを含まないセッション候補のヒント |

Production / Previewでは`JWT_COOKIE_SECURE=true`を設定し、既定のSameSiteは`Lax`とする。

## API

### 認証成功

同一Originまたは許可Originから次のエンドポイントが成功した場合、access / refresh CookieとCSRF Cookieを設定する。

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`

ブラウザ向け本番レスポンスはJWT文字列をJSONへ含めず、`token_type: Cookie`とユーザー情報を返す。

### `POST /api/auth/refresh`

refresh Cookieと`quizverse_csrf_refresh`を検証し、新しいaccess Cookieを発行する。複数APIが同時に401となった場合、フロントエンドは1つのrefresh Promiseを共有する。先行refresh完了後に遅れて返った401は、二重refreshせず元リクエストだけを再試行する。

### `POST /api/auth/logout`

- access / refresh / CSRF Cookieとセッションヒントを削除する
- access tokenが失効していても実行できる
- セッションCookieがある場合はaccessまたはrefresh用CSRF値を要求する
- refresh処理中の明示logoutはrefresh完了後に実行し、Cookie削除を最後の更新にする
- サーバーlogout成功後だけ画面をログアウト状態へ切り替える
- logout失敗時は表示中セッションを維持し、再試行可能な日本語エラーを表示する

## フロントエンド

### セッション保存

- 旧`quizverse_access_token`キーは全Reactルートの起動前、ログイン、ログアウト時に削除する
- `quizverse_session_hint`は認証の根拠にせず、`GET /api/auth/me`で確定する
- 明示logoutと自動認証失効処理を分離する

### クイズ詳細

ログイン候補がある場合、クイズ詳細画面の描画前に`GET /api/auth/me`を実行する。access Cookieが失効していればrefreshしてから詳細を取得するため、本人所有の下書きプレビューが匿名404にならない。

### クイズ編集

ISSUE-0028の編集中データは`sessionStorage`へ保存する。refresh成功時は画面遷移せず元のPUTを再試行し、refresh失敗後の再認証ではサーバー`updated_at`が一致する場合だけ復元する。

## 環境変数

- `JWT_ACCESS_TOKEN_EXPIRES_SECONDS`（既定: 900）
- `JWT_REFRESH_TOKEN_EXPIRES_SECONDS`（既定: 2592000）
- `JWT_TOKEN_LOCATION`（既定: `headers,cookies`）
- `JWT_COOKIE_SECURE`（本番: `true`）
- `JWT_COOKIE_SAMESITE`（既定: `Lax`）
- `JWT_COOKIE_DOMAIN`
- `AUTH_TRUSTED_ORIGINS`
- `AUTH_EXPOSE_TOKEN_IN_RESPONSE`（本番: `false`）

`.env.example`へ設定例を追加し、`docker-compose.yml`のbackend serviceへ明示転送する。設定漏れとBearer優先順はバックエンドテストで固定する。

## セキュリティ境界

- HttpOnlyによりJavaScriptからJWT本体を参照できない
- CSRF二重送信によりCookie認証の状態変更APIを保護する
- 認証Originをハンドラー実行前に検証する
- Bearer tokenをCookieより優先し、APIクライアントの主体混同を防ぐ
- access tokenを短命化し、refresh tokenを専用Pathへ限定する
- refreshとlogoutを直列化し、logout後のCookie再発行を防ぐ

## テスト

```bash
cd backend && PYTHONPATH=. pytest
npm --prefix frontend test
npm --prefix frontend run build
```

主な確認項目:

- HttpOnly access / refresh Cookie
- Cookie認証のCSRF拒否・許可
- 不正OriginをDB更新前に拒否
- OriginなしAPIクライアントのBearer互換
- Cookie併存時のBearer優先
- 同時401と遅延401のrefresh集約
- refresh中logoutの直列化
- logout失敗時の表示セッション維持
- 全ルートでの旧JWT削除
- 下書き詳細表示前のセッションrefresh
- Docker Composeの環境変数転送

## CI確認結果

- フロントエンドテスト: `44 passed, 0 failed`
- バックエンドテスト: `88 passed, 4 warnings`（9.76秒）
- Production Build: 成功
  - JavaScript: 272.39 kB（gzip 75.29 kB）
  - CSS: 43.14 kB（gzip 7.31 kB）
  - build: 1.46秒

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
- `backend/app/api/auth_origin_guard.py`
- `frontend/src/public/api.js`
- `frontend/src/public/QuizDetailSessionGate.jsx`
