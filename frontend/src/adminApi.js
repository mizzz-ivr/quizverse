import { ApiError, publicApi } from './public/api.js'

const ACCESS_CSRF_COOKIE = 'quizverse_csrf_access'

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

function isUnsafeMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

async function request(path, { method = 'GET', body, query } = {}) {
  // publicApi.me() performs the shared refresh/retry flow before the admin API
  // request, so the admin entry uses the same Cookie session contract as the
  // public application.
  await publicApi.me()

  const url = new URL(path, window.location.origin)
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (isUnsafeMethod(method)) {
    const csrfToken = readCookie(ACCESS_CSRF_COOKIE)
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
      '管理APIへ接続できませんでした。通信環境を確認してください。',
      0,
      'network/error',
    )
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? '管理APIの処理に失敗しました。',
      response.status,
      payload?.error?.code ?? '',
    )
  }
  return payload
}

export const adminApi = {
  session: () => request('/api/admin/session'),
  overview: () => request('/api/admin/overview'),
  users: ({ page = 1, perPage = 20, q = '', role = '', status = '' } = {}) =>
    request('/api/admin/users', {
      query: { page, per_page: perPage, q, role, status },
    }),
  user: (userId) => request(`/api/admin/users/${encodeURIComponent(userId)}`),
  updateUserRole: (userId, role) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH',
      body: { role },
    }),
  updateUserStatus: (userId, status) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH',
      body: { status },
    }),
  quizzes: ({ page = 1, perPage = 20 } = {}) =>
    request('/api/admin/quizzes', { query: { page, per_page: perPage } }),
  emailSettings: () => request('/api/admin/email-settings'),
  updateEmailSettings: (values) =>
    request('/api/admin/email-settings', { method: 'PUT', body: values }),
  status: () => request('/api/admin/status'),
  logout: () => publicApi.logout(),
}