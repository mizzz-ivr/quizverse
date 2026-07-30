import {
  buildAuthPath,
  consumeAuthReturnPath,
  rememberAuthReturnPath,
} from './authNavigation.js'

const LEGACY_TOKEN_KEY = 'quizverse_access_token'
const USER_KEY = 'quizverse_user'
const SESSION_HINT_COOKIE = 'quizverse_session_hint'
const ACCESS_CSRF_COOKIE = 'quizverse_csrf_access'
const REFRESH_CSRF_COOKIE = 'quizverse_csrf_refresh'
const COOKIE_SESSION_MARKER = 'cookie-session'
const AUTH_COOKIE_LOCK_NAME = 'quizverse-auth-cookie-mutation'

let sessionRevision = 0
let refreshPromise = null
let logoutPromise = null

export class ApiError extends Error {
  constructor(message, status, code = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function readCookie(name) {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') return null
  const prefix = `${encodeURIComponent(name)}=`
  const item = document.cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))
  if (!item) return null
  return decodeURIComponent(item.slice(prefix.length))
}

function hasSessionHint() {
  return readCookie(SESSION_HINT_COOKIE) === '1'
}

function storageAvailable() {
  return typeof localStorage !== 'undefined'
}

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

export function removeLegacyAuthToken() {
  if (storageAvailable()) localStorage.removeItem(LEGACY_TOKEN_KEY)
}

export function getStoredSession() {
  if (!storageAvailable()) return null

  removeLegacyAuthToken()

  if (!hasSessionHint()) {
    localStorage.removeItem(USER_KEY)
    return null
  }

  const rawUser = localStorage.getItem(USER_KEY)
  try {
    return {
      accessToken: COOKIE_SESSION_MARKER,
      user: rawUser ? JSON.parse(rawUser) : null,
    }
  } catch {
    localStorage.removeItem(USER_KEY)
    return { accessToken: COOKIE_SESSION_MARKER, user: null }
  }
}

export function saveSession({ user }, { redirect = true } = {}) {
  if (storageAvailable()) {
    removeLegacyAuthToken()
    localStorage.setItem(USER_KEY, JSON.stringify(user ?? null))
  }
  sessionRevision += 1

  if (
    redirect
    && typeof window !== 'undefined'
    && (window.location.pathname === '/login' || window.location.pathname === '/signup')
  ) {
    const returnTo = consumeAuthReturnPath()
    if (returnTo) {
      queueMicrotask(() => window.location.assign(returnTo))
    }
  }

  return { accessToken: COOKIE_SESSION_MARKER, user: user ?? null }
}

function clearLocalSession() {
  if (storageAvailable()) {
    removeLegacyAuthToken()
    localStorage.removeItem(USER_KEY)
  }
  sessionRevision += 1
}

function logoutCsrfToken() {
  return readCookie(ACCESS_CSRF_COOKIE) ?? readCookie(REFRESH_CSRF_COOKIE)
}

function normalizeQuizListPayload(payload) {
  return {
    ...payload,
    items: (payload.items ?? []).map((quiz) => ({
      ...quiz,
      description: quiz.description ?? quiz.description_summary ?? '',
    })),
  }
}

function isUnsafeMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

function csrfTokenFor(path) {
  if (path === '/api/auth/refresh') return readCookie(REFRESH_CSRF_COOKIE)
  if (path === '/api/auth/logout') return logoutCsrfToken()
  return readCookie(ACCESS_CSRF_COOKIE)
}

async function fetchJson(path, { method = 'GET', body, query } = {}) {
  const url = new URL(path, window.location.origin)
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (isUnsafeMethod(method)) {
    const csrfToken = csrfTokenFor(path)
    if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken
  }

  let response
  try {
    response = await fetch(`${url.pathname}${url.search}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(
      'サーバーへ接続できませんでした。通信環境を確認してください。',
      0,
      'network/error',
    )
  }

  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

function apiErrorFrom(response, payload, fallbackMessage) {
  return new ApiError(
    payload?.error?.message ?? fallbackMessage,
    response.status,
    payload?.error?.code ?? '',
  )
}

async function performServerLogout() {
  const { response, payload } = await fetchJson('/api/auth/logout', {
    method: 'POST',
  })
  if (!response.ok) {
    throw apiErrorFrom(response, payload, 'ログアウトできませんでした。')
  }
  return payload
}

export function clearSession({ notifyServer = true, requireServerSuccess = true } = {}) {
  if (logoutPromise) return logoutPromise

  const useWebLock = webLocksAvailable()
  logoutPromise = withAuthCookieLock(async () => {
    // Web Locks serializes refresh/logout across every same-origin tab. When the
    // API is unavailable, retain the existing same-tab Promise fallback.
    if (!useWebLock && refreshPromise) {
      try {
        await refreshPromise
      } catch {
        // Logout still needs to clear cookies after a failed refresh.
      }
    }

    if (notifyServer && typeof fetch === 'function') {
      try {
        await performServerLogout()
      } catch (error) {
        if (requireServerSuccess) throw error
      }
    }

    clearLocalSession()
    return null
  }).finally(() => {
    logoutPromise = null
  })

  return logoutPromise
}

function invalidateSessionAfterAuthFailure() {
  void clearSession({ requireServerSuccess: false }).catch(() => null)
}

function redirectToLogin(requestRevision) {
  if (requestRevision !== sessionRevision) return

  invalidateSessionAfterAuthFailure()
  if (typeof window === 'undefined') return

  if (window.location.pathname === '/login') {
    window.location.reload()
    return
  }

  const currentPath = `${window.location.pathname}${window.location.search ?? ''}`
  const returnTo = rememberAuthReturnPath(currentPath)
  window.location.assign(buildAuthPath('login', returnTo))
}

async function refreshAccessToken(expectedRevision) {
  if (logoutPromise) {
    throw new ApiError('Logout is in progress.', 401, 'auth/logout_in_progress')
  }
  if (expectedRevision !== sessionRevision) return null
  if (!hasSessionHint()) {
    throw new ApiError('Refresh session is unavailable.', 401, 'auth/missing_refresh_token')
  }

  if (!refreshPromise) {
    const refreshRevision = sessionRevision
    refreshPromise = withAuthCookieLock(async () => {
      // Another tab may have logged out while this refresh was waiting for the
      // shared lock. Re-check browser state only after ownership is granted.
      if (logoutPromise) {
        throw new ApiError('Logout is in progress.', 401, 'auth/logout_in_progress')
      }
      if (expectedRevision !== sessionRevision) return null
      if (!hasSessionHint()) {
        throw new ApiError('Refresh session is unavailable.', 401, 'auth/missing_refresh_token')
      }

      const { response, payload } = await fetchJson('/api/auth/refresh', {
        method: 'POST',
      })
      if (!response.ok) {
        throw apiErrorFrom(response, payload, 'ログイン状態を更新できませんでした。')
      }
      if (
        payload?.user
        && refreshRevision === sessionRevision
        && !logoutPromise
      ) {
        saveSession(payload, { redirect: false })
      }
      return payload
    }).finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}

async function signInRequest(path, values) {
  const useWebLock = webLocksAvailable()
  return withAuthCookieLock(async () => {
    // On browsers without Web Locks, preserve same-tab ordering against any
    // refresh/logout already in flight.
    if (!useWebLock && refreshPromise) {
      try {
        await refreshPromise
      } catch {
        // A fresh sign-in remains valid even when the previous refresh failed.
      }
    }
    if (!useWebLock && logoutPromise) {
      try {
        await logoutPromise
      } catch {
        // Allow the explicit sign-in request to surface its own result.
      }
    }

    const { response, payload } = await fetchJson(path, {
      method: 'POST',
      body: values,
    })
    if (!response.ok) {
      throw apiErrorFrom(response, payload, '認証リクエストの処理に失敗しました。')
    }
    return payload
  })
}

async function request(
  path,
  {
    method = 'GET',
    body,
    query,
    auth = 'none',
    retryAfterRefresh = true,
  } = {},
) {
  const requestRevision = sessionRevision
  const { response, payload } = await fetchJson(path, { method, body, query })

  if (!response.ok) {
    const message = payload?.error?.message ?? 'リクエストの処理に失敗しました。'
    const code = payload?.error?.code ?? ''

    if (
      response.status === 401
      && auth !== 'none'
      && retryAfterRefresh
      && path !== '/api/auth/refresh'
      && hasSessionHint()
    ) {
      try {
        // Another request may have completed refresh after this request began.
        // In that case retry directly instead of issuing a second refresh.
        if (requestRevision === sessionRevision) {
          await refreshAccessToken(requestRevision)
        }
        if (logoutPromise) throw new Error('logout in progress')
        return request(path, {
          method,
          body,
          query,
          auth,
          retryAfterRefresh: false,
        })
      } catch {
        // The original 401 remains the user-facing failure. Required requests
        // also clear the stale local session and redirect below.
      }
    }

    if (!logoutPromise && response.status === 401 && auth === 'required') {
      redirectToLogin(requestRevision)
    } else if (
      !logoutPromise
      && response.status === 401
      && auth === 'optional'
      && requestRevision === sessionRevision
    ) {
      invalidateSessionAfterAuthFailure()
    }

    throw new ApiError(message, response.status, code)
  }

  return payload
}

export const publicApi = {
  register: (values) => signInRequest('/api/auth/register', values),
  login: (values) => signInRequest('/api/auth/login', values),
  googleLogin: (values) => signInRequest('/api/auth/google', values),
  logout: () => clearSession(),
  me: (_legacyAccessToken) => request('/api/auth/me', { auth: 'required' }),
  createQuiz: (values, _legacyAccessToken) => request('/api/quizzes', {
    method: 'POST',
    body: values,
    auth: 'required',
  }),
  quizzes: async ({ q = '', category = '', page = 1, perPage = 9 } = {}) => {
    const payload = await request('/api/quizzes', {
      query: { q, category, page, per_page: perPage },
    })
    return normalizeQuizListPayload(payload)
  },
  quiz: (quizId, _legacyAccessToken) => request(`/api/quizzes/${quizId}`, {
    auth: hasSessionHint() ? 'optional' : 'none',
  }),
  playQuiz: (quizId, answers, _legacyAccessToken) =>
    request(`/api/quizzes/${quizId}/play`, {
      method: 'POST',
      body: { answers },
      auth: 'required',
    }),
  overallRankings: ({ page = 1, perPage = 20 } = {}) =>
    request('/api/rankings', { query: { page, per_page: perPage } }),
  quizRankings: (quizId, { page = 1, perPage = 20 } = {}) =>
    request(`/api/quizzes/${quizId}/rankings`, {
      query: { page, per_page: perPage },
    }),
  myQuizzes: ({ status = 'all', page = 1, perPage = 20 } = {}, _legacyAccessToken) =>
    request('/api/me/quizzes', {
      query: { status, page, per_page: perPage },
      auth: 'required',
    }),
  editableQuiz: (quizId, _legacyAccessToken) =>
    request(`/api/me/quizzes/${quizId}`, { auth: 'required' }),
  updateQuiz: (quizId, values, _legacyAccessToken) =>
    request(`/api/me/quizzes/${quizId}`, {
      method: 'PUT',
      body: values,
      auth: 'required',
    }),
  updateQuizStatus: (quizId, status, _legacyAccessToken) =>
    request(`/api/me/quizzes/${quizId}/status`, {
      method: 'PATCH',
      body: { status },
      auth: 'required',
    }),
}
