import { useCallback, useEffect, useMemo, useState } from 'react'

import { buildAuthPath, rememberAuthReturnPath } from './authNavigation.js'
import { ApiError, getStoredSession } from './api.js'
import { publicApi } from './reviewApi.js'
import {
  REVIEW_BODY_MAX_LENGTH,
  formatRatingAverage,
  ratingStars,
  reviewEligibilityMessage,
} from './reviewModel.js'

function friendlyReviewError(error) {
  if (!(error instanceof ApiError)) return 'レビューの処理中に予期しないエラーが発生しました。'
  const messages = {
    'review/play_required': 'レビューするには、このクイズを1回以上プレイしてください。',
    'review/author_not_allowed': '作成者本人は自分のクイズを評価できません。',
    'review/quiz_not_found': 'このクイズは現在レビューを受け付けていません。',
    'review/validation_error': '評価またはコメントの内容を確認してください。',
  }
  return messages[error.code] ?? error.message
}

function RatingInput({ value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="5段階評価">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          key={rating}
          type="button"
          role="radio"
          aria-checked={value === rating}
          disabled={disabled}
          onClick={() => onChange(rating)}
          className={`grid h-11 w-11 place-items-center rounded-xl text-2xl transition ${value >= rating ? 'bg-amber-100 text-amber-500 dark:bg-amber-400/15' : 'bg-slate-100 text-slate-300 dark:bg-slate-800 dark:text-slate-600'} disabled:opacity-50`}
          aria-label={`${rating}点`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

export function ReviewQuickAction() {
  const quizId = useMemo(() => window.location.pathname.match(/^\/quizzes\/(\d+)$/)?.[1] ?? '', [])
  const session = useMemo(() => getStoredSession(), [])
  const [open, setOpen] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [page, setPage] = useState(1)
  const [reviews, setReviews] = useState({ items: [], summary: {}, pagination: null })
  const [mine, setMine] = useState(null)
  const [eligibility, setEligibility] = useState(null)
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async ({ includeMine = true } = {}) => {
    if (!quizId) return
    setLoading(true)
    setError('')
    try {
      const reviewPayload = await publicApi.quizReviews(quizId, { page, perPage: 5 })
      setReviews(reviewPayload)
      if (includeMine && session?.accessToken) {
        const minePayload = await publicApi.myQuizReview(quizId)
        setMine(minePayload.review ?? null)
        setEligibility(minePayload.eligibility ?? null)
        if (minePayload.review) {
          setRating(Number(minePayload.review.rating) || 5)
          setBody(minePayload.review.body ?? '')
        }
      }
      setUnavailable(false)
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === 'review/quiz_not_found') {
        setUnavailable(true)
      } else {
        setError(friendlyReviewError(requestError))
      }
    } finally {
      setLoading(false)
    }
  }, [page, quizId, session?.accessToken])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    if (!eligibility?.eligible || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const payload = await publicApi.saveQuizReview(quizId, { rating, body })
      setMine(payload.review ?? null)
      setNotice(payload.meta?.created ? 'レビューを投稿しました。' : 'レビューを更新しました。')
      await load({ includeMine: false })
    } catch (requestError) {
      setError(friendlyReviewError(requestError))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!mine || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await publicApi.deleteQuizReview(quizId)
      setMine(null)
      setRating(5)
      setBody('')
      setNotice('レビューを削除しました。')
      await load({ includeMine: false })
    } catch (requestError) {
      setError(friendlyReviewError(requestError))
    } finally {
      setSaving(false)
    }
  }

  const goToLogin = () => {
    const returnTo = rememberAuthReturnPath(`/quizzes/${quizId}`)
    window.location.assign(buildAuthPath('login', returnTo))
  }

  if (!quizId || unavailable) return null

  const average = reviews.summary?.rating_average
  const reviewCount = Number(reviews.summary?.review_count ?? 0)
  const totalPages = Number(reviews.pagination?.total_pages ?? 0)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-40 inline-flex items-center gap-2 rounded-2xl border border-amber-300 bg-white/95 px-4 py-3 text-sm font-black text-slate-800 shadow-xl backdrop-blur transition hover:-translate-y-0.5 hover:border-amber-400 dark:border-amber-500/40 dark:bg-slate-900/95 dark:text-white"
      >
        <span className="text-amber-500" aria-hidden="true">★</span>
        {reviewCount > 0 ? `${formatRatingAverage(average)} (${reviewCount})` : 'レビュー'}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="クイズレビュー">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="閉じる" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto bg-slate-50 p-4 shadow-2xl dark:bg-slate-950 sm:p-6">
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-black text-amber-600 dark:text-amber-300">QUIZ REVIEWS</p>
                  <h2 className="mt-1 text-2xl font-black">プレイヤーの評価</h2>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-xl font-black dark:border-slate-800 dark:bg-slate-900">×</button>
              </div>

              <section className="mt-6 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 p-5 text-white shadow-lg shadow-amber-500/20">
                <div className="flex items-end justify-between gap-4">
                  <div><p className="text-sm font-bold text-white/80">平均評価</p><p className="mt-1 text-4xl font-black">{formatRatingAverage(average)}</p></div>
                  <div className="text-right"><p className="text-xl tracking-widest">{ratingStars(average)}</p><p className="mt-1 text-sm font-bold text-white/80">{reviewCount}件のレビュー</p></div>
                </div>
              </section>

              {error ? <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-500/30 dark:bg-rose-400/10 dark:text-rose-200">{error}</p> : null}
              {notice ? <p role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-400/10 dark:text-emerald-200">{notice}</p> : null}

              <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="font-black">あなたのレビュー</h3>
                {!session?.accessToken ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-950"><p className="text-slate-600 dark:text-slate-300">プレイ後にログインするとレビューを投稿できます。</p><button type="button" onClick={goToLogin} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 font-bold text-white dark:bg-white dark:text-slate-950">ログイン</button></div>
                ) : loading && eligibility == null ? (
                  <p className="mt-4 text-sm text-slate-500">投稿条件を確認しています…</p>
                ) : eligibility?.eligible ? (
                  <div className="mt-4 space-y-4">
                    <RatingInput value={rating} onChange={setRating} disabled={saving} />
                    <label className="block text-sm font-bold">コメント（任意）<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={REVIEW_BODY_MAX_LENGTH} rows={4} className="mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 font-normal outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-400/10 dark:border-slate-700 dark:bg-slate-950" placeholder="難易度、面白かった点、改善してほしい点など" /></label>
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>{body.length}/{REVIEW_BODY_MAX_LENGTH}</span><div className="flex gap-2">{mine ? <button type="button" onClick={remove} disabled={saving} className="rounded-xl border border-rose-300 px-3 py-2 font-bold text-rose-700 disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-300">削除</button> : null}<button type="button" onClick={save} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">{saving ? '保存中…' : mine ? '更新する' : '投稿する'}</button></div></div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-950"><p className="text-slate-600 dark:text-slate-300">{reviewEligibilityMessage(eligibility)}</p>{eligibility?.reason === 'not_played' ? <button type="button" onClick={() => load()} className="mt-3 rounded-xl border border-slate-300 px-3 py-2 font-bold dark:border-slate-700">プレイ後に更新</button> : null}</div>
                )}
              </section>

              <section className="mt-6">
                <div className="flex items-center justify-between gap-3"><h3 className="font-black">最新レビュー</h3>{loading ? <span className="text-xs text-slate-500">読み込み中…</span> : null}</div>
                <div className="mt-3 space-y-3">
                  {!loading && reviews.items?.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">まだレビューはありません。最初のレビューを投稿してみましょう。</div> : null}
                  {(reviews.items ?? []).map((review, index) => <article key={`${review.user?.id ?? index}-${review.updated_at ?? index}`} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{review.user?.display_name || '匿名ユーザー'}</p><p className="mt-1 text-sm tracking-wider text-amber-500">{ratingStars(review.rating)}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-black text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">{review.rating}/5</span></div>{review.body ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{review.body}</p> : <p className="mt-3 text-sm text-slate-400">コメントなし</p>}</article>)}
                </div>
                {totalPages > 1 ? <div className="mt-4 flex items-center justify-center gap-3"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-40 dark:border-slate-700">前へ</button><span className="text-sm text-slate-500">{page} / {totalPages}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-40 dark:border-slate-700">次へ</button></div> : null}
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  )
}
