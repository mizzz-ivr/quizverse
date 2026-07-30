import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import { publicApi } from '../src/public/api.js'

let requestRecord

function createLocalStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

beforeEach(() => {
  requestRecord = null
  globalThis.localStorage = createLocalStorage()
  globalThis.document = {
    cookie: 'quizverse_session_hint=1; quizverse_csrf_access=create-csrf',
  }
  globalThis.window = {
    location: {
      origin: 'http://localhost:5173',
      pathname: '/quizzes/new',
      assign: () => {},
      reload: () => {},
    },
  }
  globalThis.fetch = async (path, options) => {
    requestRecord = { path, options }
    return {
      ok: true,
      status: 201,
      json: async () => ({ quiz: { id: '42', status: 'draft' } }),
    }
  }
})

afterEach(() => {
  delete globalThis.fetch
  delete globalThis.document
  delete globalThis.localStorage
  delete globalThis.window
})

test('クイズ作成APIへCookie・CSRFと入力payloadをPOSTする', async () => {
  const quiz = {
    title: 'APIテスト',
    description: null,
    category: 'テスト',
    questions: [
      {
        body: '問題文',
        explanation: null,
        choices: [
          { body: '正解', is_correct: true },
          { body: '不正解', is_correct: false },
        ],
      },
    ],
  }

  const payload = await publicApi.createQuiz(quiz, 'legacy-access-token')

  assert.equal(payload.quiz.id, '42')
  assert.equal(requestRecord.path, '/api/quizzes')
  assert.equal(requestRecord.options.method, 'POST')
  assert.equal(requestRecord.options.credentials, 'same-origin')
  assert.equal(requestRecord.options.headers.Authorization, undefined)
  assert.equal(requestRecord.options.headers['X-CSRF-TOKEN'], 'create-csrf')
  assert.equal(requestRecord.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(requestRecord.options.body), quiz)
})
