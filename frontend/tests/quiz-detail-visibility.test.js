import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldShowQuestionExplanation } from '../src/public/quizDetailVisibility.js'

test('一般プレイヤーは採点前に解説を表示しない', () => {
  assert.equal(shouldShowQuestionExplanation({ viewerIsAuthor: false, hasResult: false }), false)
})

test('一般プレイヤーは採点後に解説を表示する', () => {
  assert.equal(shouldShowQuestionExplanation({ viewerIsAuthor: false, hasResult: true }), true)
})

test('作成者プレビューでは採点結果なしでも解説を確認できる', () => {
  assert.equal(shouldShowQuestionExplanation({ viewerIsAuthor: true, hasResult: false }), true)
})
