import { useEffect, useMemo, useState } from 'react'

import { ApiError, clearSession, getStoredSession, publicApi, saveSession } from './api'

const navItems = [
  { label: 'ホーム', path: '/' },
  { label: 'クイズを探す', path: '/quizzes' },
  { label: 'ランキング', path: '/rankings' },
]

function Icon({ name, className = 'h-5 w-5' }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'aria-hidden': true }
  if (name === 'arrow') return <svg {...common}><path d="M5 12h14m-5-5 5 5-5 5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7" strokeWidth="1.8" /><path d="m16 16 4 4" strokeWidth="1.8" strokeLinecap="round" /></svg>
  if (name === 'spark') return <svg {...common}><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2L12 3Z" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  if (name === 'trophy') return <svg {...common}><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" strokeWidth="1.7" /><path d="M8 6H5v1a4 4 0 0 0 4 4M16 6h3v1a4 4 0 0 1-4 4M12 12v4m-3 4h6m-5-4h4" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'user') return <svg {...common}><circle cx="12" cy="8" r="3.5" strokeWidth="1.7" /><path d="M5 20a7 7 0 0 1 14 0" strokeWidth="1.7" strokeLinecap="round" /></svg>
  if (name === 'check') return <svg {...common}><path d="m5 12 4 4L19 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'book') return <svg {...common}><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5v-17Z" strokeWidth="1.7" strokeLinejoin="round" /><path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H20" strokeWidth="1.7" /></svg>
  return null
}

function usePublicPath() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const moveTo = (nextPath) => {
    if (nextPath === path) return
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return { path, moveTo }
}

function friendlyError(error) {
  if (!(error instanceof ApiError)) return '予期しないエラーが発生しました。'
  const messages = {
    'auth/invalid_credentials': 'メールアドレスまたはパスワードが正しくありません。',
    'auth/email_already_registered': 'このメールアドレスはすでに登録されています。',
    'auth/missing_token': 'ログインが必要です。',
    'auth/invalid_token': 'ログインの有効期限が切れました。もう一度ログインしてください。',
    'quiz/not_found': '指定されたクイズが見つかりません。',
    'quiz/invalid_answer': '回答内容を確認してください。',
  }
  return messages[error.code] ?? error.message
}

function Surface({ children, className = '' }) {
  return <section className={`rounded-3xl border border-slate-200 bg-white/90 shadow-sm shadow-slate-200/70 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-slate-950/40 ${className}`}>{children}</section>
}

function Alert({ tone = 'error', children }) {
  const toneClass = tone === 'success'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
    : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200'
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`} role="status">{children}</div>
}

function LoadingCards({ count = 6 }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="読み込み中">
      {[...Array(count)].map((_, index) => (
        <div key={index} className="h-52 animate-pulse rounded-3xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900" />
      ))}
    </div>
  )
}

function PublicShell({ children, path, moveTo, session, onLogout }) {
  const isActive = (target) => target === '/' ? path === '/' : path.startsWith(target)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-0 h-96 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(99,102,241,0.14),_transparent_38%)]" />
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <button type="button" onClick={() => moveTo('/')} className="flex items-center gap-3 text-left">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-white shadow-lg shadow-cyan-500/20"><Icon name="spark" /></span>
            <span><span className="block text-base font-semibold tracking-tight">QuizVerse</span><span className="block text-xs text-slate-500 dark:text-slate-400">知識を、遊びに変える。</span></span>
          </button>

          <nav className="hidden items-center gap-1 rounded-2xl border border-slate-200 bg-white/80 p-1 dark:border-slate-800 dark:bg-slate-900/80 md:flex">
            {navItems.map((item) => (
              <button key={item.path} type="button" onClick={() => moveTo(item.path)} className={`rounded-xl px-3 py-2 text-sm transition ${isActive(item.path) ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {session?.user ? (
              <>
                <span className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900 sm:flex"><Icon name="user" className="h-4 w-4" />{session.user.display_name || session.user.email}</span>
                <button type="button" onClick={onLogout} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">ログアウト</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => moveTo('/login')} className="rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900">ログイン</button>
                <button type="button" onClick={() => moveTo('/signup')} className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">無料で始める</button>
              </>
            )}
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3 md:hidden">
          {navItems.map((item) => (
            <button key={item.path} type="button" onClick={() => moveTo(item.path)} className={`shrink-0 rounded-xl border px-3 py-2 text-sm ${isActive(item.path) ? 'border-cyan-400 bg-cyan-50 text-cyan-800 dark:bg-cyan-500/10 dark:text-cyan-200' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>{item.label}</button>
          ))}
        </nav>
      </header>

      <main className="relative z-10 mx-auto min-h-[calc(100vh-180px)] max-w-7xl px-4 py-8 md:px-6 md:py-12">{children}</main>

      <footer className="relative z-10 border-t border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-slate-500 dark:text-slate-400 md:flex-row md:items-center md:justify-between md:px-6">
          <p>© 2026 QuizVerse. クイズで知識と人をつなぐ。</p>
          <div className="flex flex-wrap gap-4">
            <button type="button" onClick={() => window.location.assign('/status')} className="hover:text-slate-900 dark:hover:text-white">サービス状況</button>
            <button type="button" onClick={() => window.location.assign('/admin')} className="hover:text-slate-900 dark:hover:text-white">管理画面</button>
          </div>
        </div>
      </footer>
    </div>
  )
}

function QuizCard({ quiz, moveTo }) {
  return (
    <article className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-cyan-300 hover:shadow-xl hover:shadow-cyan-500/10 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-cyan-500/50">
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-200">{quiz.category || 'カテゴリなし'}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{quiz.question_count ?? 0}問</span>
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-tight group-hover:text-cyan-700 dark:group-hover:text-cyan-300">{quiz.title}</h3>
      <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{quiz.description || '説明はまだ登録されていません。'}</p>
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
        <span className="text-slate-500 dark:text-slate-400">by {quiz.author?.display_name || '匿名ユーザー'}</span>
        <button type="button" onClick={() => moveTo(`/quizzes/${quiz.id}`)} className="inline-flex items-center gap-1 font-medium text-cyan-700 hover:gap-2 dark:text-cyan-300">挑戦する<Icon name="arrow" className="h-4 w-4" /></button>
      </div>
    </article>
  )
}

function HomePage({ moveTo }) {
  const [data, setData] = useState({ quizzes: [], ranking: [], totalQuizzes: 0, totalPlayers: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([publicApi.quizzes({ perPage: 6 }), publicApi.overallRankings({ perPage: 3 })])
      .then(([quizPayload, rankingPayload]) => {
        if (!active) return
        setData({
          quizzes: quizPayload.items ?? [],
          ranking: rankingPayload.items ?? [],
          totalQuizzes: quizPayload.pagination?.total ?? 0,
          totalPlayers: rankingPayload.pagination?.total ?? 0,
        })
      })
      .catch((err) => active && setError(friendlyError(err)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  return (
    <div className="space-y-14">
      <section className="grid items-center gap-8 py-6 lg:grid-cols-[1.2fr_0.8fr] lg:py-12">
        <div>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-5xl lg:text-6xl">知るだけじゃない。<br /><span className="bg-gradient-to-r from-cyan-500 to-indigo-500 bg-clip-text text-transparent">答えるほど、世界が広がる。</span></h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300 md:text-lg">QuizVerseは、気になるテーマを見つけて、すぐに挑戦できるクイズプラットフォーム。結果を記録し、ランキングで仲間と競えます。</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={() => moveTo('/quizzes')} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 font-medium text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">クイズを探す<Icon name="arrow" /></button>
            <button type="button" onClick={() => moveTo('/rankings')} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 font-medium hover:border-cyan-400 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-900 dark:hover:text-cyan-300"><Icon name="trophy" />ランキングを見る</button>
          </div>
        </div>

        <Surface className="overflow-hidden p-5 md:p-6">
          <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-950 p-6 text-white">
            <div className="flex items-center justify-between"><span className="text-sm text-cyan-100">今日のクイズ体験</span><Icon name="spark" className="h-7 w-7 text-cyan-300" /></div>
            <p className="mt-10 text-3xl font-semibold tracking-tight">ひとつの正解が、<br />次の好奇心になる。</p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur"><p className="text-xs text-cyan-100">公開クイズ</p><p className="mt-2 text-2xl font-semibold">{loading ? '—' : data.totalQuizzes}</p></div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur"><p className="text-xs text-cyan-100">ランキング参加者</p><p className="mt-2 text-2xl font-semibold">{loading ? '—' : data.totalPlayers}</p></div>
            </div>
          </div>
        </Surface>
      </section>

      {error && <Alert>{error}</Alert>}

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium text-cyan-700 dark:text-cyan-300">DISCOVER</p><h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">新しいクイズを見つける</h2></div><button type="button" onClick={() => moveTo('/quizzes')} className="inline-flex items-center gap-2 text-sm font-medium text-cyan-700 dark:text-cyan-300">すべて見る<Icon name="arrow" className="h-4 w-4" /></button></div>
        {loading ? <LoadingCards count={3} /> : data.quizzes.length === 0 ? <EmptyState title="クイズはまだありません" description="最初のクイズが公開されるまでお待ちください。" /> : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{data.quizzes.slice(0, 3).map((quiz) => <QuizCard key={quiz.id} quiz={quiz} moveTo={moveTo} />)}</div>}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
        <Surface className="p-6 md:p-8"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"><Icon name="trophy" /></span><div><p className="text-sm text-slate-500 dark:text-slate-400">Overall ranking</p><h2 className="text-xl font-semibold">トッププレイヤー</h2></div></div><div className="mt-6 space-y-3">{loading ? [...Array(3)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />) : data.ranking.length === 0 ? <p className="text-sm text-slate-500">ランキングデータはまだありません。</p> : data.ranking.map((item, index) => <div key={item.user?.id ?? index} className="flex items-center gap-4 rounded-2xl border border-slate-100 px-4 py-3 dark:border-slate-800"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 font-semibold dark:bg-slate-800">{item.rank ?? index + 1}</span><span className="flex-1 font-medium">{item.user?.display_name || '匿名ユーザー'}</span><span className="text-sm text-slate-500 dark:text-slate-400">{item.total_score ?? 0} pt</span></div>)}</div></Surface>
        <Surface className="flex flex-col justify-between bg-gradient-to-br from-cyan-50 to-indigo-50 p-6 dark:from-cyan-500/10 dark:to-indigo-500/10 md:p-8"><div><Icon name="book" className="h-9 w-9 text-indigo-500" /><h2 className="mt-6 text-2xl font-semibold tracking-tight">学びを、ゲームのように。</h2><p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">短い時間でも挑戦でき、結果はすぐにスコアへ。毎日の小さな好奇心を積み重ねられます。</p></div><button type="button" onClick={() => moveTo('/signup')} className="mt-8 inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-500">アカウントを作る<Icon name="arrow" /></button></Surface>
      </section>
    </div>
  )
}

function AuthPage({ mode, moveTo, onAuthenticated }) {
  const isSignup = mode === 'signup'
  const [form, setForm] = useState({ display_name: '', email: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!form.email.trim() || !form.password) return setError('メールアドレスとパスワードを入力してください。')
    if (form.password.length < 8) return setError('パスワードは8文字以上で入力してください。')

    setSubmitting(true)
    try {
      const payload = isSignup
        ? await publicApi.register({ email: form.email.trim(), password: form.password, display_name: form.display_name.trim() || undefined })
        : await publicApi.login({ email: form.email.trim(), password: form.password })
      onAuthenticated(payload)
      moveTo('/quizzes')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl items-stretch gap-6 lg:grid-cols-2">
      <Surface className="hidden overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-950 p-8 text-white lg:flex lg:flex-col lg:justify-between">
        <div><span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10"><Icon name="spark" /></span><h1 className="mt-8 text-4xl font-semibold tracking-tight">好奇心を、<br />スコアに変えよう。</h1><p className="mt-5 max-w-md leading-7 text-slate-300">アカウントを作ると、クイズの回答結果が保存され、ランキングに参加できます。</p></div>
        <div className="grid grid-cols-3 gap-3 text-sm"><div className="rounded-2xl bg-white/10 p-4">探す</div><div className="rounded-2xl bg-white/10 p-4">答える</div><div className="rounded-2xl bg-white/10 p-4">競う</div></div>
      </Surface>

      <Surface className="p-6 md:p-10">
        <p className="text-sm font-medium text-cyan-700 dark:text-cyan-300">{isSignup ? 'CREATE ACCOUNT' : 'WELCOME BACK'}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{isSignup ? 'QuizVerseを始める' : 'ログイン'}</h1>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{isSignup ? '無料アカウントを作成してクイズに挑戦しましょう。' : '登録済みのアカウントで続きから始めましょう。'}</p>
        {error && <div className="mt-5"><Alert>{error}</Alert></div>}
        <form onSubmit={submit} className="mt-7 space-y-5">
          {isSignup && <label className="block text-sm font-medium"><span>表示名</span><input value={form.display_name} onChange={(event) => setForm((prev) => ({ ...prev, display_name: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" placeholder="クイズプレイヤー" autoComplete="name" /></label>}
          <label className="block text-sm font-medium"><span>メールアドレス</span><input type="email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" placeholder="you@example.com" autoComplete="email" required /></label>
          <label className="block text-sm font-medium"><span>パスワード</span><input type="password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" placeholder="8文字以上" autoComplete={isSignup ? 'new-password' : 'current-password'} required /></label>
          <button disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">{submitting ? '送信中...' : isSignup ? '無料アカウントを作成' : 'ログイン'}<Icon name="arrow" /></button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">{isSignup ? 'すでにアカウントをお持ちですか？' : 'アカウントをお持ちでないですか？'} <button type="button" onClick={() => moveTo(isSignup ? '/login' : '/signup')} className="font-medium text-cyan-700 hover:underline dark:text-cyan-300">{isSignup ? 'ログイン' : '新規登録'}</button></p>
      </Surface>
    </div>
  )
}

function EmptyState({ title, description, action }) {
  return <Surface className="grid place-items-center p-10 text-center"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800"><Icon name="search" className="h-7 w-7" /></span><h2 className="mt-5 text-xl font-semibold">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>{action && <div className="mt-5">{action}</div>}</Surface>
}

function QuizListPage({ moveTo }) {
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
    publicApi.quizzes({ ...applied, page, perPage: 9 })
      .then((data) => active && setPayload({ items: data.items ?? [], pagination: data.pagination ?? null }))
      .catch((err) => active && setError(friendlyError(err)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [applied, page])

  const search = (event) => {
    event.preventDefault()
    setPage(1)
    setApplied({ q: filters.q.trim(), category: filters.category.trim() })
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-sm font-medium text-cyan-700 dark:text-cyan-300">QUIZ LIBRARY</p><h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">クイズを探す</h1><p className="mt-3 text-slate-600 dark:text-slate-400">興味のあるキーワードやカテゴリから、次の挑戦を見つけましょう。</p></div><span className="text-sm text-slate-500">{payload.pagination?.total ?? 0}件</span></div>

      <Surface className="p-4 md:p-5"><form onSubmit={search} className="grid gap-3 md:grid-cols-[1fr_240px_auto]"><label className="relative"><span className="sr-only">キーワード</span><Icon name="search" className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input value={filters.q} onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-12 pr-4 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" placeholder="タイトルや説明を検索" /></label><label><span className="sr-only">カテゴリ</span><input value={filters.category} onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" placeholder="カテゴリ（完全一致）" /></label><button className="rounded-2xl bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950">検索</button></form></Surface>

      {error && <Alert>{error}</Alert>}
      {loading ? <LoadingCards /> : payload.items.length === 0 ? <EmptyState title="条件に合うクイズがありません" description="検索条件を変更して、もう一度探してみてください。" action={<button type="button" onClick={() => { setFilters({ q: '', category: '' }); setApplied({ q: '', category: '' }); setPage(1) }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">条件をリセット</button>} /> : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{payload.items.map((quiz) => <QuizCard key={quiz.id} quiz={quiz} moveTo={moveTo} />)}</div>}

      {(payload.pagination?.total_pages ?? 1) > 1 && <div className="flex items-center justify-center gap-3"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">前へ</button><span className="text-sm text-slate-500">{page} / {payload.pagination.total_pages}</span><button type="button" disabled={page >= payload.pagination.total_pages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">次へ</button></div>}
    </div>
  )
}

function QuizDetailPage({ quizId, moveTo, session }) {
  const [quiz, setQuiz] = useState(null)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    publicApi.quiz(quizId)
      .then((payload) => active && setQuiz(payload.quiz ?? null))
      .catch((err) => active && setError(friendlyError(err)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [quizId])

  const answeredCount = Object.keys(answers).length
  const submit = async () => {
    if (!session?.accessToken) return moveTo('/login')
    setSubmitting(true)
    setError('')
    try {
      const answerList = Object.entries(answers).map(([questionId, choiceId]) => ({ question_id: Number(questionId), selected_choice_id: Number(choiceId) }))
      const payload = await publicApi.playQuiz(quizId, answerList, session.accessToken)
      setResult(payload.play ?? null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="space-y-4"><div className="h-52 animate-pulse rounded-3xl bg-slate-100 dark:bg-slate-900" />{[...Array(3)].map((_, i) => <div key={i} className="h-64 animate-pulse rounded-3xl bg-slate-100 dark:bg-slate-900" />)}</div>
  if (!quiz) return <EmptyState title="クイズを表示できません" description={error || '指定されたクイズが見つかりません。'} action={<button type="button" onClick={() => moveTo('/quizzes')} className="rounded-xl bg-slate-950 px-4 py-2 text-sm text-white dark:bg-white dark:text-slate-950">一覧へ戻る</button>} />

  return (
    <div className="space-y-6">
      <Surface className="overflow-hidden"><div className="bg-gradient-to-r from-slate-950 via-indigo-950 to-cyan-950 p-6 text-white md:p-8"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-xs">{quiz.category || 'カテゴリなし'}</span><span className="rounded-full bg-white/10 px-3 py-1 text-xs">{quiz.question_count ?? quiz.questions?.length ?? 0}問</span></div><h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-4xl">{quiz.title}</h1><p className="mt-4 max-w-3xl leading-7 text-slate-300">{quiz.description || '説明は登録されていません。'}</p><div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300"><span>作成者: {quiz.author?.display_name || '匿名ユーザー'}</span><button type="button" onClick={() => moveTo(`/quizzes/${quizId}/rankings`)} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white hover:bg-white/20"><Icon name="trophy" className="h-4 w-4" />このクイズのランキング</button></div></div></Surface>

      {result && <Surface className="border-cyan-300 bg-gradient-to-br from-cyan-50 to-indigo-50 p-6 dark:border-cyan-500/40 dark:from-cyan-500/10 dark:to-indigo-500/10 md:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-cyan-700 dark:text-cyan-300">RESULT</p><h2 className="mt-2 text-3xl font-semibold">{result.correct_count} / {result.total_questions}問 正解</h2><p className="mt-2 text-slate-600 dark:text-slate-300">スコア {result.score}点・正答率 {result.score_percentage}%</p></div><span className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-2xl font-semibold shadow-sm dark:bg-slate-900">{Math.round(result.score_percentage)}%</span></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/70"><p className="text-xs text-slate-500">正解</p><p className="mt-1 text-xl font-semibold text-emerald-600">{result.correct_count}</p></div><div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/70"><p className="text-xs text-slate-500">不正解</p><p className="mt-1 text-xl font-semibold text-rose-600">{result.incorrect_count}</p></div><div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/70"><p className="text-xs text-slate-500">未回答</p><p className="mt-1 text-xl font-semibold text-amber-600">{result.skipped_count}</p></div></div></Surface>}

      {error && <Alert>{error}</Alert>}

      <div className="space-y-5">{(quiz.questions ?? []).map((question, index) => <Surface key={question.id} className="p-5 md:p-7"><div className="flex gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-950 font-semibold text-white dark:bg-white dark:text-slate-950">{index + 1}</span><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold leading-7">{question.body}</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{(question.choices ?? []).map((choice) => { const selected = Number(answers[question.id]) === Number(choice.id); return <label key={choice.id} className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition ${selected ? 'border-cyan-500 bg-cyan-50 text-cyan-900 ring-4 ring-cyan-500/10 dark:bg-cyan-500/10 dark:text-cyan-100' : 'border-slate-200 bg-white hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-950'}`}><input type="radio" name={`question-${question.id}`} value={choice.id} checked={selected} onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: choice.id }))} className="h-4 w-4 accent-cyan-600" /><span>{choice.body}</span></label> })}</div></div></div></Surface>)}</div>

      <Surface className="sticky bottom-4 z-20 flex flex-col items-stretch justify-between gap-4 border-cyan-200 p-4 shadow-xl dark:border-cyan-500/30 sm:flex-row sm:items-center"><div><p className="font-medium">{answeredCount} / {quiz.questions?.length ?? 0}問 回答済み</p><p className="text-xs text-slate-500 dark:text-slate-400">未回答の問題はスキップとして採点されます。</p></div>{session?.accessToken ? <button type="button" disabled={submitting} onClick={submit} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-6 py-3 font-medium text-white hover:bg-cyan-500 disabled:opacity-60">{submitting ? '採点中...' : result ? 'もう一度採点する' : '回答を送信する'}<Icon name="check" /></button> : <button type="button" onClick={() => moveTo('/login')} className="rounded-2xl bg-slate-950 px-6 py-3 font-medium text-white dark:bg-white dark:text-slate-950">ログインして回答する</button>}</Surface>
    </div>
  )
}

function rankTone(rank) {
  if (rank === 1) return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
  if (rank === 2) return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100'
  if (rank === 3) return 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200'
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
}

function RankingsPage({ quizId = null, moveTo }) {
  const [items, setItems] = useState([])
  const [quiz, setQuiz] = useState(null)
  const [pagination, setPagination] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const rankingPromise = quizId ? publicApi.quizRankings(quizId, { page }) : publicApi.overallRankings({ page })
    const quizPromise = quizId && !quiz ? publicApi.quiz(quizId) : Promise.resolve(null)
    Promise.all([rankingPromise, quizPromise])
      .then(([rankingPayload, quizPayload]) => {
        if (!active) return
        setItems(rankingPayload.items ?? [])
        setPagination(rankingPayload.pagination ?? null)
        if (quizPayload?.quiz) setQuiz(quizPayload.quiz)
      })
      .catch((err) => active && setError(friendlyError(err)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [page, quizId])

  return (
    <div className="space-y-8">
      <div><p className="text-sm font-medium text-amber-700 dark:text-amber-300">LEADERBOARD</p><h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{quizId ? `${quiz?.title || 'クイズ'}のランキング` : '総合ランキング'}</h1><p className="mt-3 text-slate-600 dark:text-slate-400">{quizId ? 'ユーザーごとのベストスコアで順位を決定します。' : '各クイズのベストスコアを合計した総合順位です。'}</p>{quizId && <button type="button" onClick={() => moveTo(`/quizzes/${quizId}`)} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-cyan-700 dark:text-cyan-300">クイズへ戻る</button>}</div>
      {error && <Alert>{error}</Alert>}
      <Surface className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800"><div className="grid grid-cols-[64px_1fr_auto] items-center gap-3 text-xs font-medium uppercase tracking-wider text-slate-500"><span>順位</span><span>プレイヤー</span><span>{quizId ? 'スコア' : '合計'}</span></div></div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">{loading ? [...Array(8)].map((_, i) => <div key={i} className="h-20 animate-pulse bg-slate-50 dark:bg-slate-900" />) : items.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">ランキングデータはまだありません。</div> : items.map((item, index) => { const rank = item.rank ?? index + 1; return <div key={`${item.user?.id ?? index}-${rank}`} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 px-5 py-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/50"><span className={`grid h-10 w-10 place-items-center rounded-2xl font-semibold ${rankTone(rank)}`}>{rank}</span><div className="min-w-0"><p className="truncate font-medium">{item.user?.display_name || '匿名ユーザー'}</p><p className="mt-1 text-xs text-slate-500">{quizId ? `${item.correct_count ?? 0}問正解` : `${item.quiz_count ?? 0}クイズ参加`}</p></div><div className="text-right"><p className="text-lg font-semibold">{quizId ? item.score ?? 0 : item.total_score ?? 0}</p><p className="text-xs text-slate-500">point</p></div></div> })}</div>
      </Surface>
      {(pagination?.total_pages ?? 1) > 1 && <div className="flex items-center justify-center gap-3"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">前へ</button><span className="text-sm text-slate-500">{page} / {pagination.total_pages}</span><button type="button" disabled={page >= pagination.total_pages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">次へ</button></div>}
    </div>
  )
}

function NotFoundPage({ moveTo }) {
  return <EmptyState title="ページが見つかりません" description="URLが変更されたか、ページが削除された可能性があります。" action={<button type="button" onClick={() => moveTo('/')} className="rounded-xl bg-slate-950 px-4 py-2 text-sm text-white dark:bg-white dark:text-slate-950">ホームへ戻る</button>} />
}

export function PublicQuizApp() {
  const { path, moveTo } = usePublicPath()
  const [session, setSession] = useState(() => getStoredSession())

  useEffect(() => {
    if (!session?.accessToken) return
    let active = true
    publicApi.me(session.accessToken)
      .then((payload) => {
        if (!active) return
        setSession(saveSession({ access_token: session.accessToken, user: payload.user }))
      })
      .catch((error) => {
        if (active && error instanceof ApiError && error.status === 401) setSession(null)
      })
    return () => { active = false }
  }, [session?.accessToken])

  const onAuthenticated = (payload) => setSession(saveSession(payload))
  const onLogout = () => {
    clearSession()
    setSession(null)
    moveTo('/')
  }

  const page = useMemo(() => {
    const quizRankingMatch = path.match(/^\/quizzes\/(\d+)\/rankings$/)
    if (quizRankingMatch) return <RankingsPage quizId={quizRankingMatch[1]} moveTo={moveTo} />
    const quizDetailMatch = path.match(/^\/quizzes\/(\d+)$/)
    if (quizDetailMatch) return <QuizDetailPage quizId={quizDetailMatch[1]} moveTo={moveTo} session={session} />
    if (path === '/') return <HomePage moveTo={moveTo} />
    if (path === '/login') return <AuthPage mode="login" moveTo={moveTo} onAuthenticated={onAuthenticated} />
    if (path === '/signup') return <AuthPage mode="signup" moveTo={moveTo} onAuthenticated={onAuthenticated} />
    if (path === '/quizzes') return <QuizListPage moveTo={moveTo} />
    if (path === '/rankings') return <RankingsPage moveTo={moveTo} />
    return <NotFoundPage moveTo={moveTo} />
  }, [path, session])

  return <PublicShell path={path} moveTo={moveTo} session={session} onLogout={onLogout}>{page}</PublicShell>
}
