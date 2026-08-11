import React, { useCallback, useEffect, useState } from 'react'

import { buildAuthPath, rememberAuthReturnPath } from './authNavigation.js'
import { ApiError, getStoredSession } from './api.js'
import { publicApi } from './bookmarkApi.js'
import {
  canMoveBookmarkPage,
  formatBookmarkedAt,
  normalizeBookmarkPayload,
} from './bookmarkModel.js'

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-3 font-black tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-500 text-lg text-white shadow-lg shadow-cyan-500/20">Q</span>
            <span className="text-xl">QuizVerse</span>
          </a>
          <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-2">
            <a href="/quizzes" className="rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white">クイズ</a>
            <a href="/favorites" aria-current="page" className="rounded-xl bg-slate-900 px-3 py-2 text-white dark:bg-white dark:text-slate-950">お気に入り</a>
            <a href="/profile" className="hidden rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 sm:inline-flex dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white">プロフィール</a>
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}

function LoadingPage() {
  return (
    <PageShell>
      <main className="mx-auto grid min-h-[70vh] max-w-7xl place-items-center px-4">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-cyan-100 border-t-cyan-500 dark:border-slate-800 dark:border-t-cyan-400" />
          <p className="mt-4 font-semibold text-slate-600 dark:text-slate-300">お気に入りを読み込んでいます</p>
        </div>
      </main>
    </PageShell>
  )
}

function EmptyState() {
  return (
    <section className="rounded-[2rem] border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-cyan-50 text-3xl text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300">♡</div>
      <h2 className="mt-5 text-2xl font-black">あとで遊びたいクイズを保存しよう</h2>
      <p className="mx-auto mt-3 max-w-xl leading-7 text-slate-600 dark:text-slate-300">クイズ詳細の「あとで遊ぶ」を押すと、ここからいつでも見つけ直せます。</p>
      <a href="/quizzes" className="mt-6 inline-flex rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 py-3 font-bold text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5">クイズを探す</a>
    </section>
  )
}

function BookmarkCard({ item, busy, onRemove }) {
  const quiz = item.quiz
  return (
    <article className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-cyan-300 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:hover:border-cyan-500/50">
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300">{quiz.category || 'カテゴリなし'}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{quiz.question_count}問</span>
      </div>
      <h2 className="mt-4 text-xl font-black leading-7">{quiz.title}</h2>
      <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{quiz.description_summary || '説明は登録されていません。'}</p>
      <div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <p>作成者: {quiz.author?.display_name || '匿名ユーザー'}</p>
        <p className="mt-1">{formatBookmarkedAt(item.bookmarked_at)}に保存</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemove(quiz.id)}
          className="rounded-2xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-rose-500/50 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
        >
          {busy ? '解除中…' : '保存を解除'}
        </button>
        <a href={`/quizzes/${quiz.id}`} className="rounded-2xl bg-slate-950 px-3 py-2.5 text-center text-sm font-bold text-white transition group-hover:bg-cyan-600 dark:bg-white dark:text-slate-950 dark:group-hover:bg-cyan-300">遊ぶ</a>
      </div>
    </article>
  )
}

function friendlyError(error) {
  if (!(error instanceof ApiError)) return '予期しないエラーが発生しました。'
  if (error.code === 'auth/account_inactive') return 'このアカウントではお気に入りを利用できません。'
  return error.message || 'お気に入りの取得に失敗しました。'
}

export function FavoritesApp() {
  const [session] = useState(() => getStoredSession())
  const [data, setData] = useState(() => normalizeBookmarkPayload())
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyQuizId, setBusyQuizId] = useState('')

  const loadBookmarks = useCallback(async (targetPage) => {
    setLoading(true)
    setError('')
    try {
      const payload = await publicApi.bookmarks({ page: targetPage, perPage: 12 })
      setData(normalizeBookmarkPayload(payload))
    } catch (requestError) {
      setError(friendlyError(requestError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!session?.accessToken) {
      const returnTo = rememberAuthReturnPath('/favorites')
      window.location.replace(buildAuthPath('login', returnTo))
      return
    }
    void loadBookmarks(page)
  }, [loadBookmarks, page, session?.accessToken])

  const removeBookmark = async (quizId) => {
    setBusyQuizId(String(quizId))
    setError('')
    try {
      await publicApi.removeBookmark(quizId)
      if (data.items.length === 1 && page > 1) {
        setPage((current) => current - 1)
      } else {
        await loadBookmarks(page)
      }
    } catch (requestError) {
      setError(friendlyError(requestError))
    } finally {
      setBusyQuizId('')
    }
  }

  if (!session?.accessToken || (loading && data.items.length === 0 && !error)) {
    return <LoadingPage />
  }

  return (
    <PageShell>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-950 px-6 py-8 text-white shadow-xl shadow-slate-300/30 dark:shadow-none sm:px-8 sm:py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">あとで遊ぶ</h1>
              <p className="mt-3 max-w-2xl leading-7 text-slate-300">見つけたクイズを自分だけのリストへ保存。公開中のものだけを表示するので、そのまま次の挑戦へ進めます。</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-5 py-4 backdrop-blur">
              <p className="text-xs font-bold text-cyan-200">保存中</p>
              <p className="mt-1 text-3xl font-black">{data.pagination.total}<span className="ml-1 text-sm text-slate-300">件</span></p>
            </div>
          </div>
        </section>

        {error ? (
          <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 dark:border-rose-500/30 dark:bg-rose-400/10 dark:text-rose-200">
            <span>{error}</span>
            <button type="button" onClick={() => loadBookmarks(page)} className="rounded-xl border border-rose-300 px-3 py-1.5 font-bold dark:border-rose-500/40">再試行</button>
          </div>
        ) : null}

        <div className="mt-8">
          {loading && data.items.length > 0 ? <p className="mb-4 text-sm font-semibold text-slate-500 dark:text-slate-400">更新中…</p> : null}
          {!loading && data.items.length === 0 && !error ? (
            <EmptyState />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {data.items.map((item) => (
                <BookmarkCard
                  key={item.quiz.id}
                  item={item}
                  busy={busyQuizId === String(item.quiz.id)}
                  onRemove={removeBookmark}
                />
              ))}
            </div>
          )}
        </div>

        {data.pagination.total_pages > 1 ? (
          <nav className="mt-8 flex items-center justify-center gap-3" aria-label="お気に入りページ">
            <button type="button" disabled={!canMoveBookmarkPage(data.pagination, 'previous') || loading} onClick={() => setPage((current) => current - 1)} className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">前へ</button>
            <span className="min-w-24 text-center text-sm font-bold text-slate-600 dark:text-slate-300">{data.pagination.page} / {data.pagination.total_pages}</span>
            <button type="button" disabled={!canMoveBookmarkPage(data.pagination, 'next') || loading} onClick={() => setPage((current) => current + 1)} className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">次へ</button>
          </nav>
        ) : null}
      </main>
    </PageShell>
  )
}
