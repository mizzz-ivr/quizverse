import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'


async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}


test('明示ログアウトはサーバー成功後だけ画面セッションを削除する', async () => {
  const appSource = await source('../src/public/PublicQuizApp.jsx')
  const handlerStart = appSource.indexOf('const onLogout = async () =>')
  const handlerEnd = appSource.indexOf('\n  const page = useMemo', handlerStart)
  const handler = appSource.slice(handlerStart, handlerEnd)

  const awaitLogout = handler.indexOf('await clearSession()')
  const clearUi = handler.indexOf('setSession(null)')
  const moveHome = handler.indexOf("moveTo('/')")

  assert.ok(handlerStart >= 0)
  assert.ok(awaitLogout >= 0)
  assert.ok(clearUi > awaitLogout)
  assert.ok(moveHome > awaitLogout)
  assert.match(handler, /logoutInFlight\.current/)
  assert.match(handler, /setLogoutError/)
})


test('クイズ詳細ルートはお気に入り操作を追加してもCookieセッション確認を維持する', async () => {
  const gateSource = await source('../src/public/QuizDetailSessionGate.jsx')
  const mainSource = await source('../src/main.jsx')

  assert.match(gateSource, /publicApi\.me\(initialSession\.accessToken\)/)
  assert.match(gateSource, /if \(!ready\) return <LoadingSession \/>/)
  assert.match(gateSource, /<QuizDetailApp \/>/)
  assert.match(gateSource, /<BookmarkQuickAction \/>/)
  assert.match(mainSource, /RootApp = QuizDetailSessionGate/)

  const readyCheck = gateSource.indexOf('if (!ready) return <LoadingSession />')
  const bookmarkAction = gateSource.indexOf('<BookmarkQuickAction />')
  assert.ok(readyCheck >= 0)
  assert.ok(bookmarkAction > readyCheck)
})
