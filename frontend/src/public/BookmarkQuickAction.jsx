import React, { useEffect, useMemo, useState } from 'react'

import { buildAuthPath, rememberAuthReturnPath } from './authNavigation.js'
import { ApiError, getStoredSession, publicApi as basePublicApi } from './api.js'
import { publicApi } from './bookmarkApi.js'

function HeartIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function BookmarkQuickAction() {
  const quizId = useMemo(() => window.location.pathname.match(/^\/quizzes\/(\d+)$/)?.[1] ?? '', [])
  const [session] = useState(() => getStoredSession())
  const [eligible, setEligible] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const quizPayload = await basePublicApi.quiz(quizId)
        if (!active) return
        const published = quizPayload?.quiz?.status === 'published'
        setEligible(published)
        if (!published || !session?.accessToken) return

        const payload = await publicApi.bookmarkStatus(quizId)
        if (!active) return
        setBookmarked(Boolean(payload.bookmarked))
      } catch (requestError) {
        if (!active) return
        if (requestError instanceof ApiError && requestError.status === 404) {
          setEligible(false)
          return
        }
        setError('お気に入り状態を確認できませんでした。')
      } finally {
        if (active) setReady(true)
      }
    }
    void load()
    return () => { active = false }
  }, [quizId, session?.accessToken])

  const toggle = async () => {
    if (!session?.accessToken) {
      const returnTo = rememberAuthReturnPath(`/quizzes/${quizId}`)
      window.location.assign(buildAuthPath('login', returnTo))
      return
    }

    setBusy(true)
    setError('')
    try {
      const payload = bookmarked
        ? await publicApi.removeBookmark(quizId)
        : await publicApi.addBookmark(quizId)
      setBookmarked(Boolean(payload.bookmarked))
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 404) {
        setEligible(false)
        return
      }
      setError(requestError instanceof ApiError ? requestError.message : 'お気に入りを更新できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  if (!ready || !eligible) return null

  return (
    <div className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] flex-col items-end gap-2">
      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-white/95 px-3 py-2 text-xs font-semibold text-rose-700 shadow-lg backdrop-blur dark:border-rose-500/30 dark:bg-slate-900/95 dark:text-rose-200">{error}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={toggle}
        aria-pressed={bookmarked}
        className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-black shadow-xl backdrop-blur transition hover:-translate-y-0.5 focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${bookmarked ? 'border border-rose-200 bg-white/95 text-rose-600 shadow-rose-200/40 focus:ring-rose-500/20 dark:border-rose-500/30 dark:bg-slate-900/95 dark:text-rose-300' : 'bg-gradient-to-r from-cyan-500 to-indigo-500 text-white shadow-cyan-500/25 focus:ring-cyan-500/30'}`}
      >
        <HeartIcon filled={bookmarked} />
        {busy ? '更新中…' : bookmarked ? '保存済み' : 'あとで遊ぶ'}
      </button>
    </div>
  )
}
