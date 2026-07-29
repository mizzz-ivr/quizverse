import { useEffect, useMemo, useState } from 'react'

import { buildAuthPath, rememberAuthReturnPath } from './authNavigation.js'
import { ApiError, getStoredSession, publicApi } from './api.js'

const STATUS_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'draft', label: '下書き' },
  { value: 'published', label: '公開中' },
  { value: 'archived', label: 'アーカイブ' },
]

const STATUS_META = {
  draft: {
    label: '下書き',
    className: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
  },
  published: {
    label: '公開中',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
  },
  archived: {
    label: 'アーカイブ',
    className: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
  },
}

function Icon({ name, className = 'h-5 w-5' }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'aria-hidden': true }
  if (name === 'spark') return <svg {...common}><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2L12 3Z" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" strokeWidth="1.8" strokeLinecap="round" /></svg>
  if (name === 'eye') return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" strokeWidth="1.7" /><circle cx="12" cy="12" r="2.5" strokeWidth="1.7" /></svg>
  if (name === 'publish') return <svg {...common}><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'archive') return <svg {...common}><path d="M4 7h16M5 7l1 13h12l1-13M3 4h18v3H3V4Zm6 7h6" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'draft') return <svg {...common}><path d="M6 3h9l3 3v15H6V3Z" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 11h6M9 15h5" strokeWidth="1.7" strokeLinecap="round" /></svg>
  return null
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function friendlyError(error) {
  if (!(error instanceof ApiError)) return '予期しないエラーが発生しました。'
  const messages = {
    'quiz/not_found': '対象のクイズが見つかりません。',
    'quiz/not_publishable': '公開条件を満たしていません。問題と選択肢を確認してください。',
    'quiz/invalid_status_transition': '現在の状態から指定した状態へ変更できません。',
    'quiz/status_update_failed': '状態を更新できませんでした。時間をおいて再度お試しください。',
  }
  return messages[error.code] ?? error.message
}

function LoginRequired() {
  const login = () => {
    const returnTo = rememberAuthReturnPath('/my/quizzes')
    window.location.assign(buildAuthPath('login', returnTo))
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-4xl place-items-center px-4 py-12">
      <section className="w-full rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:shadow-slate-950/50 md:p-12">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-white"><Icon name="draft" className="h-8 w-8" /></span>
        <p className="mt-6 text-sm font-semibold tracking-[0.18em] text-cyan-700 dark:text-cyan-300">MY QUIZZES</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">マイクイズを見るにはログインが必要です</h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-slate-600 dark:text-slate-300">作成した下書きの確認、公開、アーカイブを行えます。</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={login} className="rounded-2xl bg-slate-950 px-6 py-3 font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950">ログインする</button>
          <a href="/signup?next=/my/quizzes" className="rounded-2xl border border-slate-300 px-6 py-3 font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">アカウントを作る</a>
        </div>
      </section>
    </main>
  )
}

function LoadingState() {
  return (
    <div className="grid gap-5 md:grid-cols-2" aria-label="読み込み中">
      {[...Array(4)].map((_, index) => <div key={index} className="h-64 animate-pulse rounded-3xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900" />)}
    </div>
  )
}

function QuizActions({ quiz, pending, onStatusChange }) {
  const disabled = pending === quiz.id
  return (
    <div className="flex flex-wrap gap-2">
      <a href={quiz.preview_path} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"><Icon name="eye" className="h-4 w-4" />{quiz.status === 'published' ? '公開ページ' : 'プレビュー'}</a>
      {quiz.status === 'draft' ? (
        <>
          <button type="button" disabled={disabled} onClick={() => onStatusChange(quiz, 'published')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"><Icon name="publish" className="h-4 w-4" />公開する</button>
          <button type="button" disabled={disabled} onClick={() => onStatusChange(quiz, 'archived')} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"><Icon name="archive" className="h-4 w-4" />保管する</button>
        </>
      ) : null}
      {quiz.status === 'published' ? (
        <button type="button" disabled={disabled} onClick={() => onStatusChange(quiz, 'archived')} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"><Icon name="archive" className="h-4 w-4" />公開を終了</button>
      ) : null}
      {quiz.status === 'archived' ? (
        <>
          <button type="button" disabled={disabled} onClick={() => onStatusChange(quiz, 'published')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"><Icon name="publish" className="h-4 w-4" />再公開</button>
          <button type="button" disabled={disabled} onClick={() => onStatusChange(quiz, 'draft')} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"><Icon name="draft" className="h-4 w-4" />下書きへ戻す</button>
        </>
      ) : null}
    </div>
  )
}

export function MyQuizzesApp() {
  const [session] = useState(() => getStoredSession())
  const [sessionStatus, setSessionStatus] = useState(session?.accessToken ? 'checking' : 'missing')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [payload, setPayload] = useState({ items: [], pagination: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(null)
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    if (!session?.accessToken) return undefined
    let active = true
    publicApi.me(session.accessToken)
      .then(() => active && setSessionStatus('ready'))
      .catch((requestError) => {
        if (!active) return
        if (requestError instanceof ApiError && requestError.status === 401) setSessionStatus('missing')
        else {
          setSessionStatus('error')
          setError('ログイン状態を確認できませんでした。')
        }
      })
    return () => { active = false }
  }, [session?.accessToken])

  useEffect(() => {
    if (sessionStatus !== 'ready') return undefined
    let active = true
    setLoading(true)
    setError('')
    publicApi.myQuizzes({ status, page, perPage: 12 }, session.accessToken)
      .then((data) => active && setPayload({ items: data.items ?? [], pagination: data.pagination ?? null }))
      .catch((requestError) => active && setError(friendlyError(requestError)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [sessionStatus, session?.accessToken, status, page, refreshVersion])

  const counts = useMemo(() => payload.items.reduce((result, quiz) => {
    result[quiz.status] = (result[quiz.status] ?? 0) + 1
    return result
  }, {}), [payload.items])

  const changeStatus = async (quiz, nextStatus) => {
    setPending(quiz.id)
    setError('')
    setNotice('')
    try {
      const response = await publicApi.updateQuizStatus(quiz.id, nextStatus, session.accessToken)
      const label = STATUS_META[response.quiz.status]?.label ?? response.quiz.status
      setNotice(`「${quiz.title}」を${label}に変更しました。`)
      setRefreshVersion((current) => current + 1)
    } catch (requestError) {
      setError(friendlyError(requestError))
    } finally {
      setPending(null)
    }
  }

  if (!session?.accessToken || sessionStatus === 'missing') return <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"><LoginRequired /></div>

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(99,102,241,0.13),_transparent_38%)]" />
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <a href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-white"><Icon name="spark" /></span><span><span className="block font-semibold">QuizVerse</span><span className="block text-xs text-slate-500">My Quizzes</span></span></a>
          <div className="flex items-center gap-2"><a href="/quizzes" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900">クイズを探す</a><a href="/quizzes/new" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-950"><Icon name="plus" className="h-4 w-4" />新しく作る</a></div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-950 p-6 text-white shadow-2xl shadow-indigo-950/20 md:p-9">
          <p className="text-sm font-semibold tracking-[0.18em] text-cyan-300">QUIZ WORKSPACE</p>
          <div className="mt-3 flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div><h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-5xl">作ったクイズを、<br />公開まで育てる。</h1><p className="mt-5 max-w-2xl leading-7 text-slate-300">下書きの確認、公開、公開終了、再公開をここから管理できます。</p></div><div className="grid grid-cols-3 gap-3 text-center text-sm"><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs text-slate-300">表示中</p><p className="mt-1 text-2xl font-semibold">{payload.pagination?.total ?? 0}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs text-slate-300">公開中</p><p className="mt-1 text-2xl font-semibold">{counts.published ?? 0}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs text-slate-300">下書き</p><p className="mt-1 text-2xl font-semibold">{counts.draft ?? 0}</p></div></div></div>
        </section>

        <section className="mt-8 flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-2 overflow-x-auto">{STATUS_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => { setStatus(option.value); setPage(1); setNotice('') }} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium ${status === option.value ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>{option.label}</button>)}</div>
          <p className="text-sm text-slate-500">更新日時の新しい順</p>
        </section>

        {notice ? <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{notice}</div> : null}
        {error ? <div className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200" role="alert">{error}</div> : null}

        <section className="mt-7">
          {sessionStatus === 'checking' || loading ? <LoadingState /> : payload.items.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800"><Icon name="draft" className="h-7 w-7" /></span><h2 className="mt-5 text-xl font-semibold">該当するクイズはありません</h2><p className="mt-2 text-sm text-slate-500">新しいクイズを作るか、表示する状態を変更してください。</p><a href="/quizzes/new" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-slate-950"><Icon name="plus" className="h-4 w-4" />クイズを作る</a></div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">{payload.items.map((quiz) => { const meta = STATUS_META[quiz.status] ?? STATUS_META.draft; return <article key={quiz.id} className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-medium ${meta.className}`}>{meta.label}</span><span className="rounded-full bg-cyan-50 px-3 py-1 text-xs text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-200">{quiz.category || 'カテゴリなし'}</span></div><span className="text-xs text-slate-500">ID {quiz.id}</span></div><h2 className="mt-5 text-xl font-semibold tracking-tight">{quiz.title}</h2><p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{quiz.description_summary || '説明は登録されていません。'}</p><div className="mt-5 grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-950"><div><p className="text-xs text-slate-500">問題数</p><p className="mt-1 font-semibold">{quiz.question_count}問</p></div><div><p className="text-xs text-slate-500">プレイ</p><p className="mt-1 font-semibold">{quiz.play_count}回</p></div><div><p className="text-xs text-slate-500">更新</p><p className="mt-1 truncate font-semibold">{formatDate(quiz.updated_at)}</p></div></div><div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800"><QuizActions quiz={quiz} pending={pending} onStatusChange={changeStatus} /></div></article> })}</div>
          )}
        </section>

        {(payload.pagination?.total_pages ?? 1) > 1 ? <div className="mt-8 flex items-center justify-center gap-3"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">前へ</button><span className="text-sm text-slate-500">{page} / {payload.pagination.total_pages}</span><button type="button" disabled={page >= payload.pagination.total_pages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">次へ</button></div> : null}
      </main>
    </div>
  )
}
