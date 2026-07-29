import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAuthPath,
  consumeAuthReturnPath,
  normalizeReturnPath,
  rememberAuthReturnPath,
} from '../src/public/authNavigation.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('同一オリジンの相対パスだけを復帰先として許可する', () => {
  assert.equal(normalizeReturnPath('/quizzes/new'), '/quizzes/new')
  assert.equal(normalizeReturnPath('/quizzes/new?from=login'), '/quizzes/new?from=login')
  assert.equal(normalizeReturnPath('https://example.com/steal'), '/quizzes')
  assert.equal(normalizeReturnPath('//example.com/steal'), '/quizzes')
  assert.equal(normalizeReturnPath('/\\example.com/steal'), '/quizzes')
  assert.equal(normalizeReturnPath('/login'), '/quizzes')
})

test('ログインURLへ安全なnextパラメータを付与する', () => {
  assert.equal(buildAuthPath('login', '/quizzes/new'), '/login?next=%2Fquizzes%2Fnew')
  assert.equal(buildAuthPath('signup', '/quizzes/new'), '/signup?next=%2Fquizzes%2Fnew')
})

test('保存済み復帰先を一度だけ取り出す', () => {
  const storage = createStorage()
  rememberAuthReturnPath('/quizzes/new', storage)

  assert.equal(consumeAuthReturnPath({ storage }), '/quizzes/new')
  assert.equal(consumeAuthReturnPath({ storage }), null)
})

test('URLのnextパラメータを保存値より優先する', () => {
  const storage = createStorage()
  rememberAuthReturnPath('/rankings', storage)

  assert.equal(
    consumeAuthReturnPath({ search: '?next=%2Fquizzes%2Fnew', storage }),
    '/quizzes/new',
  )
})
