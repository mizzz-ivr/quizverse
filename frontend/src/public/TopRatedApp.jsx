import { useEffect, useState } from 'react'

import { ApiError } from './api.js'
import { publicApi } from './reviewApi.js'
import { formatRatingAverage, normalizeRatedQuiz, ratingStars } from './reviewModel.js'

function friendlyError(error) {
  if (!(error instanceof ApiError)) return '予期しないエラーが発生しました。'
  if (error.code === 'quiz/validation_error') return '検索条件を確認してください。'
  return error.message
}

function RatedQuizCard({ quiz }) {
  const item = normalizeRatedQuiz(quiz)
  return (
    <article className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-amber-300 hover:shadow-xl hover:shadow-amber-500/10 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-amber-500/50">
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">{item.category || 'カテゴリなし'}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{item.question_count ?? 0}問</span>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <span className="text-lg tracking-wider text-amber-500">{ratingStars(item.rating_average)}</span>
        <span className="text-sm font-black">{formatRatingAverage(item.rating_average)}</span>
        <span className="text-xs text-slate-500">{item.review_count}件</span>
      </div>
      <h2 className="mt-3 text-lg font-black tracking-tight group-hover:text-amber-700 dark:group-hover:text-amber-300">{item.title}</h2>
      <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{item.description || '説明はまだ登録されていません。'}</p>
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
        <span className="truncate text-slate-500 dark:text-slate-400">by {item.author?.display_name || '匿名ユーザー'}</span>
        <a href={`/quizzes/${item.id}`} className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 font-bold text-white transition hover:bg-amber-500 dark:bg-white dark:text-slate-950">挑戦する</a>
      </div>
    </article>
  )
}

export function TopRatedApp() {
  const [filters, setFilters] = useState({ q: '', category: '' })
  const [applied, setApplied] = useState({ q: '', category: '' })
  const [page, setPage] = useState(1)
  const [payload, setPayload] = useState({ items: [], pagination: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    publicApi.topRatedQuizzes({ ...applied, page, perPage: 12 })
      .then((data) => {
        if (!active) return
        setPayload({ items: data.items ?? [], pagination: data.pagination ?? null })
      })
      .catch((requestError) => active && setError(friendlyError(requestError)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [applied, page])

  const search = (event) => {
    event.preventDefault()
    setPage(1)
    setApplied({ q: filters.q.trim(), category: filters.category.trim() })
  }

  const reset = () => {
    setFilters({ q: '', category: '' })
    setApplied({ q: '', category: '' })
    setPage(1)
  }

  const totalPages = Number(payload.pagination?.total_pages ?? 0)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.16),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.13),_transparent_38%)]" />
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <a href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 font-black text-white shadow-lg shadow-amber-500/20">★</span><span><span className="block font-black">QuizVerse</span><span className="block text-xs text-slate-500">Top Rated</span></span></a>
          <nav className="flex items-center gap-2 text-sm font-bold"><a href="/quizzes" className="rounded-xl px-3 py-2 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900">クイズ一覧</a><a href="/favorites" className="hidden rounded-xl px-3 py-2 text-slate-600 hover:bg-white sm:inline-flex dark:text-slate-300 dark:hover:bg-slate-900">お気に入り</a><a href="/top-rated" aria-current="page" className="rounded-xl bg-slate-900 px-3 py-2 text-white dark:bg-white dark:text-slate-950">高評価</a></nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-amber-950 to-orange-950 p-6 text-white shadow-xl md:p-10">
          <div className="max-w-3xl"><p className="text-sm font-black tracking-[0.16em] text-amber-300">TOP RATED QUIZZES</p><h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">みんなが高く評価したクイズ</h1><p className="mt-4 max-w-2xl leading-7 text-slate-300">実際にプレイしたユーザーの5段階評価をもとに、平均評価が高い順でクイズを発見できます。評価が同じ場合はレビュー件数の多いクイズを優先します。</p></div>
        </section>

        <form onSubmit={search} className="mt-6 grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[1fr_260px_auto] md:p-5">
          <label><span className="sr-only">キーワード</span><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-400/10 dark:border-slate-700 dark:bg-slate-950" placeholder="タイトルや説明を検索" /></label>
          <label><span className="sr-only">カテゴリ</span><input value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-400/10 dark:border-slate-700 dark:bg-slate-950" placeholder="カテゴリ（完全一致）" /></label>
          <button className="rounded-2xl bg-slate-900 px-5 py-3 font-black text-white dark:bg-white dark:text-slate-950">絞り込む</button>
        </form>

        <div className="mt-8 flex items-end justify-between gap-4"><div><h2 className="text-2xl font-black">評価ランキング</h2><p className="mt-1 text-sm text-slate-500">平均評価 → レビュー件数 → 公開日の順</p></div><span className="text-sm font-bold text-slate-500">{payload.pagination?.total ?? 0}件</span></div>

        {error ? <div role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-500/30 dark:bg-rose-400/10 dark:text-rose-200">{error}</div> : null}

        {loading ? <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[...Array(6)].map((_, index) => <div key={index} className="h-64 animate-pulse rounded-3xl bg-slate-100 dark:bg-slate-900" />)}</div> : payload.items.length === 0 ? <section className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900"><p className="text-lg font-black">条件に合うクイズがありません</p><p className="mt-2 text-sm text-slate-500">別のキーワードやカテゴリで探してみてください。</p><button type="button" onClick={reset} className="mt-5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold dark:border-slate-700">条件をリセット</button></section> : <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{payload.items.map((quiz) => <RatedQuizCard key={quiz.id} quiz={quiz} />)}</div>}

        {totalPages > 1 ? <div className="mt-8 flex items-center justify-center gap-3"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">前へ</button><span className="text-sm text-slate-500">{page} / {totalPages}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">次へ</button></div> : null}
      </main>
    </div>
  )
}
