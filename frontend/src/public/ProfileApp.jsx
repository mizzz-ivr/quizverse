import React, { useCallback, useEffect, useMemo, useState } from 'react'

import {
  ApiError,
  getStoredSession,
  publicApi,
  saveSession,
} from './api.js'
import {
  PROFILE_RESULT_FILTERS,
  canMoveHistoryPage,
  formatAccuracy,
  formatProfileDate,
  normalizeProfileStats,
  resultPresentation,
} from './profileModel.js'

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-3 font-black tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-500 text-lg text-white shadow-lg shadow-cyan-500/20">Q</span>
            <span className="text-xl">QuizVerse</span>
          </a>
          <nav className="flex items-center gap-2 text-sm font-semibold">
            <a href="/quizzes" className="rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white">クイズ</a>
            <a href="/my/quizzes" className="hidden rounded-xl px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 sm:inline-flex dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white">マイクイズ</a>
            <a href="/profile" aria-current="page" className="rounded-xl bg-slate-900 px-3 py-2 text-white dark:bg-white dark:text-slate-950">プロフィール</a>
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
          <p className="mt-4 font-semibold text-slate-600 dark:text-slate-300">プロフィールを読み込んでいます</p>
        </div>
      </main>
    </PageShell>
  )
}

function ErrorPage({ message, onRetry }) {
  return (
    <PageShell>
      <main className="mx-auto grid min-h-[70vh] max-w-3xl place-items-center px-4">
        <section className="w-full rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl dark:border-rose-500/30 dark:bg-slate-900">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-100 text-2xl dark:bg-rose-400/15">!</div>
          <h1 className="mt-5 text-2xl font-black">プロフィールを表示できませんでした</h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300">{message}</p>
          <button type="button" onClick={onRetry} className="mt-6 rounded-2xl bg-slate-900 px-5 py-3 font-bold text-white transition hover:-translate-y-0.5 dark:bg-white dark:text-slate-950">再読み込み</button>
        </section>
      </main>
    </PageShell>
  )
}

function StatCard({ label, value, note, symbol }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
          {note ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</p> : null}
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-50 text-xl text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300">{symbol}</span>
      </div>
    </article>
  )
}

function ProfileEditor({ user, busy, error, onCancel, onSave }) {
  const [displayName, setDisplayName] = useState(user.display_name ?? '')
  const trimmed = displayName.trim()
  const invalid = !trimmed || trimmed.length > 80

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!invalid && !busy) onSave(trimmed)
      }}
      className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 dark:border-cyan-400/20 dark:bg-cyan-400/5"
    >
      <label htmlFor="profile-display-name" className="text-sm font-bold">表示名</label>
      <input
        id="profile-display-name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        maxLength={81}
        autoFocus
        className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/15 dark:border-slate-700 dark:bg-slate-950"
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>1〜80文字で入力してください。</span>
        <span>{displayName.length}/80</span>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-100 px-3 py-2 text-sm font-semibold text-rose-800 dark:bg-rose-400/15 dark:text-rose-200">{error}</p> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold transition hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-900">キャンセル</button>
        <button type="submit" disabled={invalid || busy} className="rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50">{busy ? '保存中…' : '保存する'}</button>
      </div>
    </form>
  )
}

function HistoryItem({ item, onOpen }) {
  const presentation = resultPresentation(item.result)
  return (
    <article className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:hover:border-cyan-500/50">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black ${presentation.className}`}><span>{presentation.symbol}</span>{presentation.label}</span>
            {item.quiz.category ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{item.quiz.category}</span> : null}
            {!item.quiz.is_replayable ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">現在は非公開</span> : null}
          </div>
          <h3 className="mt-3 truncate text-lg font-black">{item.quiz.title}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{formatProfileDate(item.submitted_at)}</p>
        </div>
        <div className="flex items-center justify-between gap-5 sm:justify-end">
          <div className="text-right">
            <p className="text-3xl font-black text-cyan-700 dark:text-cyan-300">{formatAccuracy(item.accuracy_percentage)}</p>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{item.correct_answers}/{item.total_questions}問正解・{item.score}点</p>
          </div>
          <button type="button" onClick={() => onOpen(item.id)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black transition group-hover:border-cyan-300 group-hover:bg-cyan-50 dark:border-slate-700 dark:group-hover:border-cyan-500/50 dark:group-hover:bg-cyan-400/10">振り返る</button>
        </div>
      </div>
    </article>
  )
}

function HistoryDetail({ detail, loading, error, onClose, onRetry }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="プレイ結果の詳細">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default" />
      <aside className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto bg-slate-50 p-4 shadow-2xl dark:bg-slate-950 sm:p-6">
        <div className="relative">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-cyan-700 dark:text-cyan-300">回答結果</p>
              <h2 className="mt-1 text-2xl font-black">{detail?.play?.quiz?.title ?? '結果を読み込み中'}</h2>
            </div>
            <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-xl font-black transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800">×</button>
          </div>

          {loading ? (
            <div className="grid min-h-[55vh] place-items-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-100 border-t-cyan-500 dark:border-slate-800 dark:border-t-cyan-400" /></div>
          ) : error ? (
            <div className="mt-8 rounded-3xl border border-rose-200 bg-white p-6 text-center dark:border-rose-500/30 dark:bg-slate-900">
              <p className="font-semibold text-rose-700 dark:text-rose-200">{error}</p>
              <button type="button" onClick={onRetry} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 font-bold text-white dark:bg-white dark:text-slate-950">再試行</button>
            </div>
          ) : detail ? (
            <>
              <section className="mt-6 grid grid-cols-3 gap-3 rounded-3xl bg-gradient-to-br from-cyan-500 to-indigo-600 p-5 text-white shadow-xl shadow-cyan-500/20">
                <div><p className="text-xs font-semibold text-white/70">正答率</p><p className="mt-1 text-2xl font-black">{formatAccuracy(detail.play.accuracy_percentage)}</p></div>
                <div><p className="text-xs font-semibold text-white/70">正解</p><p className="mt-1 text-2xl font-black">{detail.play.correct_answers}/{detail.play.total_questions}</p></div>
                <div><p className="text-xs font-semibold text-white/70">得点</p><p className="mt-1 text-2xl font-black">{detail.play.score}</p></div>
              </section>

              <div className="mt-6 space-y-4">
                {detail.questions.map((question, index) => (
                  <article key={question.question_id} className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-start gap-3">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl font-black ${question.result === 'correct' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200' : question.result === 'skipped' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-200'}`}>{question.result === 'correct' ? '✓' : question.result === 'skipped' ? '—' : '×'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">問題 {index + 1}・{question.points_awarded}/{question.points}点</p>
                        <h3 className="mt-1 font-black leading-relaxed">{question.body}</h3>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {question.choices.map((choice) => (
                        <div key={choice.id} className={`rounded-2xl border px-4 py-3 text-sm ${choice.is_correct ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-400/10 dark:text-emerald-100' : choice.is_selected ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-400/10 dark:text-rose-100' : 'border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-300'}`}>
                          <span className="font-semibold">{choice.body}</span>
                          {choice.is_correct ? <span className="ml-2 text-xs font-black">正解</span> : null}
                          {choice.is_selected ? <span className="ml-2 text-xs font-black">あなたの回答</span> : null}
                        </div>
                      ))}
                    </div>
                    {question.explanation ? <div className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200"><p className="mb-1 text-xs font-black text-slate-500 dark:text-slate-400">解説</p>{question.explanation}</div> : null}
                  </article>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <a href={`/quizzes/${detail.play.quiz.id}`} className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-black transition hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900">クイズ詳細</a>
                {detail.play.quiz.is_replayable ? <a href={`/quizzes/${detail.play.quiz.id}`} className="rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5">もう一度挑戦</a> : null}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

export function ProfileApp() {
  const initialSession = getStoredSession()
  const [profile, setProfile] = useState(null)
  const [history, setHistory] = useState({ items: [], pagination: { page: 1, total_pages: 0, total: 0 } })
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [resultFilter, setResultFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [selectedPlayId, setSelectedPlayId] = useState(null)
  const [playDetail, setPlayDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  const loadProfile = useCallback(async () => {
    setPageLoading(true)
    setPageError('')
    try {
      const payload = await publicApi.meProfile(initialSession?.accessToken)
      setProfile(payload)
    } catch (error) {
      setPageError(error instanceof ApiError ? error.message : 'プロフィールを読み込めませんでした。')
    } finally {
      setPageLoading(false)
    }
  }, [initialSession?.accessToken])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const payload = await publicApi.playHistory({ result: resultFilter, page, perPage: 8 }, initialSession?.accessToken)
      setHistory(payload)
    } catch (error) {
      setHistoryError(error instanceof ApiError ? error.message : 'プレイ履歴を読み込めませんでした。')
    } finally {
      setHistoryLoading(false)
    }
  }, [initialSession?.accessToken, page, resultFilter])

  useEffect(() => { void loadProfile() }, [loadProfile])
  useEffect(() => { if (!pageLoading && !pageError) void loadHistory() }, [loadHistory, pageError, pageLoading])

  const stats = useMemo(() => normalizeProfileStats(profile?.stats), [profile?.stats])
  const user = profile?.user
  const initial = (user?.display_name || user?.email || 'Q').trim().charAt(0).toUpperCase()

  async function saveDisplayName(displayName) {
    setSaving(true)
    setSaveError('')
    setSaveMessage('')
    try {
      const payload = await publicApi.updateProfile({ display_name: displayName }, initialSession?.accessToken)
      setProfile((current) => ({ ...current, user: payload.user }))
      saveSession({ user: payload.user }, { redirect: false })
      setEditing(false)
      setSaveMessage(payload.meta?.changed ? '表示名を更新しました。' : '表示名に変更はありません。')
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : '表示名を更新できませんでした。')
    } finally {
      setSaving(false)
    }
  }

  const openDetail = useCallback(async (playId) => {
    setSelectedPlayId(playId)
    setPlayDetail(null)
    setDetailError('')
    setDetailLoading(true)
    try {
      setPlayDetail(await publicApi.playHistoryDetail(playId, initialSession?.accessToken))
    } catch (error) {
      setDetailError(error instanceof ApiError ? error.message : '回答結果を読み込めませんでした。')
    } finally {
      setDetailLoading(false)
    }
  }, [initialSession?.accessToken])

  if (pageLoading) return <LoadingPage />
  if (pageError || !profile) return <ErrorPage message={pageError || 'プロフィールが見つかりません。'} onRetry={loadProfile} />

  return (
    <PageShell>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="h-28 bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-600 sm:h-36" />
          <div className="px-5 pb-6 sm:px-8">
            <div className="-mt-12 flex flex-col gap-5 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 items-end gap-4">
                {user.avatar_url ? <img src={user.avatar_url} alt="" className="h-24 w-24 rounded-3xl border-4 border-white object-cover shadow-xl dark:border-slate-900 sm:h-28 sm:w-28" /> : <div className="grid h-24 w-24 shrink-0 place-items-center rounded-3xl border-4 border-white bg-slate-900 text-4xl font-black text-white shadow-xl dark:border-slate-900 dark:bg-white dark:text-slate-950 sm:h-28 sm:w-28">{initial}</div>}
                <div className="min-w-0 pb-1">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">My Profile</p>
                  <h1 className="mt-1 truncate text-3xl font-black tracking-tight sm:text-4xl">{user.display_name}</h1>
                  <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                </div>
              </div>
              <button type="button" onClick={() => { setEditing((value) => !value); setSaveError(''); setSaveMessage('') }} className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-black transition hover:-translate-y-0.5 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">{editing ? '編集を閉じる' : 'プロフィールを編集'}</button>
            </div>
            {editing ? <ProfileEditor user={user} busy={saving} error={saveError} onCancel={() => setEditing(false)} onSave={saveDisplayName} /> : null}
            {saveMessage ? <p role="status" className="mt-4 rounded-2xl bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200">{saveMessage}</p> : null}
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>登録日: {formatProfileDate(user.created_at)}</span>
              <span>最終ログイン: {formatProfileDate(user.last_login_at)}</span>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div><p className="text-sm font-black text-cyan-700 dark:text-cyan-300">ACHIEVEMENTS</p><h2 className="mt-1 text-2xl font-black">学習実績</h2></div>
            <a href="/rankings" className="text-sm font-bold text-cyan-700 hover:underline dark:text-cyan-300">ランキングを見る →</a>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="平均正答率" value={formatAccuracy(stats.averageAccuracyPercentage)} note={`${stats.correctAnswers}/${stats.totalQuestions}問正解`} symbol="◎" />
            <StatCard label="プレイ回数" value={`${stats.playCount}回`} note={`${stats.attemptedQuizCount}種類に挑戦`} symbol="▶" />
            <StatCard label="全問正解" value={`${stats.perfectPlayCount}回`} note="パーフェクト達成" symbol="★" />
            <StatCard label="挑戦クイズ" value={`${stats.attemptedQuizCount}件`} note="異なるクイズ数" symbol="◇" />
            <StatCard label="累計正解" value={`${stats.correctAnswers}問`} note={`全${stats.totalQuestions}問`} symbol="✓" />
            <StatCard label="作成クイズ" value={`${stats.createdQuizCount}件`} note="あなたが作ったクイズ" symbol="＋" />
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-sm font-black text-indigo-700 dark:text-indigo-300">PLAY HISTORY</p><h2 className="mt-1 text-2xl font-black">プレイ履歴</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">過去の回答を開いて、間違えた問題を振り返れます。</p></div>
            <label className="text-sm font-bold">結果で絞り込み<select value={resultFilter} onChange={(event) => { setResultFilter(event.target.value); setPage(1) }} className="ml-3 rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/15 dark:border-slate-700 dark:bg-slate-900">{PROFILE_RESULT_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
          </div>

          {historyError ? <div className="mt-5 rounded-3xl border border-rose-200 bg-white p-6 text-center dark:border-rose-500/30 dark:bg-slate-900"><p className="font-semibold text-rose-700 dark:text-rose-200">{historyError}</p><button type="button" onClick={loadHistory} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 font-bold text-white dark:bg-white dark:text-slate-950">再読み込み</button></div> : null}
          {historyLoading ? <div className="mt-5 grid min-h-52 place-items-center rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="h-9 w-9 animate-spin rounded-full border-4 border-cyan-100 border-t-cyan-500 dark:border-slate-800 dark:border-t-cyan-400" /></div> : null}
          {!historyLoading && !historyError && history.items.length === 0 ? <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">○</div><h3 className="mt-4 text-xl font-black">該当するプレイ履歴がありません</h3><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">クイズへ挑戦すると、ここから結果を振り返れます。</p><a href="/quizzes" className="mt-5 inline-flex rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 py-3 font-black text-white">クイズを探す</a></div> : null}
          {!historyLoading && !historyError && history.items.length > 0 ? <div className="mt-5 space-y-3">{history.items.map((item) => <HistoryItem key={item.id} item={item} onOpen={openDetail} />)}</div> : null}

          {!historyLoading && !historyError && history.pagination.total_pages > 1 ? <div className="mt-6 flex items-center justify-between gap-4"><button type="button" disabled={!canMoveHistoryPage(history.pagination, 'previous')} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700">← 前へ</button><p className="text-sm font-bold text-slate-500 dark:text-slate-400">{history.pagination.page} / {history.pagination.total_pages}ページ・全{history.pagination.total}件</p><button type="button" disabled={!canMoveHistoryPage(history.pagination, 'next')} onClick={() => setPage((value) => value + 1)} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700">次へ →</button></div> : null}
        </section>
      </main>

      {selectedPlayId ? <HistoryDetail detail={playDetail} loading={detailLoading} error={detailError} onClose={() => { setSelectedPlayId(null); setPlayDetail(null); setDetailError('') }} onRetry={() => openDetail(selectedPlayId)} /> : null}
    </PageShell>
  )
}
