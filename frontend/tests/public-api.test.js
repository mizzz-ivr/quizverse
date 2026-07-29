import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import { ApiError, publicApi, saveSession } from '../src/public/api.js'

let assignedPath
let reloadCount

function createLocalStorage() {
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
  globalThis.localStorage = createLocalStorage()
  globalThis.window = {
    location: {
      origin: 'http://localhost:5173',
      pathname: '/quizzes/1',
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
  delete globalThis.localStorage
  delete globalThis.window
})

test('認証付きリクエストが401の場合は保存セッションを破棄してログインへ遷移する', async () => {
  saveSession({
    access_token: 'expired-token',
    user: { id: 1, display_name: 'Expired User' },
  })
  globalThis.fetch = async () => jsonResponse(401, {
    error: { code: 'auth/invalid_token', message: 'Token expired' },
  })

  await assert.rejects(
    () => publicApi.me('expired-token'),
    (error) => error instanceof ApiError && error.status === 401,
  )

  assert.equal(localStorage.getItem('quizverse_access_token'), null)
  assert.equal(localStorage.getItem('quizverse_user'), null)
  assert.equal(assignedPath, '/login')
  assert.equal(reloadCount, 0)
})

test('ログイン画面上で現在のセッションが401になった場合は再読み込みする', async () => {
  globalThis.window.location.pathname = '/login'
  saveSession({
    access_token: 'expired-token',
    user: { id: 1, display_name: 'Expired User' },
  })
  globalThis.fetch = async () => jsonResponse(401, {
    error: { code: 'auth/invalid_token', message: 'Token expired' },
  })

  await assert.rejects(
    () => publicApi.me('expired-token'),
    (error) => error instanceof ApiError && error.status === 401,
  )

  assert.equal(localStorage.getItem('quizverse_access_token'), null)
  assert.equal(assignedPath, null)
  assert.equal(reloadCount, 1)
})

test('古いリクエストの401では後から保存された新しいセッションを破棄しない', async () => {
  saveSession({
    access_token: 'new-token',
    user: { id: 2, display_name: 'New User' },
  })
  globalThis.fetch = async () => jsonResponse(401, {
    error: { code: 'auth/invalid_token', message: 'Old token expired' },
  })

  await assert.rejects(
    () => publicApi.me('old-token'),
    (error) => error instanceof ApiError && error.status === 401,
  )

  assert.equal(localStorage.getItem('quizverse_access_token'), 'new-token')
  assert.equal(JSON.parse(localStorage.getItem('quizverse_user')).display_name, 'New User')
  assert.equal(assignedPath, null)
  assert.equal(reloadCount, 0)
})

test('ログイン失敗の401ではセッション失効リダイレクトを実行しない', async () => {
  globalThis.window.location.pathname = '/login'
  globalThis.fetch = async () => jsonResponse(401, {
    error: { code: 'auth/invalid_credentials', message: 'Invalid credentials' },
  })

  await assert.rejects(
    () => publicApi.login({ email: 'user@example.com', password: 'wrong' }),
    (error) => error instanceof ApiError && error.code === 'auth/invalid_credentials',
  )

  assert.equal(assignedPath, null)
  assert.equal(reloadCount, 0)
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
