import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'


test('共有mainエントリが全ルート描画前に旧JWTを削除する', async () => {
  const mainSource = await readFile(
    new URL('../src/main.jsx', import.meta.url),
    'utf8',
  )

  const cleanupCall = mainSource.indexOf('removeLegacyAuthToken()')
  const routeSelection = mainSource.indexOf('const pathname = window.location.pathname')

  assert.ok(cleanupCall >= 0)
  assert.ok(routeSelection >= 0)
  assert.ok(cleanupCall < routeSelection)
})
