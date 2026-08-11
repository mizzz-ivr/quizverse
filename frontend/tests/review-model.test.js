import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatRatingAverage,
  normalizeRatedQuiz,
  normalizeReviewSummary,
  ratingStars,
  reviewEligibilityMessage,
} from '../src/public/reviewModel.js'

test('5段階評価を星表示へ整形する', () => {
  assert.equal(ratingStars(5), '★★★★★')
  assert.equal(ratingStars(3), '★★★☆☆')
  assert.equal(ratingStars(null), '☆☆☆☆☆')
})

test('平均評価を小数1桁で表示する', () => {
  assert.equal(formatRatingAverage(4.25), '4.3')
  assert.equal(formatRatingAverage(null), '未評価')
})

test('評価サマリーを安全な数値へ正規化する', () => {
  assert.deepEqual(normalizeReviewSummary({ rating_average: '4.5', review_count: '3' }), {
    ratingAverage: 4.5,
    reviewCount: 3,
  })
  assert.deepEqual(normalizeReviewSummary({}), {
    ratingAverage: null,
    reviewCount: 0,
  })
})

test('高評価クイズをカード表示用へ正規化する', () => {
  const quiz = normalizeRatedQuiz({
    id: '12',
    description_summary: '説明',
    rating_average: '5',
    review_count: '2',
  })
  assert.equal(quiz.description, '説明')
  assert.equal(quiz.rating_average, 5)
  assert.equal(quiz.review_count, 2)
})

test('投稿不可理由を日本語メッセージへ変換する', () => {
  assert.match(reviewEligibilityMessage({ eligible: false, reason: 'author' }), /作成者本人/)
  assert.match(reviewEligibilityMessage({ eligible: false, reason: 'not_played' }), /1回以上プレイ/)
  assert.equal(reviewEligibilityMessage({ eligible: true, reason: null }), '')
})
