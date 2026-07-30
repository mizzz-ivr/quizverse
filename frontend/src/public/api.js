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

let sessionRevision = 0
let refreshPromise = null

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

export function getStoredSession() {
  if (!storageAvailable()) return null

  // Remove JWTs created by older QuizVerse versions. Authentication is now
  // represented only by HttpOnly cookies managed by the server.
  localStorage.removeItem(LEGACY_TOKEN_KEY)

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
    localStorage.removeItem(LEGACY_TOKEN_KEY)
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
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }
  sessionRevision += 1
}

export function clearSession({ notifyServer = true } = {}) {
  clearLocalSession()

  if (!notifyServer || typeof fetch !== 'function') return Promise.resolve(null)

  const headers = { Accept: 'application/json' }
  const csrfToken = readCookie(ACCESS_CSRF_COOKIE)
  if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken

  return fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
  }).catch(() => null)
}

function redirectToLogin(requestRevision) {
  if (requestRevision !== sessionRevision) return

  void clearSession()
  if (typeof window === 'undefined') return

  if (window.location.pathname === '/login') {
    window.location.reload()
    return
  }

  const currentPath = `${window.location.pathname}${window.location.search ?? ''}`
  const returnTo = rememberAuthReturnPath(currentPath)
  window.location.assign(buildAuthPath('login', returnTo))
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

function csrfCookieFor(path) {
  return path === '/api/auth/refresh' ? REFRESH_CSRF_COOKIE : ACCESS_CSRF_COOKIE
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
    const csrfToken = readCookie(csrfCookieFor(path))
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

async function refreshAccessToken() {
  if (!hasSessionHint()) {
    throw new ApiError('Refresh session is unavailable.', 401, 'auth/missing_refresh_token')
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const { response, payload } = await fetchJson('/api/auth/refresh', {
        method: 'POST',
      })
      if (!response.ok) {
        throw new ApiError(
          payload?.error?.message ?? 'ログイン状態を更新できませんでした。',
          response.status,
          payload?.error?.code ?? '',
        )
      }
      if (payload?.user) saveSession(payload, { redirect: false })
      return payload
    })().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
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
        await refreshAccessToken()
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

    if (response.status === 401 && auth === 'required') {
      redirectToLogin(requestRevision)
    } else if (response.status === 401 && auth === 'optional' && requestRevision === sessionRevision) {
      void clearSession()
    }

    throw new ApiError(message, response.status, code)
  }

  return payload
}

export const publicApi = {
  register: (values) => request('/api/auth/register', {
    method: 'POST',
    body: values,
  }),
  login: (values) => request('/api/auth/login', {
    method: 'POST',
    body: values,
  }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
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
