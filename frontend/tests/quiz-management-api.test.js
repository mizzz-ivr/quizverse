import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import { publicApi } from '../src/public/api.js'

let requests

function createLocalStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  }
}

beforeEach(() => {
  requests = []
  globalThis.localStorage = createLocalStorage()
  globalThis.sessionStorage = createLocalStorage()
  globalThis.window = {
    location: {
      origin: 'http://localhost:5173',
      pathname: '/my/quizzes',
      search: '',
      assign: () => {},
      reload: () => {},
    },
  }
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options })
    if (path.startsWith('/api/me/quizzes?')) {
      return jsonResponse({ items: [], pagination: { total: 0, total_pages: 0 } })
    }
    if (path === '/api/me/quizzes/7/status') {
      return jsonResponse({ quiz: { id: '7', status: 'published' } })
    }
    return jsonResponse({ quiz: { id: '7', status: 'draft' } })
  }
})

afterEach(() => {
  delete globalThis.fetch
  delete globalThis.localStorage
  delete globalThis.sessionStorage
  delete globalThis.window
})

test('マイクイズAPIへ状態フィルターとJWTを付けてGETする', async () => {
  await publicApi.myQuizzes({ status: 'draft', page: 2, perPage: 12 }, 'access-token')

  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, '/api/me/quizzes?status=draft&page=2&per_page=12')
  assert.equal(requests[0].options.method, 'GET')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer access-token')
})

test('クイズ状態更新APIへPATCHで状態を送信する', async () => {
  const payload = await publicApi.updateQuizStatus('7', 'published', 'access-token')

  assert.equal(payload.quiz.status, 'published')
  assert.equal(requests[0].path, '/api/me/quizzes/7/status')
  assert.equal(requests[0].options.method, 'PATCH')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer access-token')
  assert.deepEqual(JSON.parse(requests[0].options.body), { status: 'published' })
})

test('公開クイズ詳細はJWTなしで取得する', async () => {
  await publicApi.quiz('7')

  assert.equal(requests[0].path, '/api/quizzes/7')
  assert.equal(requests[0].options.headers.Authorization, undefined)
})

test('作成者プレビューでは明示したJWTを送信する', async () => {
  await publicApi.quiz('7', 'owner-token')

  assert.equal(requests[0].path, '/api/quizzes/7')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer owner-token')
})
