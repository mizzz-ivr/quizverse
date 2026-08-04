import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import { adminApi } from '../src/adminApi.js'
import { ApiError } from '../src/public/api.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

beforeEach(() => {
  globalThis.localStorage = createStorage()
  globalThis.document = {
    cookie: 'quizverse_session_hint=1; quizverse_csrf_access=admin-csrf',
  }
  globalThis.window = {
    location: {
      origin: 'http://localhost:5173',
      pathname: '/admin',
      search: '',
      assign: () => {},
      reload: () => {},
    },
  }
})

afterEach(() => {
  delete globalThis.fetch
  delete globalThis.document
  delete globalThis.localStorage
  delete globalThis.window
})

test('管理APIはCookie資格情報を使い仮管理者ヘッダーを送らない', async () => {
  const calls = []
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options })
    if (path === '/api/auth/me') {
      return response(200, { user: { id: '1', display_name: 'Admin' } })
    }
    return response(200, { user: { id: '1', role: 'admin' } })
  }

  const payload = await adminApi.session()

  assert.equal(payload.user.role, 'admin')
  const adminCall = calls.find((call) => call.path === '/api/admin/session')
  assert.equal(adminCall.options.credentials, 'same-origin')
  assert.equal(adminCall.options.headers['X-Admin-Mode'], undefined)
  assert.equal(adminCall.options.headers.Authorization, undefined)
})

test('管理設定の更新へaccess CSRFヘッダーを付与する', async () => {
  const calls = []
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options })
    if (path === '/api/auth/me') {
      return response(200, { user: { id: '1', display_name: 'Admin' } })
    }
    return response(200, { email_settings: {}, meta: { permission: 'rbac' } })
  }

  await adminApi.updateEmailSettings({ sender_name: 'QuizVerse' })

  const updateCall = calls.find((call) => call.path === '/api/admin/email-settings')
  assert.equal(updateCall.options.method, 'PUT')
  assert.equal(updateCall.options.credentials, 'same-origin')
  assert.equal(updateCall.options.headers['X-CSRF-TOKEN'], 'admin-csrf')
  assert.equal(updateCall.options.headers['X-Admin-Mode'], undefined)
})

test('管理ユーザー一覧へ検索・ロール・状態フィルターを送信する', async () => {
  const calls = []
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options })
    if (path === '/api/auth/me') {
      return response(200, { user: { id: '1', display_name: 'Admin' } })
    }
    return response(200, { items: [], pagination: { total: 0 } })
  }

  await adminApi.users({ page: 2, perPage: 10, q: 'alice', role: 'admin', status: 'active' })

  const call = calls.find((item) => item.path.startsWith('/api/admin/users?'))
  assert.ok(call)
  const url = new URL(call.path, 'http://localhost:5173')
  assert.equal(url.searchParams.get('page'), '2')
  assert.equal(url.searchParams.get('per_page'), '10')
  assert.equal(url.searchParams.get('q'), 'alice')
  assert.equal(url.searchParams.get('role'), 'admin')
  assert.equal(url.searchParams.get('status'), 'active')
  assert.equal(call.options.credentials, 'same-origin')
})

test('ロールと状態更新はPATCH・Cookie・CSRFで送信する', async () => {
  const calls = []
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options })
    if (path === '/api/auth/me') {
      return response(200, { user: { id: '1', display_name: 'Admin' } })
    }
    return response(200, { user: { id: '2' }, meta: { changed: true } })
  }

  await adminApi.updateUserRole('2', 'admin')
  await adminApi.updateUserStatus('2', 'suspended')

  const roleCall = calls.find((item) => item.path === '/api/admin/users/2/role')
  const statusCall = calls.find((item) => item.path === '/api/admin/users/2/status')
  for (const call of [roleCall, statusCall]) {
    assert.equal(call.options.method, 'PATCH')
    assert.equal(call.options.credentials, 'same-origin')
    assert.equal(call.options.headers['X-CSRF-TOKEN'], 'admin-csrf')
    assert.equal(call.options.headers.Authorization, undefined)
  }
  assert.deepEqual(JSON.parse(roleCall.options.body), { role: 'admin' })
  assert.deepEqual(JSON.parse(statusCall.options.body), { status: 'suspended' })
})

test('一般ユーザーの403をApiErrorとして返す', async () => {
  globalThis.fetch = async (path) => {
    if (path === '/api/auth/me') {
      return response(200, { user: { id: '2', display_name: 'Member' } })
    }
    return response(403, {
      error: { code: 'admin/forbidden', message: 'Admin role is required.' },
    })
  }

  await assert.rejects(
    () => adminApi.session(),
    (error) => error instanceof ApiError
      && error.status === 403
      && error.code === 'admin/forbidden',
  )
})