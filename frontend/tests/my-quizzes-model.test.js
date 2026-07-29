import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countPageQuizStatuses,
  pageAfterQuizStatusChange,
} from '../src/public/myQuizzesModel.js'

test('状態別件数は現在ページのitemsだけを集計する', () => {
  const counts = countPageQuizStatuses([
    { id: '1', status: 'draft' },
    { id: '2', status: 'published' },
    { id: '3', status: 'draft' },
    { id: '4', status: 'archived' },
  ])

  assert.deepEqual(counts, {
    draft: 2,
    published: 1,
    archived: 1,
  })
})

test('状態変更後は最終ページの空表示を避けるため1ページ目へ戻す', () => {
  assert.equal(pageAfterQuizStatusChange(), 1)
})
