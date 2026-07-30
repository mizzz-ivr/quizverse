import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import { publicApi } from '../src/public/api.js'
import {
  buildCreateQuizPayload,
  buildQuizDraftFromEditableQuiz,
  clearEditableQuizDraft,
  loadEditableQuizDraft,
  saveEditableQuizDraft,
  validateQuizDraft,
} from '../src/public/createQuizModel.js'

let requests

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  }
}

beforeEach(() => {
  requests = []
  globalThis.localStorage = createStorage()
  globalThis.sessionStorage = createStorage()
  globalThis.window = {
    location: {
      origin: 'http://localhost:5173',
      pathname: '/my/quizzes/12/edit',
      search: '',
      assign: () => {},
      reload: () => {},
    },
  }
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options })
    return jsonResponse({ quiz: { id: '12', status: 'draft' } })
  }
})

afterEach(() => {
  delete globalThis.fetch
  delete globalThis.localStorage
  delete globalThis.sessionStorage
  delete globalThis.window
})

test('編集APIのレスポンスを入力フォームへ復元する', () => {
  const draft = buildQuizDraftFromEditableQuiz({
    title: '編集対象',
    description: '説明',
    category: '歴史',
    questions: [
      {
        body: '問題文',
        explanation: '解説',
        choices: [
          { body: 'A', is_correct: false },
          { body: 'B', is_correct: true },
        ],
      },
    ],
  })

  assert.equal(draft.title, '編集対象')
  assert.equal(draft.questions.length, 1)
  assert.equal(draft.questions[0].choices.length, 2)
  assert.equal(draft.questions[0].choices[1].isCorrect, true)
  assert.ok(draft.questions[0].clientId)
  assert.ok(draft.questions[0].choices[0].clientId)
  assert.equal(validateQuizDraft(draft).valid, true)
})

test('復元した編集内容を更新payloadへ正規化できる', () => {
  const draft = buildQuizDraftFromEditableQuiz({
    title: '  更新タイトル  ',
    description: '  更新説明  ',
    category: '  科学  ',
    questions: [
      {
        body: '  問題  ',
        explanation: '',
        choices: [
          { body: '  正解  ', is_correct: true },
          { body: '  不正解  ', is_correct: false },
        ],
      },
    ],
  })

  assert.deepEqual(buildCreateQuizPayload(draft), {
    title: '更新タイトル',
    description: '更新説明',
    category: '科学',
    questions: [
      {
        body: '問題',
        explanation: null,
        choices: [
          { body: '正解', is_correct: true },
          { body: '不正解', is_correct: false },
        ],
      },
    ],
  })
})

test('同じサーバー更新日時なら編集中データを再認証後に復元できる', () => {
  const storage = createStorage()
  const draft = buildQuizDraftFromEditableQuiz({
    title: '未保存の編集',
    description: '再認証後も残す',
    category: '復元',
    questions: [
      {
        body: '編集中の問題',
        explanation: '',
        choices: [
          { body: '正解', is_correct: true },
          { body: '不正解', is_correct: false },
        ],
      },
    ],
  })

  assert.equal(saveEditableQuizDraft('12', '2026-07-30T00:00:00+00:00', draft, storage), true)
  const restored = loadEditableQuizDraft('12', '2026-07-30T00:00:00+00:00', storage)

  assert.equal(restored.title, '未保存の編集')
  assert.equal(restored.questions[0].body, '編集中の問題')
  assert.equal(restored.questions[0].choices[0].isCorrect, true)
})

test('サーバー更新日時が変わった古い編集データは復元しない', () => {
  const storage = createStorage()
  const draft = buildQuizDraftFromEditableQuiz({
    title: '古い編集',
    questions: [
      {
        body: '古い問題',
        choices: [
          { body: '正解', is_correct: true },
          { body: '不正解', is_correct: false },
        ],
      },
    ],
  })

  saveEditableQuizDraft('12', 'old-version', draft, storage)

  assert.equal(loadEditableQuizDraft('12', 'new-version', storage), null)
  assert.equal(loadEditableQuizDraft('12', 'old-version', storage), null)
})

test('保存成功後にクイズ別の編集中データを削除できる', () => {
  const storage = createStorage()
  const draft = buildQuizDraftFromEditableQuiz({
    title: '削除対象',
    questions: [
      {
        body: '問題',
        choices: [
          { body: '正解', is_correct: true },
          { body: '不正解', is_correct: false },
        ],
      },
    ],
  })

  saveEditableQuizDraft('12', 'version', draft, storage)
  clearEditableQuizDraft('12', storage)

  assert.equal(loadEditableQuizDraft('12', 'version', storage), null)
})

test('編集データ取得APIへJWT付きGETを送信する', async () => {
  await publicApi.editableQuiz('12', 'access-token')

  assert.equal(requests[0].path, '/api/me/quizzes/12')
  assert.equal(requests[0].options.method, 'GET')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer access-token')
})

test('下書き更新APIへJWT付きPUTを送信する', async () => {
  const values = {
    title: '更新',
    description: null,
    category: null,
    questions: [],
  }

  await publicApi.updateQuiz('12', values, 'access-token')

  assert.equal(requests[0].path, '/api/me/quizzes/12')
  assert.equal(requests[0].options.method, 'PUT')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer access-token')
  assert.deepEqual(JSON.parse(requests[0].options.body), values)
})
