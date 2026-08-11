import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canMoveBookmarkPage,
  formatBookmarkedAt,
  normalizeBookmarkPayload,
} from '../src/public/bookmarkModel.js'

test('お気に入り一覧の数値を画面用へ正規化する', () => {
  const payload = normalizeBookmarkPayload({
    items: [
      {
        bookmarked_at: '2026-08-12T00:00:00+00:00',
        quiz: { id: '10', question_count: '5' },
      },
    ],
    pagination: {
      page: '2',
      per_page: '12',
      total: '25',
      total_pages: '3',
    },
  })

  assert.equal(payload.items[0].quiz.question_count, 5)
  assert.deepEqual(payload.pagination, {
    page: 2,
    per_page: 12,
    total: 25,
    total_pages: 3,
  })
})

test('お気に入り保存日時を日本語の日付へ整形する', () => {
  const value = formatBookmarkedAt('2026-08-12T00:00:00+09:00')

  assert.match(value, /2026/)
  assert.match(value, /8月/)
  assert.equal(formatBookmarkedAt('invalid'), '保存日時なし')
})

test('お気に入りページの前後移動可否を判定する', () => {
  const pagination = { page: 2, total_pages: 3 }

  assert.equal(canMoveBookmarkPage(pagination, 'previous'), true)
  assert.equal(canMoveBookmarkPage(pagination, 'next'), true)
  assert.equal(canMoveBookmarkPage({ page: 1, total_pages: 1 }, 'previous'), false)
  assert.equal(canMoveBookmarkPage({ page: 1, total_pages: 1 }, 'next'), false)
})
