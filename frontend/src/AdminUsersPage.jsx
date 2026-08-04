import { useCallback, useEffect, useState } from 'react'

import { adminApi } from './adminApi.js'

const roleOptions = [
  { value: '', label: 'すべてのロール' },
  { value: 'user', label: '一般ユーザー' },
  { value: 'admin', label: '管理者' },
]

const statusOptions = [
  { value: '', label: 'すべての状態' },
  { value: 'active', label: '有効' },
  { value: 'suspended', label: '停止中' },
  { value: 'withdrawn', label: '退会済み' },
]

function Badge({ children, tone = 'slate' }) {
  const tones = {
    cyan: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100',
    emerald: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
    amber: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
    rose: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
    slate: 'border-slate-600 bg-slate-800 text-slate-200',
  }
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

function roleTone(role) {
  return role === 'admin' ? 'cyan' : 'slate'
}

function statusTone(status) {
  if (status === 'active') return 'emerald'
  if (status === 'suspended') return 'amber'
  return 'rose'
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function LoadingRows() {
  return (
    <div className="grid gap-3">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />
      ))}
    </div>
  )
}

function UserDetail({ user, loading, error, onClose, onRoleChange, onStatusChange, updating }) {
  if (!user && !loading && !error) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/65" role="dialog" aria-modal="true" aria-label="ユーザー詳細">
      <button type="button" className="min-w-0 flex-1" aria-label="詳細を閉じる" onClick={onClose} />
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-800 bg-slate-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">User Management</p>
            <h2 className="mt-2 text-xl font-semibold">ユーザー詳細</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">
            閉じる
          </button>
        </div>

        {loading && <div className="mt-8 h-64 animate-pulse rounded-2xl bg-slate-900" />}
        {error && <p className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</p>}

        {user && (
          <div className="mt-7 space-y-5">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={roleTone(user.role)}>{user.role}</Badge>
                <Badge tone={statusTone(user.status)}>{user.status}</Badge>
                {user.is_self && <Badge tone="amber">自分のアカウント</Badge>}
              </div>
              <h3 className="mt-4 text-lg font-semibold">{user.display_name}</h3>
              <p className="mt-1 text-sm text-slate-400">{user.email_masked}</p>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">ユーザーID</dt><dd className="mt-1 text-slate-200">{user.id}</dd></div>
                <div><dt className="text-slate-500">最終ログイン</dt><dd className="mt-1 text-slate-200">{formatDate(user.last_login_at)}</dd></div>
                <div><dt className="text-slate-500">作成日時</dt><dd className="mt-1 text-slate-200">{formatDate(user.created_at)}</dd></div>
                <div><dt className="text-slate-500">更新日時</dt><dd className="mt-1 text-slate-200">{formatDate(user.updated_at)}</dd></div>
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="font-semibold">ロール変更</h3>
              <p className="mt-1 text-sm text-slate-400">自分自身のadminロールは削除できません。</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {['user', 'admin'].map((role) => (
                  <button
                    key={role}
                    type="button"
                    disabled={updating || user.role === role || (user.is_self && role !== 'admin')}
                    onClick={() => onRoleChange(role)}
                    className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium transition hover:border-cyan-400 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {role === 'admin' ? '管理者にする' : '一般ユーザーにする'}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="font-semibold">アカウント状態</h3>
              <p className="mt-1 text-sm text-slate-400">停止・退会へ変更すると既存JWTとCookieセッションも利用できなくなります。</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {['active', 'suspended', 'withdrawn'].map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={updating || user.status === status || (user.is_self && status !== 'active')}
                    onClick={() => onStatusChange(status)}
                    className="rounded-xl border border-slate-700 px-3 py-2.5 text-sm font-medium transition hover:border-cyan-400 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {status === 'active' ? '有効化' : status === 'suspended' ? '停止する' : '退会扱い'}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  )
}

export function AdminUsersPage({ currentUser }) {
  const [filters, setFilters] = useState({ q: '', role: '', status: '' })
  const [appliedFilters, setAppliedFilters] = useState({ q: '', role: '', status: '' })
  const [page, setPage] = useState(1)
  const [state, setState] = useState({ loading: true, items: [], pagination: null, error: '' })
  const [detail, setDetail] = useState({ id: null, loading: false, user: null, error: '' })
  const [updating, setUpdating] = useState(false)
  const [message, setMessage] = useState('')

  const loadUsers = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const payload = await adminApi.users({ page, perPage: 20, ...appliedFilters })
      setState({ loading: false, items: payload.items ?? [], pagination: payload.pagination ?? null, error: '' })
    } catch (error) {
      setState({ loading: false, items: [], pagination: null, error: error.message })
    }
  }, [appliedFilters, page])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const openDetail = async (userId) => {
    setDetail({ id: userId, loading: true, user: null, error: '' })
    try {
      const payload = await adminApi.user(userId)
      setDetail({ id: userId, loading: false, user: payload.user ?? null, error: '' })
    } catch (error) {
      setDetail({ id: userId, loading: false, user: null, error: error.message })
    }
  }

  const refreshDetail = async () => {
    if (!detail.id) return
    const payload = await adminApi.user(detail.id)
    setDetail({ id: detail.id, loading: false, user: payload.user ?? null, error: '' })
  }

  const applyFilters = (event) => {
    event.preventDefault()
    setPage(1)
    setAppliedFilters({ ...filters, q: filters.q.trim() })
  }

  const resetFilters = () => {
    const empty = { q: '', role: '', status: '' }
    setFilters(empty)
    setAppliedFilters(empty)
    setPage(1)
  }

  const updateRole = async (role) => {
    if (!detail.user) return
    const label = role === 'admin' ? '管理者' : '一般ユーザー'
    if (!window.confirm(`${detail.user.display_name} のロールを「${label}」へ変更しますか？`)) return
    setUpdating(true)
    setMessage('')
    try {
      await adminApi.updateUserRole(detail.user.id, role)
      await Promise.all([loadUsers(), refreshDetail()])
      setMessage('ロールを更新し、監査ログへ記録しました。')
    } catch (error) {
      setDetail((current) => ({ ...current, error: error.message }))
    } finally {
      setUpdating(false)
    }
  }

  const updateStatus = async (status) => {
    if (!detail.user) return
    const labels = { active: '有効', suspended: '停止中', withdrawn: '退会済み' }
    if (!window.confirm(`${detail.user.display_name} の状態を「${labels[status]}」へ変更しますか？`)) return
    setUpdating(true)
    setMessage('')
    try {
      await adminApi.updateUserStatus(detail.user.id, status)
      await Promise.all([loadUsers(), refreshDetail()])
      setMessage('アカウント状態を更新し、監査ログへ記録しました。')
    } catch (error) {
      setDetail((current) => ({ ...current, error: error.message }))
    } finally {
      setUpdating(false)
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">ユーザー管理</h2>
            <p className="mt-1 text-sm text-slate-400">検索・権限変更・停止／復旧をサーバー側RBACで実行します。</p>
          </div>
          <Badge tone="cyan">operator: {currentUser?.display_name ?? 'admin'}</Badge>
        </div>

        <form onSubmit={applyFilters} className="mt-5 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px_auto]">
          <label className="space-y-1.5 text-sm">
            <span className="text-slate-400">名前またはメール</span>
            <input
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              maxLength={100}
              placeholder="例: alice@example.com"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-cyan-400"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-slate-400">ロール</span>
            <select value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-cyan-400">
              {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-slate-400">状態</span>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-cyan-400">
              {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-xl bg-cyan-400 px-4 py-2.5 font-semibold text-slate-950 hover:bg-cyan-300">絞り込む</button>
            <button type="button" onClick={resetFilters} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm hover:bg-slate-800">解除</button>
          </div>
        </form>
      </div>

      {message && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">{message}</p>}
      {state.error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">{state.error}</p>}
      {state.loading && <LoadingRows />}

      {!state.loading && !state.error && (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70 md:block">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-slate-950/70 text-slate-400">
                <tr><th className="px-4 py-3">ユーザー</th><th className="px-4 py-3">メール</th><th className="px-4 py-3">ロール</th><th className="px-4 py-3">状態</th><th className="px-4 py-3">最終ログイン</th><th className="px-4 py-3"><span className="sr-only">操作</span></th></tr>
              </thead>
              <tbody>
                {state.items.map((user) => (
                  <tr key={user.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="px-4 py-3"><p className="font-medium">{user.display_name}</p><p className="text-xs text-slate-500">ID {user.id}{user.is_self ? '・自分' : ''}</p></td>
                    <td className="px-4 py-3 text-slate-400">{user.email_masked}</td>
                    <td className="px-4 py-3"><Badge tone={roleTone(user.role)}>{user.role}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={statusTone(user.status)}>{user.status}</Badge></td>
                    <td className="px-4 py-3 text-slate-400">{formatDate(user.last_login_at)}</td>
                    <td className="px-4 py-3 text-right"><button type="button" onClick={() => openDetail(user.id)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs hover:border-cyan-400 hover:text-cyan-100">詳細・変更</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {state.items.map((user) => (
              <article key={user.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{user.display_name}</p><p className="mt-1 text-xs text-slate-500">{user.email_masked}</p></div><button type="button" onClick={() => openDetail(user.id)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">詳細</button></div>
                <div className="mt-4 flex flex-wrap gap-2"><Badge tone={roleTone(user.role)}>{user.role}</Badge><Badge tone={statusTone(user.status)}>{user.status}</Badge>{user.is_self && <Badge tone="amber">自分</Badge>}</div>
              </article>
            ))}
          </div>

          {state.items.length === 0 && <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">条件に一致するユーザーはいません。</p>}

          {state.pagination && state.pagination.total_pages > 1 && (
            <nav className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-4" aria-label="ユーザーページング">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-xl border border-slate-700 px-4 py-2 text-sm disabled:opacity-40">前へ</button>
              <p className="text-sm text-slate-400">{state.pagination.page} / {state.pagination.total_pages}ページ（{state.pagination.total}件）</p>
              <button type="button" disabled={page >= state.pagination.total_pages} onClick={() => setPage((current) => current + 1)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm disabled:opacity-40">次へ</button>
            </nav>
          )}
        </>
      )}

      <UserDetail
        user={detail.user}
        loading={detail.loading}
        error={detail.error}
        onClose={() => setDetail({ id: null, loading: false, user: null, error: '' })}
        onRoleChange={updateRole}
        onStatusChange={updateStatus}
        updating={updating}
      />
    </section>
  )
}