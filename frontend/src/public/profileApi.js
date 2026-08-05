import { ApiError, publicApi } from './api.js'

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

async function fetchProfileJson(path, { method = 'GET', body, query } = {}) {
  const url = new URL(path, window.location.origin)
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
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
      'サーバーへ接続できませんでした。通信環境を確認してください。',
      0,
      'network/error',
    )
  }

  return {
    response,
    payload: await response.json().catch(() => ({})),
  }
}

async function profileRequest(path, options = {}, retryAfterRefresh = true) {
  const { response, payload } = await fetchProfileJson(path, options)

  if (response.status === 401 && retryAfterRefresh) {
    try {
      await publicApi.me()
      return profileRequest(path, options, false)
    } catch {
      // publicApi.me performs the shared refresh and login redirect behavior.
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? 'プロフィール情報の取得に失敗しました。',
      response.status,
      payload?.error?.code ?? '',
    )
  }

  return payload
}

publicApi.meProfile = () => profileRequest('/api/me/profile')
publicApi.updateProfile = (values) => profileRequest('/api/me/profile', {
  method: 'PATCH',
  body: values,
})
publicApi.playHistory = ({ result = 'all', quizId = '', page = 1, perPage = 10 } = {}) =>
  profileRequest('/api/me/plays', {
    query: {
      result,
      quiz_id: quizId,
      page,
      per_page: perPage,
    },
  })
publicApi.playHistoryDetail = (playId) => profileRequest(`/api/me/plays/${playId}`)

export { publicApi }
