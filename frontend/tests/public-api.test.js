import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import {
  ApiError,
  clearSession,
  getStoredSession,
  publicApi,
  saveSession,
} from '../src/public/api.js'

let assignedPath
let reloadCount

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  }
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

beforeEach(() => {
  assignedPath = null
  reloadCount = 0
  globalThis.localStorage = createStorage()
  globalThis.sessionStorage = createStorage()
  globalThis.document = { cookie: '' }
  globalThis.window = {
    location: {
      origin: 'http://localhost:5173',
      pathname: '/quizzes/1',
      search: '',
      assign: (path) => {
        assignedPath = path
      },
      reload: () => {
        reloadCount += 1
      },
    },
  }
})

afterEach(() => {
  delete globalThis.fetch
  delete globalThis.document
  delete globalThis.localStorage
  delete globalThis.sessionStorage
  delete globalThis.window
})

test('セッション保存時にJWT文字列をlocalStorageへ保存しない', () => {
  document.cookie = 'quizverse_session_hint=1'

  const session = saveSession({
    access_token: 'must-not-be-stored',
    user: { id: 1, display_name: 'Cookie User' },
  })

  assert.equal(localStorage.getItem('quizverse_access_token'), null)
  assert.equal(JSON.parse(localStorage.getItem('quizverse_user')).display_name, 'Cookie User')
  assert.equal(session.accessToken, 'cookie-session')
  assert.equal(getStoredSession().accessToken, 'cookie-session')
})

test('セッションヒントCookieがない場合は表示キャッシュを認証状態として扱わない', () => {
  localStorage.setItem('quizverse_user', JSON.stringify({ id: 1, display_name: 'Stale User' }))
  localStorage.setItem('quizverse_access_token', 'legacy-token')

  const session = getStoredSession()

  assert.equal(session, null)
  assert.equal(localStorage.getItem('quizverse_access_token'), null)
  assert.equal(localStorage.getItem('quizverse_user'), null)
})

test('状態変更リクエストへCookie資格情報とaccess CSRFヘッダーを付与する', async () => {
  document.cookie = 'quizverse_session_hint=1; quizverse_csrf_access=access-csrf'
  let captured
  globalThis.fetch = async (path, options) => {
    captured = { path, options }
    return jsonResponse(201, { quiz: { id: 10, title: 'Cookie Quiz' } })
  }

  await publicApi.createQuiz({ title: 'Cookie Quiz', questions: [] }, 'legacy-token')

  assert.equal(captured.path, '/api/quizzes')
  assert.equal(captured.options.credentials, 'same-origin')
  assert.equal(captured.options.headers['X-CSRF-TOKEN'], 'access-csrf')
  assert.equal(captured.options.headers.Authorization, undefined)
})

test('access用CSRFがないlogoutではrefresh用CSRFへフォールバックする', async () => {
  document.cookie = 'quizverse_session_hint=1; quizverse_csrf_refresh=refresh-only-csrf'
  localStorage.setItem('quizverse_user', JSON.stringify({ id: 1, display_name: 'Logout User' }))
  let captured
  globalThis.fetch = async (path, options) => {
    captured = { path, options }
    return jsonResponse(200, { status: 'logged_out' })
  }

  await clearSession()

  assert.equal(captured.path, '/api/auth/logout')
  assert.equal(captured.options.method, 'POST')
  assert.equal(captured.options.credentials, 'same-origin')
  assert.equal(captured.options.headers['X-CSRF-TOKEN'], 'refresh-only-csrf')
  assert.equal(localStorage.getItem('quizverse_user'), null)
})

test('同時401はrefreshリクエストを1回だけ共有して元リクエストを再試行する', async () => {
  document.cookie = [
    'quizverse_session_hint=1',
    'quizverse_csrf_access=access-csrf',
    'quizverse_csrf_refresh=refresh-csrf',
  ].join('; ')
  saveSession({ user: { id: 1, display_name: 'Refresh User' } }, { redirect: false })

  let meCalls = 0
  let refreshCalls = 0
  let refreshOptions
  globalThis.fetch = async (path, options) => {
    if (path === '/api/auth/refresh') {
      refreshCalls += 1
      refreshOptions = options
      await new Promise((resolve) => queueMicrotask(resolve))
      return jsonResponse(200, {
        status: 'refreshed',
        user: { id: 1, display_name: 'Refresh User' },
      })
    }
    if (path === '/api/auth/me') {
      meCalls += 1
      if (meCalls <= 2) {
        return jsonResponse(401, {
          error: { code: 'auth/token_expired', message: 'Token expired' },
        })
      }
      return jsonResponse(200, {
        user: { id: 1, display_name: 'Refresh User' },
      })
    }
    throw new Error(`unexpected path: ${path}`)
  }

  const [first, second] = await Promise.all([publicApi.me(), publicApi.me()])

  assert.equal(first.user.display_name, 'Refresh User')
  assert.equal(second.user.display_name, 'Refresh User')
  assert.equal(refreshCalls, 1)
  assert.equal(meCalls, 4)
  assert.equal(refreshOptions.credentials, 'same-origin')
  assert.equal(refreshOptions.headers['X-CSRF-TOKEN'], 'refresh-csrf')
})

test('refresh失敗時は表示キャッシュを破棄して復帰先付きログインへ遷移する', async () => {
  document.cookie = [
    'quizverse_session_hint=1',
    'quizverse_csrf_access=access-csrf',
    'quizverse_csrf_refresh=refresh-csrf',
  ].join('; ')
  saveSession({ user: { id: 1, display_name: 'Expired User' } }, { redirect: false })

  globalThis.fetch = async (path) => {
    if (path === '/api/auth/me') {
      return jsonResponse(401, {
        error: { code: 'auth/token_expired', message: 'Token expired' },
      })
    }
    if (path === '/api/auth/refresh') {
      return jsonResponse(401, {
        error: { code: 'auth/missing_token', message: 'Refresh expired' },
      })
    }
    if (path === '/api/auth/logout') {
      return jsonResponse(200, { status: 'logged_out' })
    }
    throw new Error(`unexpected path: ${path}`)
  }

  await assert.rejects(
    () => publicApi.me(),
    (error) => error instanceof ApiError && error.status === 401,
  )
  await new Promise((resolve) => queueMicrotask(resolve))

  assert.equal(localStorage.getItem('quizverse_access_token'), null)
  assert.equal(localStorage.getItem('quizverse_user'), null)
  assert.equal(sessionStorage.getItem('quizverse_auth_return_to'), '/quizzes/1')
  assert.equal(assignedPath, '/login?next=%2Fquizzes%2F1')
  assert.equal(reloadCount, 0)
})

test('ログイン失敗の401ではrefreshやセッション失効リダイレクトを実行しない', async () => {
  globalThis.window.location.pathname = '/login'
  let requestCount = 0
  globalThis.fetch = async () => {
    requestCount += 1
    return jsonResponse(401, {
      error: { code: 'auth/invalid_credentials', message: 'Invalid credentials' },
    })
  }

  await assert.rejects(
    () => publicApi.login({ email: 'user@example.com', password: 'wrong' }),
    (error) => error instanceof ApiError && error.code === 'auth/invalid_credentials',
  )

  assert.equal(requestCount, 1)
  assert.equal(assignedPath, null)
  assert.equal(reloadCount, 0)
})

test('ログイン成功後はnextで指定した安全な画面へ復帰する', async () => {
  globalThis.window.location.pathname = '/login'
  globalThis.window.location.search = '?next=%2Fquizzes%2Fnew'

  saveSession({
    user: { id: 2, display_name: 'Creator' },
  })
  await new Promise((resolve) => queueMicrotask(resolve))

  assert.equal(assignedPath, '/quizzes/new')
  assert.equal(sessionStorage.getItem('quizverse_auth_return_to'), null)
})

test('クイズ一覧のdescription_summaryをカード用descriptionへ正規化する', async () => {
  globalThis.fetch = async () => jsonResponse(200, {
    items: [
      {
        id: 1,
        title: 'Summary Quiz',
        description_summary: '一覧に表示する説明文',
      },
      {
        id: 2,
        title: 'Legacy Quiz',
        description: '既存のdescriptionを優先',
        description_summary: '上書きしない説明文',
      },
    ],
    pagination: { page: 1, total: 2, total_pages: 1 },
  })

  const payload = await publicApi.quizzes({ page: 1, perPage: 9 })

  assert.equal(payload.items[0].description, '一覧に表示する説明文')
  assert.equal(payload.items[1].description, '既存のdescriptionを優先')
  assert.equal(payload.items[0].description_summary, '一覧に表示する説明文')
})
