import { useEffect, useState } from 'react'

import { ApiError, getStoredSession, publicApi } from './api.js'
import { BookmarkQuickAction } from './BookmarkQuickAction.jsx'
import { QuizDetailApp } from './QuizDetailApp.jsx'


function LoadingSession() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="text-center" role="status" aria-live="polite">
        <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-cyan-500 dark:border-slate-800 dark:border-t-cyan-300" />
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">ログイン状態を確認しています…</p>
      </div>
    </main>
  )
}


export function QuizDetailSessionGate() {
  const initialSession = getStoredSession()
  const [ready, setReady] = useState(!initialSession?.accessToken)

  useEffect(() => {
    if (!initialSession?.accessToken) return undefined

    let active = true
    publicApi.me(initialSession.accessToken)
      .then(() => {
        if (active) setReady(true)
      })
      .catch((error) => {
        // A 401 is handled by the shared API client, which redirects to login
        // after refresh failure. Other errors must not block public quizzes.
        if (active && (!(error instanceof ApiError) || error.status !== 401)) {
          setReady(true)
        }
      })

    return () => {
      active = false
    }
  }, [initialSession?.accessToken])

  if (!ready) return <LoadingSession />
  return (
    <>
      <QuizDetailApp />
      <BookmarkQuickAction />
    </>
  )
}
