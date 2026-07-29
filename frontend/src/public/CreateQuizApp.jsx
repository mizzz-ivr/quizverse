import { useEffect, useMemo, useState } from 'react'

import { buildAuthPath, rememberAuthReturnPath } from './authNavigation'
import { ApiError, getStoredSession, publicApi } from './api'
import {
  QUIZ_LIMITS,
  buildCreateQuizPayload,
  clearQuizDraft,
  createChoice,
  createQuestion,
  loadQuizDraft,
  saveQuizDraft,
  validateQuizDraft,
} from './createQuizModel'

function Icon({ name, className = 'h-5 w-5' }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'aria-hidden': true,
  }
  if (name === 'arrow-left') return <svg {...common}><path d="M19 12H5m6-6-6 6 6 6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" strokeWidth="1.8" strokeLinecap="round" /></svg>
  if (name === 'trash') return <svg {...common}><path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m-8 0 1 13h8l1-13" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (name === 'spark') return <svg {...common}><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2L12 3Z" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  if (name === 'check') return <svg {...common}><path d="m5 12 4 4L19 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  return null
}

function FieldError({ children }) {
  if (!children) return null
  return <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{children}</p>
}

function CharacterCount({ value, max }) {
  const count = value.length
  return <span className={count > max ? 'text-rose-600 dark:text-rose-300' : 'text-slate-400'}>{count} / {max}</span>
}

function LoginRequired() {
  const returnTo = '/quizzes/new'
  const rememberReturn = () => rememberAuthReturnPath(returnTo)

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl place-items-center px-4 py-12">
      <section className="w-full max-w-2xl rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900 dark:shadow-slate-950/50 md:p-12">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-white shadow-lg shadow-cyan-500/20"><Icon name="spark" className="h-8 w-8" /></span>
        <p className="mt-6 text-sm font-semibold tracking-[0.18em] text-cyan-700 dark:text-cyan-300">QUIZ CREATOR</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">クイズを作るにはログインが必要です</h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-slate-600 dark:text-slate-300">認証後はこの作成画面へ戻ります。入力途中の内容がある場合も、このタブに一時保存されます。</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a href={buildAuthPath('login', returnTo)} onClick={rememberReturn} className="rounded-2xl bg-slate-950 px-6 py-3 font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">ログインする</a>
          <a href={buildAuthPath('signup', returnTo)} onClick={rememberReturn} className="rounded-2xl border border-slate-300 bg-white px-6 py-3 font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">アカウントを作る</a>
        </div>
        <a href="/" className="mt-7 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-950 dark:hover:text-white"><Icon name="arrow-left" className="h-4 w-4" />ホームへ戻る</a>
      </section>
    </main>
  )
}

function SessionCheckPanel({ error, onRetry }) {
  return (
    <main className="mx-auto grid min-h-screen max-w-5xl place-items-center px-4 py-12">
      <section className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900 dark:shadow-slate-950/50">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-200"><Icon name="spark" className="h-7 w-7" /></span>
        <h1 className="mt-5 text-2xl font-semibold">ログイン状態を確認しています</h1>
        {error ? (
          <>
            <p className="mt-3 leading-7 text-rose-700 dark:text-rose-300">{error}</p>
            <button type="button" onClick={onRetry} className="mt-6 rounded-2xl bg-slate-950 px-6 py-3 font-medium text-white dark:bg-white dark:text-slate-950">もう一度確認する</button>
          </>
        ) : (
          <div className="mx-auto mt-6 h-2 w-40 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500" /></div>
        )}
      </section>
    </main>
  )
}

function QuestionCard({ question, questionIndex, error, canRemove, onQuestionChange, onChoiceChange, onAddChoice, onRemoveChoice, onRemoveQuestion }) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900 dark:shadow-slate-950/40">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/80 md:px-7">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 font-semibold text-white dark:bg-white dark:text-slate-950">{questionIndex + 1}</span>
          <div><h2 className="font-semibold">問題 {questionIndex + 1}</h2><p className="text-xs text-slate-500">選択式・正解は1つ</p></div>
        </div>
        <button type="button" disabled={!canRemove} onClick={onRemoveQuestion} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"><Icon name="trash" className="h-4 w-4" />問題を削除</button>
      </div>

      <div className="space-y-7 p-5 md:p-7">
        <label className="block">
          <span className="flex items-center justify-between gap-3 text-sm font-medium"><span>問題文 <span className="text-rose-500">*</span></span><CharacterCount value={question.body} max={QUIZ_LIMITS.questionBody} /></span>
          <textarea value={question.body} onChange={(event) => onQuestionChange({ body: event.target.value })} rows={3} placeholder="例：日本で一番高い山は？" className="mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" />
          <FieldError>{error?.body}</FieldError>
        </label>

        <label className="block">
          <span className="flex items-center justify-between gap-3 text-sm font-medium"><span>解説 <span className="font-normal text-slate-400">（任意）</span></span><CharacterCount value={question.explanation} max={QUIZ_LIMITS.explanation} /></span>
          <textarea value={question.explanation} onChange={(event) => onQuestionChange({ explanation: event.target.value })} rows={2} placeholder="回答後に伝えたい補足や豆知識" className="mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" />
          <FieldError>{error?.explanation}</FieldError>
        </label>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-medium">選択肢 <span className="text-rose-500">*</span></h3><p className="mt-1 text-xs text-slate-500">左のラジオボタンで正解を1つ選んでください。</p></div>
            <button type="button" disabled={question.choices.length >= QUIZ_LIMITS.maxChoices} onClick={onAddChoice} className="inline-flex items-center gap-2 rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-200"><Icon name="plus" className="h-4 w-4" />選択肢を追加</button>
          </div>
          <FieldError>{error?.choiceCount || error?.correctChoice}</FieldError>

          <div className="mt-4 space-y-3">
            {question.choices.map((choice, choiceIndex) => (
              <div key={choice.clientId} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border p-3 transition ${choice.isCorrect ? 'border-emerald-400 bg-emerald-50/70 ring-4 ring-emerald-500/10 dark:border-emerald-500/50 dark:bg-emerald-500/10' : 'border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-950/60'}`}>
                <label className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl bg-white shadow-sm dark:bg-slate-900" title="正解に設定">
                  <input type="radio" name={`correct-${question.clientId}`} checked={choice.isCorrect} onChange={() => onChoiceChange(choiceIndex, { isCorrect: true }, true)} className="h-5 w-5 accent-emerald-600" aria-label={`問題${questionIndex + 1}の選択肢${choiceIndex + 1}を正解にする`} />
                </label>
                <div>
                  <input value={choice.body} onChange={(event) => onChoiceChange(choiceIndex, { body: event.target.value })} placeholder={`選択肢 ${choiceIndex + 1}`} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-900" />
                  <FieldError>{error?.choices?.[choiceIndex]}</FieldError>
                </div>
                <button type="button" disabled={question.choices.length <= QUIZ_LIMITS.minChoices} onClick={() => onRemoveChoice(choiceIndex)} className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-25 dark:hover:bg-rose-500/10 dark:hover:text-rose-300" aria-label={`選択肢${choiceIndex + 1}を削除`}><Icon name="trash" className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function friendlyCreateError(error) {
  if (!(error instanceof ApiError)) return '予期しないエラーが発生しました。時間をおいて再度お試しください。'
  if (error.code === 'quiz/validation_error') return '入力内容をサーバーで確認できませんでした。各項目を見直してください。'
  if (error.code === 'quiz/create_failed') return 'クイズを保存できませんでした。時間をおいて再度お試しください。'
  return error.message
}

export function CreateQuizApp() {
  const [session] = useState(() => getStoredSession())
  const [draft, setDraft] = useState(() => loadQuizDraft())
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [sessionStatus, setSessionStatus] = useState(session?.accessToken ? 'checking' : 'missing')
  const [sessionError, setSessionError] = useState('')
  const [sessionCheckVersion, setSessionCheckVersion] = useState(0)
  const validation = useMemo(() => validateQuizDraft(draft), [draft])

  useEffect(() => {
    saveQuizDraft(draft)
  }, [draft])

  useEffect(() => {
    if (!session?.accessToken) return undefined

    let active = true
    setSessionStatus('checking')
    setSessionError('')
    publicApi.me(session.accessToken)
      .then(() => {
        if (active) setSessionStatus('ready')
      })
      .catch((error) => {
        if (!active || (error instanceof ApiError && error.status === 401)) return
        setSessionStatus('error')
        setSessionError('ログイン状態を確認できませんでした。通信環境を確認して再試行してください。')
      })

    return () => { active = false }
  }, [session?.accessToken, sessionCheckVersion])

  if (!session?.accessToken) return <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"><LoginRequired /></div>
  if (sessionStatus !== 'ready') return <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100"><SessionCheckPanel error={sessionStatus === 'error' ? sessionError : ''} onRetry={() => setSessionCheckVersion((current) => current + 1)} /></div>

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
          choices: question.choices.map((choice, indexOfChoice) => {
            if (setCorrectOnly) return { ...choice, isCorrect: indexOfChoice === choiceIndex }
            return indexOfChoice === choiceIndex ? { ...choice, ...patch } : choice
          }),
        }
      }),
    }))
  }

  const addChoice = (questionIndex) => {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, index) => index === questionIndex && question.choices.length < QUIZ_LIMITS.maxChoices
        ? { ...question, choices: [...question.choices, createChoice()] }
        : question),
    }))
  }

  const removeChoice = (questionIndex, choiceIndex) => {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, index) => {
        if (index !== questionIndex || question.choices.length <= QUIZ_LIMITS.minChoices) return question
        const removedWasCorrect = question.choices[choiceIndex]?.isCorrect
        const choices = question.choices.filter((_, indexOfChoice) => indexOfChoice !== choiceIndex)
        if (removedWasCorrect && choices.length > 0) {
          choices.forEach((choice, indexOfChoice) => {
            choices[indexOfChoice] = { ...choice, isCorrect: indexOfChoice === 0 }
          })
        }
        return { ...question, choices }
      }),
    }))
  }

  const addQuestion = () => {
    setDraft((current) => current.questions.length >= QUIZ_LIMITS.questions
      ? current
      : { ...current, questions: [...current.questions, createQuestion()] })
  }

  const removeQuestion = (questionIndex) => {
    setDraft((current) => current.questions.length <= 1
      ? current
      : { ...current, questions: current.questions.filter((_, index) => index !== questionIndex) })
  }

  const submit = async (event) => {
    event.preventDefault()
    setAttempted(true)
    setSubmitError('')
    if (!validation.valid) {
      setSubmitError('未入力または修正が必要な項目があります。')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    saveQuizDraft(draft)
    setSubmitting(true)
    try {
      const payload = await publicApi.createQuiz(buildCreateQuizPayload(draft), session.accessToken)
      const quizId = payload?.quiz?.id
      if (!quizId) throw new Error('Created quiz id is missing')
      clearQuizDraft()
      window.location.assign(`/quizzes/${quizId}`)
    } catch (error) {
      setSubmitError(friendlyCreateError(error))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  const cancelCreation = (event) => {
    event.preventDefault()
    clearQuizDraft()
    window.location.assign('/quizzes')
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.15),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(99,102,241,0.14),_transparent_38%)]" />
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <a href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-white shadow-lg shadow-cyan-500/20"><Icon name="spark" /></span><span><span className="block font-semibold">QuizVerse</span><span className="block text-xs text-slate-500">Quiz Creator</span></span></a>
          <a href="/quizzes" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"><Icon name="arrow-left" className="h-4 w-4" />クイズ一覧へ</a>
        </div>
      </header>

      <form onSubmit={submit} className="relative z-10 mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-7">
            <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-950 p-6 text-white shadow-2xl shadow-indigo-950/20 md:p-9">
              <p className="text-sm font-semibold tracking-[0.18em] text-cyan-300">CREATE YOUR QUIZ</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] md:text-5xl">知っていることを、<br />誰かの楽しい体験へ。</h1>
              <p className="mt-5 max-w-2xl leading-7 text-slate-300">問題と選択肢を入力し、各問題の正解を1つ選択してください。作成したクイズは下書きとして保存されます。</p>
              <p className="mt-3 text-sm text-cyan-100">入力内容はこのブラウザタブに自動保存され、再ログイン後も復元されます。</p>
            </section>

            {submitError && <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200" role="alert">{submitError}</div>}

            <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900 dark:shadow-slate-950/40 md:p-7">
              <div><p className="text-xs font-semibold tracking-[0.18em] text-cyan-700 dark:text-cyan-300">BASIC INFO</p><h2 className="mt-2 text-2xl font-semibold">クイズの基本情報</h2></div>
              <div className="mt-7 space-y-6">
                <label className="block"><span className="flex items-center justify-between gap-3 text-sm font-medium"><span>タイトル <span className="text-rose-500">*</span></span><CharacterCount value={draft.title} max={QUIZ_LIMITS.title} /></span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="例：世界遺産チャレンジ" className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" /><FieldError>{attempted && validation.fields.title}</FieldError></label>
                <div className="grid gap-6 md:grid-cols-2">
                  <label className="block"><span className="flex items-center justify-between gap-3 text-sm font-medium"><span>カテゴリ <span className="font-normal text-slate-400">（任意）</span></span><CharacterCount value={draft.category} max={QUIZ_LIMITS.category} /></span><input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="歴史・科学・ゲームなど" className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" /><FieldError>{attempted && validation.fields.category}</FieldError></label>
                  <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 text-sm text-cyan-900 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-100"><p className="font-medium">保存形式</p><p className="mt-1 leading-6 opacity-80">現在は既存API仕様により下書きとして保存されます。</p></div>
                </div>
                <label className="block"><span className="flex items-center justify-between gap-3 text-sm font-medium"><span>説明 <span className="font-normal text-slate-400">（任意）</span></span><CharacterCount value={draft.description} max={QUIZ_LIMITS.description} /></span><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={4} placeholder="クイズのテーマや難易度、対象者など" className="mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-950" /><FieldError>{attempted && validation.fields.description}</FieldError></label>
              </div>
            </section>

            <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.18em] text-indigo-700 dark:text-indigo-300">QUESTIONS</p><h2 className="mt-2 text-2xl font-semibold">問題を作成</h2><p className="mt-2 text-sm text-slate-500">最大{QUIZ_LIMITS.questions}問まで追加できます。</p></div><span className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-950">{draft.questions.length}問</span></div>
            <FieldError>{attempted && validation.fields.questions}</FieldError>

            {draft.questions.map((question, questionIndex) => (
              <QuestionCard
                key={question.clientId}
                question={question}
                questionIndex={questionIndex}
                error={attempted ? validation.questions[questionIndex] : null}
                canRemove={draft.questions.length > 1}
                onQuestionChange={(patch) => updateQuestion(questionIndex, patch)}
                onChoiceChange={(choiceIndex, patch, setCorrectOnly) => updateChoice(questionIndex, choiceIndex, patch, setCorrectOnly)}
                onAddChoice={() => addChoice(questionIndex)}
                onRemoveChoice={(choiceIndex) => removeChoice(questionIndex, choiceIndex)}
                onRemoveQuestion={() => removeQuestion(questionIndex)}
              />
            ))}

            <button type="button" disabled={draft.questions.length >= QUIZ_LIMITS.questions} onClick={addQuestion} className="flex w-full items-center justify-center gap-2 rounded-[2rem] border-2 border-dashed border-cyan-300 bg-cyan-50/50 px-6 py-5 font-medium text-cyan-800 transition hover:border-cyan-500 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-cyan-500/40 dark:bg-cyan-500/5 dark:text-cyan-200 dark:hover:bg-cyan-500/10"><Icon name="plus" />問題を追加する</button>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:shadow-slate-950/50">
              <p className="text-xs font-semibold tracking-[0.18em] text-slate-500">SUMMARY</p>
              <h2 className="mt-2 text-lg font-semibold">作成内容</h2>
              <dl className="mt-5 space-y-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-500">問題数</dt><dd className="font-medium">{draft.questions.length}問</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">選択肢</dt><dd className="font-medium">{draft.questions.reduce((sum, question) => sum + question.choices.length, 0)}件</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">入力状態</dt><dd className={validation.valid ? 'font-medium text-emerald-600 dark:text-emerald-300' : 'font-medium text-amber-600 dark:text-amber-300'}>{validation.valid ? '作成可能' : '入力中'}</dd></div></dl>
              <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-500 dark:bg-slate-950 dark:text-slate-400">正答情報は作成APIへ送信されますが、一般公開のクイズ詳細APIには含まれません。</div>
              <button type="submit" disabled={submitting} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 py-3.5 font-semibold text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-indigo-400 disabled:cursor-wait disabled:opacity-60">{submitting ? '保存中...' : 'クイズを作成する'}<Icon name="check" /></button>
              <a href="/quizzes" onClick={cancelCreation} className="mt-3 block rounded-2xl px-5 py-3 text-center text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">作成をやめて下書きを削除</a>
            </section>
          </aside>
        </div>
      </form>
    </div>
  )
}
