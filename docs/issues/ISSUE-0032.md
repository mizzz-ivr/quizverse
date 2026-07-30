# ISSUE-0032: 複数タブ間の認証Cookie更新を排他制御する

## 背景

ISSUE-0030で、一般ユーザー向けブラウザ認証をHttpOnly Cookie＋refresh token方式へ移行した。

同一タブ内では`refreshPromise`と`logoutPromise`を共有していたが、JavaScriptモジュールの状態はタブごとに独立する。そのため、別タブで次の競合が発生する可能性が残っていた。

- タブAのrefreshレスポンスが、タブBのlogout後に到着してaccess Cookieとセッションヒントを再発行する
- 古いセッションのrefresh中に別タブでlogin／registerし、遅延refreshが新しい認証Cookieを上書きする

## 方針

認証Cookieを書き換える処理を、Web Locks APIの同一Origin共有ロックへ集約する。

ロック名:

```text
quizverse-auth-cookie-mutation
```

対象処理:

- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/google`

すべて`mode: exclusive`で実行し、同一Originの複数タブ・ウィンドウ・Worker間で認証Cookie更新を直列化する。

## refresh

refreshは共有ロック取得後に、次の状態を再確認する。

1. 同一タブでlogoutが開始されていない
2. リクエスト開始時の`sessionRevision`と現在値が一致する
3. `quizverse_session_hint=1`がまだ存在する

別タブのlogout待ちになったrefreshは、ロック取得後にセッションヒントが削除済みであることを検出し、refresh APIを送信しない。

## logout

logoutも共有ロック内で実行する。

- 先行refreshがロックを保持している場合は、その完了後にlogoutを実行する
- logoutレスポンスを最後のCookie更新にする
- サーバーlogout成功後にだけローカルのユーザー表示キャッシュを削除する
- logout失敗時は表示キャッシュを残し、再試行可能にする

Web Locks APIが利用できない環境では、既存の`refreshPromise`待機を利用して同一タブ内の順序を維持する。

## login / register / Google login

認証成功時にaccess／refresh Cookieを発行するため、sign-in系APIも同じ共有ロック内で実行する。

これにより、古いセッションのrefreshが進行中の場合は、refresh完了後に新しいsign-in Cookieを発行し、新しいログイン結果を最終状態にする。

Web Locks APIが利用できない環境では、同一タブのrefresh／logout Promiseを待ってからsign-in APIを送信する。

## 認証失敗時の無効化

refresh失敗などでセッションを無効化する場合も、共通の`clearSession`経路を利用する。

Cookie削除が別タブのrefreshやsign-inと競合しないよう、同じ共有ロックを通す。

## フォールバック

Web Locks APIが存在しない場合は、コールバックを直接実行する。

その場合も次の既存制御を維持する。

- 同時401のrefresh Promise共有
- logout前のrefresh待機
- sign-in前のrefresh／logout待機
- `sessionRevision`による遅延レスポンス判定

## テスト

`frontend/tests/cross-tab-auth-lock.test.js`では、クエリ文字列付きdynamic importで`api.js`を複数回読み込み、別タブの独立したモジュール状態を再現する。

共有Web Locksモックを利用し、次を確認する。

- 別タブのlogoutは進行中refreshの後に実行される
- 別タブのloginは進行中refreshの後に実行される
- registerも同じ認証Cookieロックを利用する
- すべて同じロック名と`exclusive`モードを利用する
- logout完了後にローカル表示キャッシュが削除される

実行コマンド:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

## 対象外

- Web Locks API非対応ブラウザ間での完全な複数タブ排他
- refresh tokenのDB永続化
- token rotation
- Redis blocklist
- BroadcastChannelによる画面状態同期
- 端末・セッション一覧

## 関連

- GitHub Issue #32
- GitHub PR #33
- ISSUE-0030
- `frontend/src/public/api.js`
- `frontend/tests/cross-tab-auth-lock.test.js`
