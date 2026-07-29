import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCreateQuizPayload,
  createInitialQuizDraft,
  validateQuizDraft,
} from '../src/public/createQuizModel.js'

test('初期状態は1問4択で正答が1つ設定される', () => {
  const draft = createInitialQuizDraft()

  assert.equal(draft.questions.length, 1)
  assert.equal(draft.questions[0].choices.length, 4)
  assert.equal(draft.questions[0].choices.filter((choice) => choice.isCorrect).length, 1)
})

test('必須項目が空の場合は送信不可になる', () => {
  const validation = validateQuizDraft(createInitialQuizDraft())

  assert.equal(validation.valid, false)
  assert.equal(validation.fields.title, 'タイトルを入力してください。')
  assert.equal(validation.questions[0].body, '問題文を入力してください。')
  assert.equal(validation.questions[0].choices.filter(Boolean).length, 4)
})

test('各問題の正答が複数ある場合は送信不可になる', () => {
  const draft = createInitialQuizDraft()
  draft.title = '正答数テスト'
  draft.questions[0].body = '問題文'
  draft.questions[0].choices.forEach((choice, index) => {
    choice.body = `選択肢${index + 1}`
    choice.isCorrect = index < 2
  })

  const validation = validateQuizDraft(draft)

  assert.equal(validation.valid, false)
  assert.equal(validation.questions[0].correctChoice, '正解を1つ選択してください。')
})

test('有効な下書きをAPI送信用payloadへ正規化する', () => {
  const draft = createInitialQuizDraft()
  draft.title = '  世界遺産クイズ  '
  draft.description = '  初級編  '
  draft.category = '  歴史  '
  draft.questions[0].body = '  富士山が登録された世界遺産区分は？  '
  draft.questions[0].explanation = '  文化的価値が評価されています。  '
  draft.questions[0].choices.forEach((choice, index) => {
    choice.body = `  選択肢${index + 1}  `
    choice.isCorrect = index === 1
  })

  const validation = validateQuizDraft(draft)
  const payload = buildCreateQuizPayload(draft)

  assert.equal(validation.valid, true)
  assert.deepEqual(payload, {
    title: '世界遺産クイズ',
    description: '初級編',
    category: '歴史',
    questions: [
      {
        body: '富士山が登録された世界遺産区分は？',
        explanation: '文化的価値が評価されています。',
        choices: [
          { body: '選択肢1', is_correct: false },
          { body: '選択肢2', is_correct: true },
          { body: '選択肢3', is_correct: false },
          { body: '選択肢4', is_correct: false },
        ],
      },
    ],
  })
})

test('任意項目が空の場合はnullへ正規化する', () => {
  const draft = createInitialQuizDraft()
  draft.title = '空項目テスト'
  draft.questions[0].body = '問題文'
  draft.questions[0].choices.forEach((choice, index) => {
    choice.body = `選択肢${index + 1}`
  })

  const payload = buildCreateQuizPayload(draft)

  assert.equal(payload.description, null)
  assert.equal(payload.category, null)
  assert.equal(payload.questions[0].explanation, null)
})
