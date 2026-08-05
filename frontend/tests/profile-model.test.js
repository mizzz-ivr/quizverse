import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canMoveHistoryPage,
  formatAccuracy,
  normalizeProfileStats,
  resultPresentation,
} from '../src/public/profileModel.js'

test('プロフィール統計を画面用の数値へ正規化する', () => {
  assert.deepEqual(
    normalizeProfileStats({
      play_count: '4',
      attempted_quiz_count: 3,
      correct_answers: 8,
      total_questions: 10,
      average_accuracy_percentage: '80',
      perfect_play_count: 2,
      created_quiz_count: 1,
    }),
    {
      playCount: 4,
      attemptedQuizCount: 3,
      correctAnswers: 8,
      totalQuestions: 10,
      averageAccuracyPercentage: 80,
      perfectPlayCount: 2,
      createdQuizCount: 1,
    },
  )
})

test('正答率を整数または小数1桁のパーセントで表示する', () => {
  assert.equal(formatAccuracy(100), '100%')
  assert.equal(formatAccuracy(66.67), '66.7%')
  assert.equal(formatAccuracy(undefined), '0%')
})

test('結果区分に対応する表示名を返す', () => {
  assert.equal(resultPresentation('perfect').label, '全問正解')
  assert.equal(resultPresentation('passed').label, '合格ライン')
  assert.equal(resultPresentation('review').label, '要復習')
})

test('履歴ページの前後移動可否を判定する', () => {
  const pagination = { page: 2, total_pages: 3 }
  assert.equal(canMoveHistoryPage(pagination, 'previous'), true)
  assert.equal(canMoveHistoryPage(pagination, 'next'), true)
  assert.equal(canMoveHistoryPage({ page: 1, total_pages: 1 }, 'previous'), false)
  assert.equal(canMoveHistoryPage({ page: 1, total_pages: 1 }, 'next'), false)
})
