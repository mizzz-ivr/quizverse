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

async function fetchBookmarkJson(path, { method = 'GET', query } = {}) {
  const url = new URL(path, window.location.origin)
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const headers = { Accept: 'application/json' }
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

async function bookmarkRequest(path, options = {}, retryAfterRefresh = true) {
  const { response, payload } = await fetchBookmarkJson(path, options)

  if (response.status === 401 && retryAfterRefresh) {
    try {
      await publicApi.me()
      return bookmarkRequest(path, options, false)
    } catch {
      // publicApi.me performs the shared refresh and login redirect behavior.
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? 'お気に入り情報の処理に失敗しました。',
      response.status,
      payload?.error?.code ?? '',
    )
  }

  return payload
}

publicApi.bookmarks = ({ page = 1, perPage = 12 } = {}) =>
  bookmarkRequest('/api/me/bookmarks', {
    query: { page, per_page: perPage },
  })
publicApi.bookmarkStatus = (quizId) =>
  bookmarkRequest(`/api/me/bookmarks/${encodeURIComponent(quizId)}`)
publicApi.addBookmark = (quizId) =>
  bookmarkRequest(`/api/me/bookmarks/${encodeURIComponent(quizId)}`, {
    method: 'PUT',
  })
publicApi.removeBookmark = (quizId) =>
  bookmarkRequest(`/api/me/bookmarks/${encodeURIComponent(quizId)}`, {
    method: 'DELETE',
  })

export { publicApi }
