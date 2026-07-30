import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

const LOCK_NAME = 'quizverse-auth-cookie-mutation'
let originalNavigatorDescriptor
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
  return {
    request(name, options, callback) {
      const previous = tails.get(name) ?? Promise.resolve()
      const run = previous.then(() => callback({ name, mode: options?.mode }))
      tails.set(name, run.catch(() => undefined))
      return run
    },
  }
}

async function importApiTab(label) {
  moduleSequence += 1
  return import(`../src/public/api.js?edge-${label}-${moduleSequence}-${Date.now()}`)
}

function installNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value,
  })
}

beforeEach(() => {
  originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
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

test('logout後にロックを取得した遅延refreshはsession hint消失を検出して送信しない', async () => {
  const lockManager = createLockManager()
  installNavigator({ locks: lockManager })
  document.cookie = [
    'quizverse_session_hint=1',
    'quizverse_csrf_access=access-csrf',
    'quizverse_csrf_refresh=refresh-csrf',
  ].join('; ')

  const logoutTab = await importApiTab('logout-first')
  const refreshTab = await importApiTab('queued-refresh')
  refreshTab.saveSession({ user: { id: 1, display_name: 'Queued User' } }, { redirect: false })

  const blocker = deferred()
  const lockStarted = deferred()
  const heldLock = lockManager.request(
    LOCK_NAME,
    { mode: 'exclusive' },
    async () => {
      lockStarted.resolve()
      await blocker.promise
    },
  )
  await lockStarted.promise

  let refreshCalls = 0
  let logoutCalls = 0
  globalThis.fetch = async (path) => {
    if (path === '/api/auth/me') {
      return jsonResponse(401, {
        error: { code: 'auth/token_expired', message: 'Token expired' },
      })
    }
    if (path === '/api/auth/logout') {
      logoutCalls += 1
      document.cookie = ''
      return jsonResponse(200, { status: 'logged_out' })
    }
    if (path === '/api/auth/refresh') {
      refreshCalls += 1
      return jsonResponse(200, {
        status: 'refreshed',
        user: { id: 1, display_name: 'Queued User' },
      })
    }
    throw new Error(`unexpected path: ${path}`)
  }

  const logoutRequest = logoutTab.clearSession()
  const protectedRequest = refreshTab.publicApi.me()
  await nextMicrotask()

  blocker.resolve()
  await heldLock
  await Promise.allSettled([logoutRequest, protectedRequest])

  assert.equal(refreshCalls, 0)
  assert.ok(logoutCalls >= 1)
  assert.equal(localStorage.getItem('quizverse_user'), null)
})

test('Web Locks API非対応時も同一タブloginは進行中refresh完了後に実行する', async () => {
  installNavigator({})
  document.cookie = [
    'quizverse_session_hint=1',
    'quizverse_csrf_access=access-csrf',
    'quizverse_csrf_refresh=refresh-csrf',
  ].join('; ')

  const apiTab = await importApiTab('fallback')
  apiTab.saveSession({ user: { id: 1, display_name: 'Fallback User' } }, { redirect: false })

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
      return jsonResponse(200, { user: { id: 1, display_name: 'Fallback User' } })
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
        user: { id: 2, display_name: 'Fallback Login' },
      })
    }
    throw new Error(`unexpected path: ${path}`)
  }

  const protectedRequest = apiTab.publicApi.me()
  await refreshStarted.promise
  const loginRequest = apiTab.publicApi.login({
    email: 'fallback@example.com',
    password: 'safePassword123',
  })

  await nextMicrotask()
  assert.deepEqual(sequence, ['refresh-request'])

  refreshResponse.resolve(jsonResponse(200, {
    status: 'refreshed',
    user: { id: 1, display_name: 'Fallback User' },
  }))

  const [loginPayload] = await Promise.all([loginRequest, protectedRequest])

  assert.deepEqual(sequence, ['refresh-request', 'login-request'])
  assert.equal(loginPayload.user.display_name, 'Fallback Login')
})
