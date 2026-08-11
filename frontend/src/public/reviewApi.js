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

async function fetchReviewJson(path, { method = 'GET', body, query } = {}) {
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

async function reviewRequest(path, options = {}, { auth = false, retryAfterRefresh = true } = {}) {
  const { response, payload } = await fetchReviewJson(path, options)

  if (auth && response.status === 401 && retryAfterRefresh) {
    try {
      await publicApi.me()
      return reviewRequest(path, options, { auth, retryAfterRefresh: false })
    } catch {
      // publicApi.me performs the shared refresh and login redirect behavior.
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? 'レビュー情報の処理に失敗しました。',
      response.status,
      payload?.error?.code ?? '',
    )
  }

  return payload
}

publicApi.quizReviews = (quizId, { page = 1, perPage = 10 } = {}) =>
  reviewRequest(`/api/quizzes/${encodeURIComponent(quizId)}/reviews`, {
    query: { page, per_page: perPage },
  })

publicApi.myQuizReview = (quizId) =>
  reviewRequest(
    `/api/quizzes/${encodeURIComponent(quizId)}/reviews/me`,
    {},
    { auth: true },
  )

publicApi.saveQuizReview = (quizId, values) =>
  reviewRequest(
    `/api/quizzes/${encodeURIComponent(quizId)}/reviews/me`,
    { method: 'PUT', body: values },
    { auth: true },
  )

publicApi.deleteQuizReview = (quizId) =>
  reviewRequest(
    `/api/quizzes/${encodeURIComponent(quizId)}/reviews/me`,
    { method: 'DELETE' },
    { auth: true },
  )

publicApi.topRatedQuizzes = async ({ q = '', category = '', page = 1, perPage = 12 } = {}) => {
  const payload = await reviewRequest('/api/quizzes', {
    query: { q, category, page, per_page: perPage, sort: 'rating' },
  })
  return {
    ...payload,
    items: (payload.items ?? []).map((quiz) => ({
      ...quiz,
      description: quiz.description ?? quiz.description_summary ?? '',
    })),
  }
}

export { publicApi }
