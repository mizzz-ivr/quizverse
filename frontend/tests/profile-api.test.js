import assert from 'node:assert/strict'
import test from 'node:test'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

async function loadProfileApi() {
  globalThis.window = {
    location: {
      origin: 'https://quiz.example',
      pathname: '/profile',
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
  return import(`../src/public/profileApi.js?test=${Math.random()}`)
}

test('プロフィール取得はCookie資格情報付きGETを送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ user: { id: '1' }, stats: {} })
  }
  const { publicApi } = await loadProfileApi()

  await publicApi.meProfile()

  assert.equal(calls[0].url, '/api/me/profile')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.credentials, 'same-origin')
})

test('表示名更新はCSRFヘッダー付きPATCHを送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ user: { display_name: 'After' }, meta: { changed: true } })
  }
  const { publicApi } = await loadProfileApi()

  await publicApi.updateProfile({ display_name: 'After' })

  assert.equal(calls[0].url, '/api/me/profile')
  assert.equal(calls[0].options.method, 'PATCH')
  assert.equal(calls[0].options.headers['X-CSRF-TOKEN'], 'csrf-token')
  assert.deepEqual(JSON.parse(calls[0].options.body), { display_name: 'After' })
})

test('プレイ履歴へ結果・クイズ・ページ条件を送信する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ items: [], pagination: {} })
  }
  const { publicApi } = await loadProfileApi()

  await publicApi.playHistory({ result: 'review', quizId: 12, page: 2, perPage: 8 })

  assert.equal(
    calls[0].url,
    '/api/me/plays?result=review&quiz_id=12&page=2&per_page=8',
  )
})

test('本人のプレイ詳細を取得する', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return jsonResponse({ play: { id: '99' }, questions: [] })
  }
  const { publicApi } = await loadProfileApi()

  const payload = await publicApi.playHistoryDetail(99)

  assert.equal(calls[0].url, '/api/me/plays/99')
  assert.equal(payload.play.id, '99')
})
