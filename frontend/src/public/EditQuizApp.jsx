import { useEffect, useMemo, useState } from 'react'

import { buildAuthPath, rememberAuthReturnPath } from './authNavigation.js'
import { ApiError, getStoredSession, publicApi } from './api.js'
import {
  QUIZ_LIMITS,
  buildCreateQuizPayload,
  buildQuizDraftFromEditableQuiz,
  createChoice,
  createInitialQuizDraft,
  createQuestion,
  validateQuizDraft,
} from './createQuizModel.js'

function Icon({ name, className = 'h-5 w-5' }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'aria-hidden': true }
  if (name === 'arrow-left') return <svg {...common}><path d="M19 12H5m6-6-6 6 6 6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" strokeWidth="1.8" strokeLinecap="round" /></svg>
  if (name === 'trash') return <svg {...common}><path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m-8 0 1 13h8l1-13" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'save') return <svg {...common}><path d="M5 4h11l3 3v13H5V4Zm3 0v6h8V4M8 16h8" strokeWidth="1.7" strokeLinejoin="round" /></svg>
  if (name === 'spark') return <svg {...common}><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2L12 3Z" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  return null
}

function FieldError({ children }) {
  return children ? <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{children}</p> : null
}

function friendlyError(error) {
  if (!(error instanceof ApiError)) return '予期しないエラーが発生しました。'
  const messages = {
    'quiz/not_found': '編集対象のクイズが見つかりません。',
    'quiz/not_editable': 'このクイズは下書きではないため編集できません。公開中の場合は公開を終了し、下書きへ戻してください。',
    'quiz/edit_conflict': 'プレイ履歴が存在するため、このクイズは編集できません。',
    'quiz/validation_error': '入力内容を確認してください。',
    'quiz/update_failed': '更新を保存できませんでした。時間をおいて再度お試しください。',
  }
  return messages[error.code] ?? error.message
}

function LoginRequired({ returnTo }) {
  const login = () => rememberAuthReturnPath(returnTo)
  return (
    <main className="mx-auto grid min-h-screen max-w-4xl place-items-center px-4 py-12">
      <section className="w-full rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900 md:p-12">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-white"><Icon name="spark" className="h-8 w-8" /></span>
        <h1 className="mt-6 text-3xl font-semibold">下書きを編集するにはログインが必要です</h1>
        <p className="mt-4 text-slate-600 dark:text-slate-300">認証後、この編集画面へ戻ります。</p>
        <a href={buildAuthPath('login', returnTo)} onClick={login} className="mt-8 inline-flex rounded-2xl bg-slate-950 px-6 py-3 font-medium text-white dark:bg-white dark:text-slate-950">ログインする</a>
      </section>
    </main>
  )
}

function LoadingState() {
  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-12"><div className="h-56 animate-pulse rounded-[2rem] bg-slate-100 dark:bg-slate-900" />{[...Array(3)].map((_, index) => <div key={index} className="h-72 animate-pulse rounded-[2rem] bg-slate-100 dark:bg-slate-900" />)}</main>
}

function LoadErrorState({ message, onRetry }) {
  return (
    <main className="mx-auto grid min-h-screen max-w-4xl place-items-center px-4 py-12">
      <section className="w-full rounded-[2rem] border border-rose-200 bg-white p-8 text-center shadow-xl dark:border-rose-500/30 dark:bg-slate-900 md:p-12">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"><Icon name="spark" className="h-8 w-8" /></span>
        <h1 className="mt-6 text-3xl font-semibold">編集データを読み込めません</h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-slate-600 dark:text-slate-300">{message || '通信環境を確認して再試行してください。'}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={onRetry} className="rounded-2xl bg-slate-950 px-6 py-3 font-medium text-white dark:bg-white dark:text-slate-950">もう一度読み込む</button>
          <a href="/my/quizzes" className="rounded-2xl border border-slate-300 px-6 py-3 font-medium dark:border-slate-700">マイクイズへ戻る</a>
        </div>
      </section>
    </main>
  )
}

export function EditQuizApp() {
  const quizId = useMemo(() => window.location.pathname.match(/^\/my\/quizzes\/(\d+)\/edit$/)?.[1] ?? '', [])
  const returnTo = `/my/quizzes/${quizId}/edit`
  const [session] = useState(() => getStoredSession())
  const [draft, setDraft] = useState(() => createInitialQuizDraft())
  const [loading, setLoading] = useState(Boolean(session?.accessToken))
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [loadVersion, setLoadVersion] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const validation = useMemo(() => validateQuizDraft(draft), [draft])

  useEffect(() => {
    if (!session?.accessToken || !quizId) return undefined
    let active = true
    setLoading(true)
    setLoaded(false)
    setLoadError('')

    Promise.all([
      publicApi.me(session.accessToken),
      publicApi.editableQuiz(quizId, session.accessToken),
    ])
      .then(([, payload]) => {
        if (!active) return
        setDraft(buildQuizDraftFromEditableQuiz(payload.quiz))
        setLoaded(true)
      })
      .catch((requestError) => {
        if (!active) return
        setLoadError(friendlyError(requestError))
        setLoaded(false)
      })
      .finally(() => active && setLoading(false))

    return () => { active = false }
  }, [quizId, session?.accessToken, loadVersion])

  const updateQuestion = (questionIndex, patch) => {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, index) => index === questionIndex ? { ...question, ...patch } : question),
    }))
  }

  const updateChoice = (questionIndex, choiceIndex, patch, setCorrectOnly = false) => {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, index) => {
        if (index !== questionIndex) return question
        return {
          ...question,
          choices: question.choices.map((choice, choicePosition) => {
            if (setCorrectOnly) return { ...choice, isCorrect: choicePosition === choiceIndex }
            return choicePosition === choiceIndex ? { ...choice, ...patch } : choice
          }),
        }
      }),
    }))
  }

  const addQuestion = () => setDraft((current) => current.questions.length >= QUIZ_LIMITS.questions
    ? current
    : { ...current, questions: [...current.questions, createQuestion()] })

  const removeQuestion = (questionIndex) => setDraft((current) => current.questions.length <= 1
    ? current
    : { ...current, questions: current.questions.filter((_, index) => index !== questionIndex) })

  const addChoice = (questionIndex) => setDraft((current) => ({
    ...current,
    questions: current.questions.map((question, index) => index === questionIndex && question.choices.length < QUIZ_LIMITS.maxChoices
      ? { ...question, choices: [...question.choices, createChoice()] }
      : question),
  }))

  const removeChoice = (questionIndex, choiceIndex) => setDraft((current) => ({
    ...current,
    questions: current.questions.map((question, index) => {
      if (index !== questionIndex || question.choices.length <= QUIZ_LIMITS.minChoices) return question
      const removedCorrect = question.choices[choiceIndex]?.isCorrect
      const choices = question.choices.filter((_, position) => position !== choiceIndex)
      if (removedCorrect && choices.length) choices[0] = { ...choices[0], isCorrect: true }
      return { ...question, choices }
    }),
  }))

  const submit = async (event) => {
    event.preventDefault()
    setAttempted(true)
    setSubmitError('')
    if (!validation.valid) {
      setSubmitError('未入力または修正が必要な項目があります。')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    setSubmitting(true)
    try {
      await publicApi.updateQuiz(quizId, buildCreateQuizPayload(draft), session.accessToken)
      window.location.assign(`/quizzes/${quizId}`)
    } catch (requestError) {
      setSubmitError(friendlyError(requestError))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  if (!session?.accessToken) return <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"><LoginRequired returnTo={returnTo} /></div>
  if (loading) return <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"><LoadingState /></div>
  if (!loaded) return <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"><LoadErrorState message={loadError} onRetry={() => setLoadVersion((current) => current + 1)} /></div>

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <a href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-white"><Icon name="spark" /></span><span><span className="block font-semibold">QuizVerse</span><span className="block text-xs text-slate-500">Draft Editor</span></span></a>
          <a href="/my/quizzes" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"><Icon name="arrow-left" className="h-4 w-4" />マイクイズへ</a>
        </div>
      </header>

      <form onSubmit={submit} className="mx-auto max-w-6xl space-y-7 px-4 py-8 md:px-6 md:py-12">
        <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-950 p-6 text-white md:p-9">
          <p className="text-sm font-semibold tracking-[0.18em] text-cyan-300">EDIT DRAFT</p>
          <h1 className="mt-3 text-3xl font-semibold md:text-5xl">下書きを整えて、公開へ。</h1>
          <p className="mt-4 max-w-3xl leading-7 text-slate-300">タイトル、問題、選択肢、正答を更新できます。保存後は作成者プレビューへ移動します。</p>
        </section>

        {submitError ? <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200" role="alert">{submitError}</div> : null}

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-7">
          <h2 className="text-2xl font-semibold">基本情報</h2>
          <div className="mt-6 space-y-5">
            <label className="block"><span className="text-sm font-medium">タイトル *</span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950" /><FieldError>{attempted && validation.fields.title}</FieldError></label>
            <div className="grid gap-5 md:grid-cols-2"><label className="block"><span className="text-sm font-medium">カテゴリ</span><input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950" /><FieldError>{attempted && validation.fields.category}</FieldError></label><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">編集できるのは下書きだけです。公開済みクイズはマイクイズで公開終了後、下書きへ戻してください。</div></div>
            <label className="block"><span className="text-sm font-medium">説明</span><textarea rows={4} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950" /><FieldError>{attempted && validation.fields.description}</FieldError></label>
          </div>
        </section>

        <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.18em] text-indigo-700 dark:text-indigo-300">QUESTIONS</p><h2 className="mt-2 text-2xl font-semibold">問題と選択肢</h2></div><span className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white dark:bg-white dark:text-slate-950">{draft.questions.length}問</span></div>

        {draft.questions.map((question, questionIndex) => {
          const questionError = attempted ? validation.questions[questionIndex] : null
          return (
            <section key={question.clientId} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-7">
              <div className="flex items-center justify-between gap-4"><h3 className="text-xl font-semibold">問題 {questionIndex + 1}</h3><button type="button" disabled={draft.questions.length <= 1} onClick={() => removeQuestion(questionIndex)} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-700 disabled:opacity-30 dark:text-rose-300"><Icon name="trash" className="h-4 w-4" />削除</button></div>
              <label className="mt-5 block"><span className="text-sm font-medium">問題文 *</span><textarea rows={3} value={question.body} onChange={(event) => updateQuestion(questionIndex, { body: event.target.value })} className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950" /><FieldError>{questionError?.body}</FieldError></label>
              <label className="mt-5 block"><span className="text-sm font-medium">解説</span><textarea rows={2} value={question.explanation} onChange={(event) => updateQuestion(questionIndex, { explanation: event.target.value })} className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950" /><FieldError>{questionError?.explanation}</FieldError></label>
              <div className="mt-6 flex items-center justify-between gap-4"><div><h4 className="font-medium">選択肢</h4><FieldError>{questionError?.choiceCount || questionError?.correctChoice}</FieldError></div><button type="button" disabled={question.choices.length >= QUIZ_LIMITS.maxChoices} onClick={() => addChoice(questionIndex)} className="inline-flex items-center gap-2 rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm text-cyan-800 disabled:opacity-40 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-200"><Icon name="plus" className="h-4 w-4" />追加</button></div>
              <div className="mt-4 space-y-3">{question.choices.map((choice, choiceIndex) => <div key={choice.clientId} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-700"><input type="radio" name={`correct-${question.clientId}`} checked={choice.isCorrect} onChange={() => updateChoice(questionIndex, choiceIndex, { isCorrect: true }, true)} className="h-5 w-5 accent-emerald-600" aria-label={`問題${questionIndex + 1}の選択肢${choiceIndex + 1}を正解にする`} /><div><input value={choice.body} onChange={(event) => updateChoice(questionIndex, choiceIndex, { body: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" /><FieldError>{questionError?.choices?.[choiceIndex]}</FieldError></div><button type="button" disabled={question.choices.length <= QUIZ_LIMITS.minChoices} onClick={() => removeChoice(questionIndex, choiceIndex)} className="grid h-10 w-10 place-items-center rounded-xl text-rose-700 disabled:opacity-25 dark:text-rose-300" aria-label={`選択肢${choiceIndex + 1}を削除`}><Icon name="trash" className="h-4 w-4" /></button></div>)}</div>
            </section>
          )
        })}

        <button type="button" disabled={draft.questions.length >= QUIZ_LIMITS.questions} onClick={addQuestion} className="flex w-full items-center justify-center gap-2 rounded-[2rem] border-2 border-dashed border-cyan-300 bg-cyan-50/50 px-6 py-5 font-medium text-cyan-800 disabled:opacity-40 dark:border-cyan-500/40 dark:bg-cyan-500/5 dark:text-cyan-200"><Icon name="plus" />問題を追加する</button>

        <section className="sticky bottom-4 z-30 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-slate-500">{validation.valid ? '保存できます。' : '未入力または修正が必要な項目があります。'}</p><div className="flex gap-3"><a href="/my/quizzes" className="rounded-2xl border border-slate-300 px-5 py-3 text-sm dark:border-slate-700">キャンセル</a><button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-6 py-3 font-semibold text-white disabled:opacity-50">{submitting ? '保存中...' : '変更を保存'}<Icon name="save" /></button></div></section>
      </form>
    </div>
  )
}
