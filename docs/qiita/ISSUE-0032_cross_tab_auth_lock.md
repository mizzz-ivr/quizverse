# Web Locks APIで複数タブの認証Cookie競合を防ぐ

## はじめに

QuizVerseでは、ブラウザ認証をHttpOnly Cookie＋refresh token方式へ移行しました。

同一タブ内では`refreshPromise`や`logoutPromise`を共有することで、同時401やlogoutとの競合を防げます。しかし、ブラウザのタブごとにJavaScriptモジュールは別インスタンスとして動作するため、Promiseだけでは別タブ間の競合を防げません。

今回は、Web Locks APIを利用して認証Cookieを書き換える処理を同一Origin全体で直列化しました。

## 発生する競合

### refresh後にlogoutが負ける

1. タブAでaccess tokenが期限切れになる
2. タブAがrefresh APIを送信する
3. タブBでユーザーがlogoutする
4. logoutレスポンスがCookieを削除する
5. 遅れてrefreshレスポンスが到着し、access Cookieを再発行する

見た目上はログアウトしていても、再読み込みすると再び認証済みになる可能性があります。

### 新しいloginが古いrefreshに上書きされる

1. 古いアカウントのrefreshが進行する
2. 別タブで新しいアカウントへloginする
3. loginレスポンスが新しいCookieを発行する
4. 遅延refreshが古いアカウントのaccess Cookieを上書きする

画面表示と実際の認証ユーザーが一致しない危険な状態になります。

## Web Locks APIを利用する

認証Cookieを書き換えるすべての処理で、同じロック名を使います。

```js
const AUTH_COOKIE_LOCK_NAME = 'quizverse-auth-cookie-mutation'

function webLocksAvailable() {
  return typeof navigator !== 'undefined'
    && typeof navigator.locks?.request === 'function'
}

async function withAuthCookieLock(callback) {
  if (!webLocksAvailable()) return callback()

  return navigator.locks.request(
    AUTH_COOKIE_LOCK_NAME,
    { mode: 'exclusive' },
    callback,
  )
}
```

対象は次の処理です。

- refresh
- logout
- login
- register
- Google login

同一Originで同じロック名を使うため、別タブの処理も同時には実行されません。

## logoutを最後のCookie更新にする

```js
export function clearSession({ notifyServer = true, requireServerSuccess = true } = {}) {
  if (logoutPromise) return logoutPromise

  const useWebLock = webLocksAvailable()
  logoutPromise = withAuthCookieLock(async () => {
    if (!useWebLock && refreshPromise) {
      try {
        await refreshPromise
      } catch {
        // refresh失敗後もlogoutを続行する
      }
    }

    if (notifyServer) {
      try {
        await performServerLogout()
      } catch (error) {
        if (requireServerSuccess) throw error
      }
    }

    clearLocalSession()
  }).finally(() => {
    logoutPromise = null
  })

  return logoutPromise
}
```

Web Locks API対応ブラウザでは、先行refreshがロックを解放した後にlogoutが実行されます。これにより、logoutレスポンスが最後のCookie更新になります。

非対応環境では、既存の`refreshPromise`待機へフォールバックします。

## refreshはロック取得後に再確認する

ロック待機中に別タブでlogoutされる可能性があるため、refresh APIを送信する直前に状態を再確認します。

```js
refreshPromise = withAuthCookieLock(async () => {
  if (logoutPromise) throw new ApiError('Logout is in progress.', 401)
  if (expectedRevision !== sessionRevision) return null
  if (!hasSessionHint()) {
    throw new ApiError('Refresh session is unavailable.', 401)
  }

  return fetchJson('/api/auth/refresh', { method: 'POST' })
})
```

特に`quizverse_session_hint`をロック取得後に確認することで、logout後に待機していたrefreshを送信しません。

## sign-inも同じロックへ入れる

loginやregisterも認証Cookieを発行するため、refreshと同じ排他境界へ含めます。

```js
async function signInRequest(path, values) {
  return withAuthCookieLock(async () => {
    const { response, payload } = await fetchJson(path, {
      method: 'POST',
      body: values,
    })

    if (!response.ok) throw createApiError(response, payload)
    return payload
  })
}
```

古いrefreshが実行中なら、その完了後に新しいlogin Cookieが発行されるため、新しい認証結果が最終状態になります。

## 別タブをテストで再現する

同じモジュールを通常importすると、Node.jsのモジュールキャッシュによって状態が共有されます。

クエリ文字列を変えたdynamic importを利用すると、独立したモジュールインスタンスとして読み込めます。

```js
async function importApiTab(label) {
  return import(`../src/public/api.js?${label}-${Date.now()}`)
}

const refreshTab = await importApiTab('refresh-tab')
const logoutTab = await importApiTab('logout-tab')
```

それぞれのモジュールは別の`refreshPromise`／`logoutPromise`を持ちますが、`navigator.locks`のモックは共有します。

これにより、同一タブPromiseでは検出できない複数タブ競合を回帰テストできます。

## フォールバックについて

Web Locks APIが利用できない場合、完全な複数タブ排他は行えません。

その場合も次の同一タブ制御は維持します。

- 同時401のrefresh共有
- logout前のrefresh待機
- sign-in前のrefresh／logout待機
- session revisionによる遅延レスポンス判定

より広い互換性が必要な場合は、BroadcastChannelとリーダー選出、またはサーバー側のrefresh token rotation・blocklistを組み合わせる方法があります。

## まとめ

HttpOnly Cookieへ移行しても、複数タブからCookieを更新する場合はレスポンス到着順による競合を考慮する必要があります。

Web Locks APIを利用すると、同一Originの複数タブをまたいで、refresh・logout・sign-inをシンプルに直列化できます。

今回のポイントは次の3つです。

- 認証Cookieを書き換える処理を同じ排他ロックへ集約する
- ロック取得後にsession hintなどを再確認する
- テストではモジュールを複数回読み込み、別タブの独立状態を再現する
