import { useEffect, useState } from 'react'

import { AdminUsersPage } from './AdminUsersPage.jsx'
import { adminApi } from './adminApi.js'

const links = [
  ['/admin', 'ダッシュボード'],
  ['/admin/users', 'ユーザー'],
  ['/admin/quizzes', 'クイズ'],
  ['/admin/settings/email', 'メール設定'],
]

export function AdminUserManagementApp() {
  const [state, setState] = useState({ loading: true, user: null, error: '' })

  useEffect(() => {
    adminApi.session()
      .then((payload) => setState({ loading: false, user: payload.user ?? null, error: '' }))
      .catch((error) => setState({ loading: false, user: null, error: error.message }))
  }, [])

  if (state.loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-16 text-slate-100">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="h-16 animate-pulse rounded-2xl bg-slate-900" />
          <div className="h-72 animate-pulse rounded-2xl bg-slate-900" />
        </div>
      </main>
    )
  }

  if (!state.user) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-16 text-slate-100">
        <section className="mx-auto max-w-xl rounded-3xl border border-rose-500/30 bg-slate-900 p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">QuizVerse Admin</p>
          <h1 className="mt-3 text-2xl font-semibold">管理画面へアクセスできません</h1>
          <p className="mt-3 text-slate-300">{state.error || '管理者セッションを確認できませんでした。'}</p>
          <div className="mt-6 flex gap-3">
            <a href="/login?next=%2Fadmin%2Fusers" className="rounded-xl bg-cyan-400 px-4 py-2.5 font-semibold text-slate-950">ログイン</a>
            <a href="/" className="rounded-xl border border-slate-700 px-4 py-2.5">一般画面へ戻る</a>
          </div>
        </section>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-5 lg:px-6">
        <header className="sticky top-4 z-30 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 shadow-xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">QuizVerse Admin</p>
              <h1 className="mt-1 text-xl font-semibold">ユーザー管理</h1>
            </div>
            <div className="text-right text-sm">
              <p className="font-medium">{state.user.display_name}</p>
              <p className="text-xs text-slate-400">{state.user.email}</p>
            </div>
          </div>
          <nav className="mt-4 flex gap-2 overflow-x-auto" aria-label="管理画面ナビゲーション">
            {links.map(([path, label]) => (
              <a
                key={path}
                href={path}
                className={`whitespace-nowrap rounded-xl border px-3 py-2 text-sm transition ${
                  path === '/admin/users'
                    ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100'
                    : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        </header>
        <main className="mt-5">
          <AdminUsersPage currentUser={state.user} />
        </main>
      </div>
    </div>
  )
}