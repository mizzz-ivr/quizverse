const TOKEN_KEY = 'quizverse_access_token'
const USER_KEY = 'quizverse_user'

export class ApiError extends Error {
  constructor(message, status, code = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function getStoredSession() {
  const accessToken = localStorage.getItem(TOKEN_KEY)
  const rawUser = localStorage.getItem(USER_KEY)

  if (!accessToken) return null

  try {
    return {
      accessToken,
      user: rawUser ? JSON.parse(rawUser) : null,
    }
  } catch {
    localStorage.removeItem(USER_KEY)
    return { accessToken, user: null }
  }
}

export function saveSession({ access_token: accessToken, user }) {
  localStorage.setItem(TOKEN_KEY, accessToken)
  localStorage.setItem(USER_KEY, JSON.stringify(user ?? null))
  return { accessToken, user: user ?? null }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

function handleUnauthorized(accessToken) {
  if (!accessToken) return

  const storedAccessToken = localStorage.getItem(TOKEN_KEY)
  if (storedAccessToken !== accessToken) return

  clearSession()
  if (window.location.pathname === '/login') {
    window.location.reload()
    return
  }
  window.location.assign('/login')
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

async function request(path, { method = 'GET', body, accessToken, query } = {}) {
  const url = new URL(path, window.location.origin)
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response
  try {
    response = await fetch(`${url.pathname}${url.search}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('サーバーへ接続できませんでした。通信環境を確認してください。', 0, 'network/error')
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.error?.message ?? 'リクエストの処理に失敗しました。'
    const code = payload?.error?.code ?? ''
    if (response.status === 401) handleUnauthorized(accessToken)
    throw new ApiError(message, response.status, code)
  }

  return payload
}

export const publicApi = {
  register: (values) => request('/api/auth/register', { method: 'POST', body: values }),
  login: (values) => request('/api/auth/login', { method: 'POST', body: values }),
  me: (accessToken) => request('/api/auth/me', { accessToken }),
  quizzes: async ({ q = '', category = '', page = 1, perPage = 9 } = {}) => {
    const payload = await request('/api/quizzes', {
      query: { q, category, page, per_page: perPage },
    })
    return normalizeQuizListPayload(payload)
  },
  quiz: (quizId) => request(`/api/quizzes/${quizId}`),
  playQuiz: (quizId, answers, accessToken) =>
    request(`/api/quizzes/${quizId}/play`, {
      method: 'POST',
      accessToken,
      body: { answers },
    }),
  overallRankings: ({ page = 1, perPage = 20 } = {}) =>
    request('/api/rankings', { query: { page, per_page: perPage } }),
  quizRankings: (quizId, { page = 1, perPage = 20 } = {}) =>
    request(`/api/quizzes/${quizId}/rankings`, { query: { page, per_page: perPage } }),
}
