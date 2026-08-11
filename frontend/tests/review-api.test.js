import assert from 'node:assert/strict'
import test from 'node:test'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

async function loadReviewApi() {
  globalThis.window = {
    location: {
      origin: 'https://quiz.example',
      pathname: '/quizzes/12',
      search: '',
      assign() {},
      reload() {},
    },
  }
  globalThis.document = {
    cookie: 'quizverse_session_hint=1; quizverse_csrf_access=csrf-token',
  }
  globalThis.localStorage = {
    getItem() { return null },
    setItem() {},
    removeItem() {},
  }
  return import(`../src/public/reviewApi.js?test=${Math.random()}`)
}

test('公開レビュー一覧へページ条件を送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ items: [], summary: {}, pagination: {} })
  }
  const { publicApi } = await loadReviewApi()

  await publicApi.quizReviews(12, { page: 2, perPage: 5 })

  assert.equal(calls[0].url, '/api/quizzes/12/reviews?page=2&per_page=5')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.credentials, 'same-origin')
})

test('本人レビュー取得はCookie資格情報付きGETを送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ review: null, eligibility: { eligible: true, reason: null } })
  }
  const { publicApi } = await loadReviewApi()

  await publicApi.myQuizReview(12)

  assert.equal(calls[0].url, '/api/quizzes/12/reviews/me')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.credentials, 'same-origin')
})

test('レビュー保存はCookie・CSRF付きPUTとJSON本文を送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ review: { rating: 5 }, meta: { created: true } }, 201)
  }
  const { publicApi } = await loadReviewApi()

  await publicApi.saveQuizReview(12, { rating: 5, body: '面白い' })

  assert.equal(calls[0].url, '/api/quizzes/12/reviews/me')
  assert.equal(calls[0].options.method, 'PUT')
  assert.equal(calls[0].options.headers['X-CSRF-TOKEN'], 'csrf-token')
  assert.deepEqual(JSON.parse(calls[0].options.body), { rating: 5, body: '面白い' })
})

test('レビュー削除はCookie・CSRF付きDELETEを送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ review: null, meta: { changed: true } })
  }
  const { publicApi } = await loadReviewApi()

  await publicApi.deleteQuizReview(12)

  assert.equal(calls[0].url, '/api/quizzes/12/reviews/me')
  assert.equal(calls[0].options.method, 'DELETE')
  assert.equal(calls[0].options.headers['X-CSRF-TOKEN'], 'csrf-token')
})

test('高評価一覧はsort=ratingと検索条件を送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ items: [{ id: '1', description_summary: '説明' }], pagination: {} })
  }
  const { publicApi } = await loadReviewApi()

  const payload = await publicApi.topRatedQuizzes({ q: 'AWS', category: '技術', page: 3, perPage: 12 })

  assert.equal(calls[0].url, '/api/quizzes?q=AWS&category=%E6%8A%80%E8%A1%93&page=3&per_page=12&sort=rating')
  assert.equal(payload.items[0].description, '説明')
})
