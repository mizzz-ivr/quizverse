import { useEffect, useState } from 'react'

const statusTone = {
  normal: 'border-emerald-300/60 bg-gradient-to-br from-emerald-100 to-white text-emerald-700 dark:border-emerald-500/40 dark:from-emerald-500/15 dark:to-slate-900 dark:text-emerald-200',
  warning: 'border-amber-300/70 bg-gradient-to-br from-amber-100 to-white text-amber-700 dark:border-amber-500/40 dark:from-amber-500/15 dark:to-slate-900 dark:text-amber-200',
  outage: 'border-rose-300/70 bg-gradient-to-br from-rose-100 to-white text-rose-700 dark:border-rose-500/40 dark:from-rose-500/15 dark:to-slate-900 dark:text-rose-200',
  maintenance: 'border-indigo-300/70 bg-gradient-to-br from-indigo-100 to-white text-indigo-700 dark:border-indigo-500/40 dark:from-indigo-500/15 dark:to-slate-900 dark:text-indigo-200',
}

const statusLabel = {
  normal: '正常',
  warning: '注意',
  outage: '障害',
  maintenance: 'メンテナンス中',
}

function LoadingCard() {
  return <div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900" />
}

function useServiceStatus() {
  const [state, setState] = useState({ loading: true, status: null, error: '' })

  const load = async () => {
    setState({ loading: true, status: null, error: '' })
    try {
      const response = await fetch('/api/status', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'サービス状況の取得に失敗しました。')
      }
      setState({ loading: false, status: payload.status ?? null, error: '' })
    } catch (error) {
      setState({
        loading: false,
        status: null,
        error: error instanceof Error ? error.message : 'サービス状況の取得に失敗しました。',
      })
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return { ...state, reload: load }
}

export function App() {
  const { loading, status, error, reload } = useServiceStatus()
  const components = Object.entries(status?.components ?? {})

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white/85 px-5 py-5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-600 dark:text-cyan-300">QuizVerse Status</p>
              <h1 className="mt-2 text-2xl font-semibold">サービス状況</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">アプリ・API・DB・認証・メール基盤の稼働状態を表示します。</p>
            </div>
            <div className="flex gap-2">
              <a href="/" className="rounded-xl border border-slate-200 px-4 py-2 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">ホーム</a>
              <a href="/admin" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-cyan-400 dark:text-slate-950 dark:hover:bg-cyan-300">管理画面</a>
            </div>
          </div>
        </header>

        {error && (
          <section className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-rose-700 dark:text-rose-200">
            <p>{error}</p>
            <button type="button" onClick={reload} className="mt-3 rounded-lg border border-current/30 px-3 py-1.5 text-sm">再試行</button>
          </section>
        )}

        <section className={`rounded-3xl border p-6 shadow-sm ${statusTone[status?.overall] ?? statusTone.warning}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm opacity-80">全体ステータス</p>
              <h2 className="mt-1 text-3xl font-semibold">{statusLabel[status?.overall] ?? '確認中'}</h2>
            </div>
            <span className="rounded-full border border-current/30 px-3 py-1 text-xs">
              最終更新: {status?.updated_at ? new Date(status.updated_at).toLocaleString() : '未取得'}
            </span>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? [0, 1, 2, 3, 4].map((item) => <LoadingCard key={item} />)
            : components.map(([name, component]) => (
                <article key={name} className={`rounded-2xl border p-5 shadow-sm ${statusTone[component.status] ?? statusTone.warning}`}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold capitalize">{name}</h3>
                    <span className="text-xs">{statusLabel[component.status] ?? component.status}</span>
                  </div>
                  <p className="mt-3 text-sm opacity-90">{component.message ?? '詳細情報はありません。'}</p>
                </article>
              ))}
        </section>

        {!loading && components.length === 0 && !error && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">サービス状態データがありません。</p>
        )}

        <section className={`rounded-2xl border p-5 shadow-sm ${statusTone[status?.maintenance?.status] ?? statusTone.normal}`}>
          <h2 className="font-semibold">メンテナンス告知</h2>
          <p className="mt-2 text-sm">{status?.maintenance?.title ?? '未設定'}</p>
          <p className="mt-1 text-sm opacity-90">{status?.maintenance?.message ?? '告知はありません。'}</p>
          {status?.maintenance?.scheduled_until && <p className="mt-2 text-xs opacity-80">終了予定: {status.maintenance.scheduled_until}</p>}
        </section>
      </div>
    </main>
  )
}
