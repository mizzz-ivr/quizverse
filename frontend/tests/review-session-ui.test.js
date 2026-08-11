import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('クイズ詳細はセッション確認後にレビュー操作を描画する', async () => {
  const gateSource = await source('../src/public/QuizDetailSessionGate.jsx')
  const readyGuard = gateSource.indexOf('if (!ready) return <LoadingSession />')
  const reviewRender = gateSource.indexOf('<ReviewQuickAction />')

  assert.match(gateSource, /publicApi\.me\(initialSession\.accessToken\)/)
  assert.ok(readyGuard >= 0)
  assert.ok(reviewRender > readyGuard)
})

test('高評価クイズページは専用ルートへ割り当てられる', async () => {
  const mainSource = await source('../src/main.jsx')

  assert.match(mainSource, /import \{ TopRatedApp \} from '\.\/public\/TopRatedApp'/)
  assert.match(mainSource, /if \(pathname === '\/top-rated'\) RootApp = TopRatedApp/)
  assert.match(mainSource, /href="\/top-rated"/)
})
