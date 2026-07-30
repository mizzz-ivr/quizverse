import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

let originalNavigatorDescriptor
let lockManager
let moduleSequence = 0

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

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function nextMicrotask() {
  await new Promise((resolve) => queueMicrotask(resolve))
}

function createLockManager() {
  const tails = new Map()
  const requests = []

  return {
    requests,
    request(name, options, callback) {
      requests.push({ name, mode: options?.mode })
      const previous = tails.get(name) ?? Promise.resolve()
      const run = previous.then(() => callback({ name, mode: options?.mode }))
      tails.set(name, run.catch(() => undefined))
      return run
    },
  }
}

async function importApiTab(label) {
  moduleSequence += 1
  return import(`../src/public/api.js?${label}-${moduleSequence}-${Date.now()}`)
}

beforeEach(() => {
  originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  lockManager = createLockManager()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { locks: lockManager },
  })

  globalThis.localStorage = createStorage()
  globalThis.sessionStorage = createStorage()
  globalThis.document = { cookie: '' }
  globalThis.window = {
    location: {
      origin: 'http://localhost:5173',
      pathname: '/quizzes/1',
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
  delete globalThis.sessionStorage
  delete globalThis.window

  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
  } else {
    delete globalThis.navigator
  }
})

test('別タブのlogoutは進行中refreshの完了後にCookie削除を実行する', async () => {
  document.cookie = [
    'quizverse_session_hint=1',
    'quizverse_csrf_access=access-csrf',
    'quizverse_csrf_refresh=refresh-csrf',
  ].join('; ')

  const refreshTab = await importApiTab('refresh-tab')
  const logoutTab = await importApiTab('logout-tab')
  refreshTab.saveSession({ user: { id: 1, display_name: 'Cross Tab User' } }, { redirect: false })

  const refreshResponse = deferred()
  const refreshStarted = deferred()
  const sequence = []
  let meCalls = 0

  globalThis.fetch = async (path) => {
    if (path === '/api/auth/me') {
      meCalls += 1
      if (meCalls === 1) {
        return jsonResponse(401, {
          error: { code: 'auth/token_expired', message: 'Token expired' },
        })
      }
      return jsonResponse(200, { user: { id: 1, display_name: 'Cross Tab User' } })
    }
    if (path === '/api/auth/refresh') {
      sequence.push('refresh-request')
      refreshStarted.resolve()
      return refreshResponse.promise
    }
    if (path === '/api/auth/logout') {
      sequence.push('logout-request')
      document.cookie = ''
      return jsonResponse(200, { status: 'logged_out' })
    }
    throw new Error(`unexpected path: ${path}`)
  }

  const protectedRequest = refreshTab.publicApi.me()
  await refreshStarted.promise

  const logoutRequest = logoutTab.clearSession()
  await nextMicrotask()
  assert.deepEqual(sequence, ['refresh-request'])

  refreshResponse.resolve(jsonResponse(200, {
    status: 'refreshed',
    user: { id: 1, display_name: 'Cross Tab User' },
  }))

  const [, logoutResult] = await Promise.allSettled([protectedRequest, logoutRequest])

  assert.equal(logoutResult.status, 'fulfilled')
  assert.deepEqual(sequence, ['refresh-request', 'logout-request'])
  assert.equal(localStorage.getItem('quizverse_user'), null)
  assert.ok(lockManager.requests.length >= 2)
  assert.ok(lockManager.requests.every(({ name }) => name === 'quizverse-auth-cookie-mutation'))
  assert.ok(lockManager.requests.every(({ mode }) => mode === 'exclusive'))
})

test('別タブのloginは進行中refreshが終わるまで認証Cookieを更新しない', async () => {
  document.cookie = [
    'quizverse_session_hint=1',
    'quizverse_csrf_access=access-csrf',
    'quizverse_csrf_refresh=refresh-csrf',
  ].join('; ')

  const refreshTab = await importApiTab('old-session-tab')
  const loginTab = await importApiTab('login-tab')
  refreshTab.saveSession({ user: { id: 1, display_name: 'Old User' } }, { redirect: false })

  const refreshResponse = deferred()
  const refreshStarted = deferred()
  const sequence = []
  let meCalls = 0

  globalThis.fetch = async (path) => {
    if (path === '/api/auth/me') {
      meCalls += 1
      if (meCalls === 1) {
        return jsonResponse(401, {
          error: { code: 'auth/token_expired', message: 'Token expired' },
        })
      }
      return jsonResponse(200, { user: { id: 1, display_name: 'Old User' } })
    }
    if (path === '/api/auth/refresh') {
      sequence.push('refresh-request')
      refreshStarted.resolve()
      return refreshResponse.promise
    }
    if (path === '/api/auth/login') {
      sequence.push('login-request')
      return jsonResponse(200, {
        token_type: 'Cookie',
        user: { id: 2, display_name: 'New User' },
      })
    }
    throw new Error(`unexpected path: ${path}`)
  }

  const protectedRequest = refreshTab.publicApi.me()
  await refreshStarted.promise

  const loginRequest = loginTab.publicApi.login({
    email: 'new-user@example.com',
    password: 'safePassword123',
  })
  await nextMicrotask()
  assert.deepEqual(sequence, ['refresh-request'])

  refreshResponse.resolve(jsonResponse(200, {
    status: 'refreshed',
    user: { id: 1, display_name: 'Old User' },
  }))

  const [loginPayload] = await Promise.all([
    loginRequest,
    protectedRequest.catch(() => null),
  ])

  assert.deepEqual(sequence, ['refresh-request', 'login-request'])
  assert.equal(loginPayload.user.display_name, 'New User')
})

test('registerも同じ認証Cookieロックの解放後に実行する', async () => {
  const registerTab = await importApiTab('register-tab')
  const blocker = deferred()
  const lockStarted = deferred()
  const sequence = []

  const heldLock = lockManager.request(
    'quizverse-auth-cookie-mutation',
    { mode: 'exclusive' },
    async () => {
      sequence.push('external-lock')
      lockStarted.resolve()
      await blocker.promise
    },
  )
  await lockStarted.promise

  globalThis.fetch = async (path) => {
    if (path === '/api/auth/register') {
      sequence.push('register-request')
      return jsonResponse(201, {
        token_type: 'Cookie',
        user: { id: 3, display_name: 'Registered User' },
      })
    }
    throw new Error(`unexpected path: ${path}`)
  }

  const registration = registerTab.publicApi.register({
    email: 'registered@example.com',
    password: 'safePassword123',
    display_name: 'Registered User',
  })
  await nextMicrotask()
  assert.deepEqual(sequence, ['external-lock'])

  blocker.resolve()
  await heldLock
  const payload = await registration

  assert.deepEqual(sequence, ['external-lock', 'register-request'])
  assert.equal(payload.user.display_name, 'Registered User')
})
