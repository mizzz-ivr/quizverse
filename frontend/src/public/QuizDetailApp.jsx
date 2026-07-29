import { useEffect, useMemo, useState } from 'react'

import { buildAuthPath, rememberAuthReturnPath } from './authNavigation.js'
import { ApiError, getStoredSession, publicApi } from './api.js'

function Icon({ name, className = 'h-5 w-5' }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'aria-hidden': true }
  if (name === 'spark') return <svg {...common}><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2L12 3Z" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  if (name === 'arrow-left') return <svg {...common}><path d="M19 12H5m6-6-6 6 6 6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'trophy') return <svg {...common}><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" strokeWidth="1.7" /><path d="M8 6H5v1a4 4 0 0 0 4 4M16 6h3v1a4 4 0 0 1-4 4M12 12v4m-3 4h6m-5-4h4" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'check') return <svg {...common}><path d="m5 12 4 4L19 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'lock') return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" strokeWidth="1.7" /><path d="M8 10V7a4 4 0 0 1 8 0v3" strokeWidth="1.7" strokeLinecap="round" /></svg>
  return null
}

function friendlyError(error) {
  if (!(error instanceof ApiError)) return '予期しないエラーが発生しました。'
  const messages = {
    'quiz/not_found': '指定されたクイズが見つかりません。公開が終了した可能性があります。',
    'quiz/invalid_answer': '回答内容を確認してください。',
    'auth/missing_token': '回答を送信するにはログインが必要です。',
    'auth/invalid_token': 'ログインの有効期限が切れました。もう一度ログインしてください。',
  }
  return messages[error.code] ?? error.message
}

function LoadingState() {
  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-10 md:px-6"><div className="h-72 animate-pulse rounded-[2rem] bg-slate-100 dark:bg-slate-900" />{[...Array(3)].map((_, index) => <div key={index} className="h-64 animate-pulse rounded-3xl bg-slate-100 dark:bg-slate-900" />)}</main>
}

function ErrorState({ message }) {
  return (
    <main className="mx-auto grid min-h-[75vh] max-w-4xl place-items-center px-4 py-12">
      <section className="w-full rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:shadow-slate-950/50 md:p-12">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800"><Icon name="lock" className="h-8 w-8" /></span>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">クイズを表示できません</h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-slate-600 dark:text-slate-300">{message}</p>
        <a href="/quizzes" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white dark:bg-white dark:text-slate-950"><Icon name="arrow-left" className="h-4 w-4" />クイズ一覧へ戻る</a>
      </section>
    </main>
  )
}

function ResultPanel({ result }) {
  if (!result) return null
  return (
    <section className="rounded-[2rem] border border-cyan-300 bg-gradient-to-br from-cyan-50 to-indigo-50 p-6 shadow-sm dark:border-cyan-500/40 dark:from-cyan-500/10 dark:to-indigo-500/10 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold tracking-[0.18em] text-cyan-700 dark:text-cyan-300">RESULT</p><h2 className="mt-2 text-3xl font-semibold">{result.correct_count} / {result.total_questions}問 正解</h2><p className="mt-2 text-slate-600 dark:text-slate-300">スコア {result.score}点・正答率 {result.score_percentage}%</p></div><span className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-2xl font-semibold shadow-sm dark:bg-slate-900">{Math.round(result.score_percentage)}%</span></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/70"><p className="text-xs text-slate-500">正解</p><p className="mt-1 text-xl font-semibold text-emerald-600">{result.correct_count}</p></div><div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/70"><p className="text-xs text-slate-500">不正解</p><p className="mt-1 text-xl font-semibold text-rose-600">{result.incorrect_count}</p></div><div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/70"><p className="text-xs text-slate-500">未回答</p><p className="mt-1 text-xl font-semibold text-slate-600 dark:text-slate-300">{result.skipped_count}</p></div></div>
    </section>
  )
}

export function QuizDetailApp() {
  const quizId = useMemo(() => window.location.pathname.match(/^\/quizzes\/(\d+)$/)?.[1] ?? '', [])
  const [session] = useState(() => getStoredSession())
  const [quiz, setQuiz] = useState(null)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    const loadQuiz = async () => {
      try {
        return await publicApi.quiz(quizId)
      } catch (requestError) {
        if (!(requestError instanceof ApiError) || requestError.status !== 404 || !session?.accessToken) {
          throw requestError
        }
        return publicApi.quiz(quizId, session.accessToken)
      }
    }

    loadQuiz()
      .then((payload) => {
        if (!active) return
        setQuiz(payload.quiz ?? null)
      })
      .catch((requestError) => active && setError(friendlyError(requestError)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [quizId, session?.accessToken])

  const playEnabled = quiz?.play_enabled !== false && quiz?.status === 'published'
  const answeredCount = Object.keys(answers).length

  const submit = async () => {
    if (!session?.accessToken) {
      const returnTo = rememberAuthReturnPath(`/quizzes/${quizId}`)
      window.location.assign(buildAuthPath('login', returnTo))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const answerList = Object.entries(answers).map(([questionId, choiceId]) => ({
        question_id: Number(questionId),
        selected_choice_id: Number(choiceId),
      }))
      const payload = await publicApi.playQuiz(quizId, answerList, session.accessToken)
      setResult(payload.play ?? null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (requestError) {
      setError(friendlyError(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"><LoadingState /></div>
  if (!quiz) return <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"><ErrorState message={error || '指定されたクイズが見つかりません。'} /></div>

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(99,102,241,0.13),_transparent_38%)]" />
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-6"><a href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-white"><Icon name="spark" /></span><span><span className="block font-semibold">QuizVerse</span><span className="block text-xs text-slate-500">Quiz Challenge</span></span></a><div className="flex items-center gap-2"><a href="/quizzes" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900"><Icon name="arrow-left" className="h-4 w-4" />一覧へ</a>{quiz.viewer_is_author ? <a href="/my/quizzes" className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-950">管理する</a> : null}</div></div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-6 md:py-12">
        {error ? <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200" role="alert">{error}</div> : null}
        {quiz.viewer_is_author && !playEnabled ? <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"><p className="font-semibold">作成者向けプレビュー</p><p className="mt-1 leading-6">このクイズは「{quiz.status === 'archived' ? 'アーカイブ' : '下書き'}」です。第三者には表示されず、回答送信もできません。マイクイズ画面から公開してください。</p></div> : null}

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="bg-gradient-to-r from-slate-950 via-indigo-950 to-cyan-950 p-6 text-white md:p-9"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-xs">{quiz.category || 'カテゴリなし'}</span><span className="rounded-full bg-white/10 px-3 py-1 text-xs">{quiz.question_count ?? quiz.questions?.length ?? 0}問</span><span className="rounded-full bg-white/10 px-3 py-1 text-xs">{quiz.status === 'published' ? '公開中' : quiz.status === 'archived' ? 'アーカイブ' : '下書き'}</span></div><h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">{quiz.title}</h1><p className="mt-4 max-w-3xl leading-7 text-slate-300">{quiz.description || '説明は登録されていません。'}</p><div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300"><span>作成者: {quiz.author?.display_name || '匿名ユーザー'}</span>{quiz.status === 'published' ? <a href={`/quizzes/${quizId}/rankings`} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white hover:bg-white/20"><Icon name="trophy" className="h-4 w-4" />ランキング</a> : null}</div></div></section>

        <ResultPanel result={result} />

        <div className="space-y-5">{(quiz.questions ?? []).map((question, questionIndex) => <section key={question.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-7"><div className="flex items-start gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-950 font-semibold text-white dark:bg-white dark:text-slate-950">{questionIndex + 1}</span><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold leading-7">{question.body}</h2>{question.explanation ? <p className="mt-2 text-sm leading-6 text-slate-500">{question.explanation}</p> : null}</div></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{question.choices.map((choice, choiceIndex) => { const selected = answers[question.id] === choice.id; return <button key={choice.id} type="button" disabled={!playEnabled || Boolean(result)} onClick={() => setAnswers((current) => ({ ...current, [question.id]: choice.id }))} className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed ${selected ? 'border-cyan-400 bg-cyan-50 ring-4 ring-cyan-500/10 dark:border-cyan-500 dark:bg-cyan-500/10' : 'border-slate-200 bg-slate-50 hover:border-cyan-300 hover:bg-cyan-50/50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-cyan-500/50'} ${!playEnabled ? 'opacity-70' : ''}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm font-semibold ${selected ? 'bg-cyan-600 text-white' : 'bg-white text-slate-500 shadow-sm dark:bg-slate-900'}`}>{selected ? <Icon name="check" className="h-4 w-4" /> : String.fromCharCode(65 + choiceIndex)}</span><span>{choice.body}</span></button> })}</div></section>)}</div>

        {playEnabled ? <section className="sticky bottom-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="font-medium">{answeredCount} / {quiz.questions?.length ?? 0}問 回答済み</p><p className="mt-1 text-xs text-slate-500">未回答の問題はスキップとして採点されます。</p></div><button type="button" disabled={submitting || Boolean(result)} onClick={submit} className="rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-6 py-3 font-semibold text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? '採点中...' : result ? '回答済み' : session?.accessToken ? '回答を送信' : 'ログインして回答'}</button></div></section> : null}
      </main>
    </div>
  )
}
