import { useEffect, useMemo, useState } from 'react'

import { adminApi } from './adminApi.js'
import { ApiError } from './public/api.js'

const navItems = [
  { label: 'ダッシュボード', path: '/admin' },
  { label: 'ユーザー', path: '/admin/users' },
  { label: 'クイズ', path: '/admin/quizzes' },
  { label: 'メール設定', path: '/admin/settings/email' },
]

const defaultEmailSettings = {
  sender_name: '',
  sender_email: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_username: '',
  smtp_password: '',
  use_tls: true,
  use_ssl: false,
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const moveTo = (nextPath) => {
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
  }

  return { path, moveTo }
}

function useAdminSession() {
  const [state, setState] = useState({ loading: true, user: null, error: null })

  const load = async () => {
    setState({ loading: true, user: null, error: null })
    try {
      localStorage.removeItem('quizverse_is_admin')
      const payload = await adminApi.session()
      setState({ loading: false, user: payload.user ?? null, error: null })
    } catch (error) {
      setState({
        loading: false,
        user: null,
        error: error instanceof ApiError ? error : new ApiError('管理者セッションを確認できませんでした。', 0),
      })
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return { ...state, reload: load }
}

function LoadingScreen() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-16 text-slate-100">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="h-3 w-28 animate-pulse rounded bg-cyan-400/30" />
        <div className="mt-5 h-8 w-72 animate-pulse rounded bg-slate-700" />
        <div className="mt-6 h-24 animate-pulse rounded-2xl bg-slate-800" />
      </div>
    </main>
  )
}

function AccessError({ error, onRetry }) {
  const isUnauthenticated = error?.status === 401
  const isForbidden = error?.status === 403
  const title = isUnauthenticated
    ? 'ログインが必要です'
    : isForbidden
      ? '管理者権限がありません'
      : '管理画面へ接続できません'
  const message = isUnauthenticated
    ? '管理者アカウントでログインしてから、もう一度アクセスしてください。'
    : isForbidden
      ? 'このアカウントにはadminロールが付与されていません。管理者へ確認してください。'
      : error?.message ?? '時間を置いて再試行してください。'
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`)

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-16 text-slate-100">
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8 shadow-2xl shadow-black/40">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">QuizVerse Admin</p>
        <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
        <p className="mt-3 leading-7 text-slate-300">{message}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          {isUnauthenticated && (
            <a
              href={`/login?next=${next}`}
              className="rounded-xl bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              ログインへ進む
            </a>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="rounded-xl border border-slate-700 px-5 py-2.5 font-semibold text-slate-200 transition hover:bg-slate-800"
          >
            再試行
          </button>
          <a href="/" className="rounded-xl px-5 py-2.5 text-slate-400 transition hover:text-white">
            一般画面へ戻る
          </a>
        </div>
      </section>
    </main>
  )
}

function AdminShell({ children, path, moveTo, user, onLogout }) {
  const [loggingOut, setLoggingOut] = useState(false)

  const logout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await onLogout()
      window.location.assign('/login')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-7xl gap-5 px-4 py-5 lg:px-6">
        <aside className="sticky top-5 hidden h-[calc(100vh-2.5rem)] w-72 shrink-0 flex-col rounded-3xl border border-slate-800 bg-slate-900/85 p-5 shadow-2xl shadow-black/30 backdrop-blur lg:flex">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">QuizVerse Admin</p>
          <h1 className="mt-2 text-xl font-semibold">管理コンソール</h1>
          <nav className="mt-7 space-y-2">
            {navItems.map((item) => (
              <button
                key={item.path}
                type="button"
                onClick={() => moveTo(item.path)}
                className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                  path === item.path || (item.path === '/admin/settings/email' && path === '/admin/settings')
                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                    : 'border-slate-800 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100">
            <p className="font-semibold">RBAC保護中</p>
            <p className="mt-1 text-emerald-200/80">サーバー上のadminロールで認可されています。</p>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-5 z-20 mb-5 rounded-2xl border border-slate-800 bg-slate-900/90 px-4 py-3 shadow-xl backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">Admin Area</p>
                <p className="font-medium text-slate-200">{user.display_name}</p>
                <p className="text-xs text-slate-400">{user.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                  role: {user.role}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  disabled={loggingOut}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-sm transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {loggingOut ? 'ログアウト中…' : 'ログアウト'}
                </button>
              </div>
            </div>
            <nav className="mt-3 flex gap-2 overflow-x-auto lg:hidden">
              {navItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => moveTo(item.path)}
                  className="whitespace-nowrap rounded-lg border border-slate-700 px-3 py-1.5 text-xs"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </header>
          {children}
        </div>
      </div>
    </div>
  )
}

function PageState({ loading, error, children }) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />
        ))}
      </div>
    )
  }
  if (error) {
    return <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100">{error}</div>
  }
  return children
}

function DashboardPage() {
  const [state, setState] = useState({ loading: true, data: null, error: '' })

  useEffect(() => {
    const load = async () => {
      try {
        const [overview, status] = await Promise.all([adminApi.overview(), adminApi.status()])
        setState({ loading: false, data: { overview, status }, error: '' })
      } catch (error) {
        setState({ loading: false, data: null, error: error.message })
      }
    }
    void load()
  }, [])

  const cards = useMemo(() => {
    const summary = state.data?.overview?.summary ?? {}
    return [
      ['ユーザー', summary.users ?? 0],
      ['クイズ', summary.quizzes ?? 0],
      ['プレイ', summary.plays ?? 0],
      ['ランキング件数', summary.ranking_entries ?? 0],
    ]
  }, [state.data])

  return (
    <PageState loading={state.loading} error={state.error}>
      <section className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(([label, value]) => (
            <article key={label} className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/60 p-5 shadow-lg">
              <p className="text-sm text-slate-400">{label}</p>
              <p className="mt-4 text-3xl font-semibold text-cyan-200">{value}</p>
            </article>
          ))}
        </div>
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">内部サービス状況</h2>
              <p className="mt-1 text-sm text-slate-400">adminロールだけが取得できる運用情報です。</p>
            </div>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
              {state.data?.status?.status?.overall ?? 'unknown'}
            </span>
          </div>
        </article>
      </section>
    </PageState>
  )
}

function UsersPage() {
  const [state, setState] = useState({ loading: true, items: [], error: '' })

  useEffect(() => {
    adminApi.users({ perPage: 50 })
      .then((payload) => setState({ loading: false, items: payload.items ?? [], error: '' }))
      .catch((error) => setState({ loading: false, items: [], error: error.message }))
  }, [])

  return (
    <PageState loading={state.loading} error={state.error}>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="text-lg font-semibold">ユーザー一覧</h2>
        <p className="mt-1 text-sm text-slate-400">ロール変更・停止操作は次の管理機能Issueで追加します。</p>
        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-950/70 text-slate-400">
              <tr><th className="px-3 py-3">ID</th><th className="px-3 py-3">名前</th><th className="px-3 py-3">Email</th><th className="px-3 py-3">ロール</th><th className="px-3 py-3">状態</th></tr>
            </thead>
            <tbody>
              {state.items.map((user) => (
                <tr key={user.id} className="border-t border-slate-800">
                  <td className="px-3 py-3 text-slate-400">{user.id}</td>
                  <td className="px-3 py-3">{user.display_name}</td>
                  <td className="px-3 py-3 text-slate-400">{user.email_masked}</td>
                  <td className="px-3 py-3"><span className="rounded-full border border-cyan-500/30 px-2 py-1 text-xs text-cyan-200">{user.role}</span></td>
                  <td className="px-3 py-3">{user.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.items.length === 0 && <p className="p-6 text-sm text-slate-400">ユーザーが存在しません。</p>}
        </div>
      </section>
    </PageState>
  )
}

function QuizzesPage() {
  const [state, setState] = useState({ loading: true, items: [], error: '' })

  useEffect(() => {
    adminApi.quizzes({ perPage: 50 })
      .then((payload) => setState({ loading: false, items: payload.items ?? [], error: '' }))
      .catch((error) => setState({ loading: false, items: [], error: error.message }))
  }, [])

  return (
    <PageState loading={state.loading} error={state.error}>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="text-lg font-semibold">クイズ一覧</h2>
        <div className="mt-5 grid gap-3">
          {state.items.map((quiz) => (
            <article key={quiz.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-medium">{quiz.title}</p><p className="mt-1 text-sm text-slate-400">作成者: {quiz.author?.display_name}</p></div>
                <div className="text-right text-xs text-slate-400"><p>{quiz.status}</p><p className="mt-1">{quiz.play_count} plays</p></div>
              </div>
            </article>
          ))}
          {state.items.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-6 text-sm text-slate-400">クイズが存在しません。</p>}
        </div>
      </section>
    </PageState>
  )
}

function EmailSettingsPage() {
  const [form, setForm] = useState(defaultEmailSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi.emailSettings()
      .then((payload) => {
        const settings = payload.email_settings ?? {}
        setForm({
          ...defaultEmailSettings,
          sender_name: settings.sender_name ?? '',
          sender_email: settings.sender_email ?? '',
          smtp_host: settings.smtp_host ?? '',
          smtp_port: settings.smtp_port ?? 587,
          smtp_username: settings.smtp_username ?? '',
          use_tls: Boolean(settings.use_tls),
          use_ssl: Boolean(settings.use_ssl),
        })
        setLoading(false)
      })
      .catch((loadError) => {
        setError(loadError.message)
        setLoading(false)
      })
  }, [])

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const save = async () => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await adminApi.updateEmailSettings({
        ...form,
        smtp_port: Number(form.smtp_port),
        sender_name: form.sender_name.trim(),
        sender_email: form.sender_email.trim(),
        smtp_host: form.smtp_host.trim(),
        smtp_username: form.smtp_username.trim(),
      })
      setForm((current) => ({ ...current, smtp_password: '' }))
      setMessage('メール設定を保存しました。')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageState loading={loading} error="">
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div><h2 className="text-lg font-semibold">メール設定</h2><p className="mt-1 text-sm text-slate-400">保存操作はCookie認証とCSRF二重送信で保護されています。</p></div>
        {message && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{message}</p>}
        {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ['sender_name', '送信元名', 'text'],
            ['sender_email', '送信元メール', 'email'],
            ['smtp_host', 'SMTPホスト', 'text'],
            ['smtp_port', 'SMTPポート', 'number'],
            ['smtp_username', 'SMTPユーザー名', 'text'],
            ['smtp_password', 'SMTPパスワード（変更時のみ）', 'password'],
          ].map(([key, label, type]) => (
            <label key={key} className="space-y-2 text-sm"><span className="text-slate-300">{label}</span><input type={type} value={form[key]} onChange={(event) => update(key, event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-cyan-400" /></label>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.use_tls} onChange={(event) => update('use_tls', event.target.checked)} />STARTTLS</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.use_ssl} onChange={(event) => update('use_ssl', event.target.checked)} />SSL/TLS</label>
        </div>
        <button type="button" disabled={saving} onClick={save} className="rounded-xl bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60">{saving ? '保存中…' : '保存する'}</button>
      </section>
    </PageState>
  )
}

export function AdminApp() {
  const { path, moveTo } = usePath()
  const session = useAdminSession()

  if (session.loading) return <LoadingScreen />
  if (!session.user) return <AccessError error={session.error} onRetry={session.reload} />

  let page
  if (path === '/admin') page = <DashboardPage />
  else if (path === '/admin/users') page = <UsersPage />
  else if (path === '/admin/quizzes') page = <QuizzesPage />
  else if (path === '/admin/settings' || path === '/admin/settings/email') page = <EmailSettingsPage />
  else page = <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">管理ページが見つかりません。</div>

  return (
    <AdminShell path={path} moveTo={moveTo} user={session.user} onLogout={adminApi.logout}>
      {page}
    </AdminShell>
  )
}
