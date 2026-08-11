import assert from 'node:assert/strict'
import test from 'node:test'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

async function loadBookmarkApi() {
  globalThis.window = {
    location: {
      origin: 'https://quiz.example',
      pathname: '/favorites',
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
  return import(`../src/public/bookmarkApi.js?test=${Math.random()}`)
}

test('お気に入り一覧へページ条件とCookie資格情報を送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ items: [], pagination: {} })
  }
  const { publicApi } = await loadBookmarkApi()

  await publicApi.bookmarks({ page: 2, perPage: 8 })

  assert.equal(calls[0].url, '/api/me/bookmarks?page=2&per_page=8')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.credentials, 'same-origin')
})

test('お気に入り状態を指定クイズIDで取得する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ quiz_id: '12', bookmarked: true })
  }
  const { publicApi } = await loadBookmarkApi()

  const payload = await publicApi.bookmarkStatus(12)

  assert.equal(calls[0].url, '/api/me/bookmarks/12')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(payload.bookmarked, true)
})

test('お気に入り追加はCookie・CSRF付きPUTを送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ quiz_id: '12', bookmarked: true, meta: { changed: true } }, 201)
  }
  const { publicApi } = await loadBookmarkApi()

  await publicApi.addBookmark(12)

  assert.equal(calls[0].url, '/api/me/bookmarks/12')
  assert.equal(calls[0].options.method, 'PUT')
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.headers['X-CSRF-TOKEN'], 'csrf-token')
})

test('お気に入り解除はCookie・CSRF付きDELETEを送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ quiz_id: '12', bookmarked: false, meta: { changed: true } })
  }
  const { publicApi } = await loadBookmarkApi()

  const payload = await publicApi.removeBookmark(12)

  assert.equal(calls[0].url, '/api/me/bookmarks/12')
  assert.equal(calls[0].options.method, 'DELETE')
  assert.equal(calls[0].options.headers['X-CSRF-TOKEN'], 'csrf-token')
  assert.equal(payload.bookmarked, false)
})
