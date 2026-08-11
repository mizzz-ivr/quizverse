export const REVIEW_BODY_MAX_LENGTH = 1000

export function ratingStars(rating) {
  const numeric = Number(rating)
  const filled = Number.isFinite(numeric) ? Math.max(0, Math.min(5, Math.round(numeric))) : 0
  return `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}`
}

export function formatRatingAverage(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '未評価'
  return numeric.toFixed(1)
}

export function normalizeReviewSummary(summary = {}) {
  const count = Number(summary.review_count)
  const average = summary.rating_average == null ? null : Number(summary.rating_average)
  return {
    reviewCount: Number.isFinite(count) ? count : 0,
    ratingAverage: Number.isFinite(average) ? average : null,
  }
}

export function normalizeRatedQuiz(quiz = {}) {
  const summary = normalizeReviewSummary({
    review_count: quiz.review_count,
    rating_average: quiz.rating_average,
  })
  return {
    ...quiz,
    description: quiz.description ?? quiz.description_summary ?? '',
    review_count: summary.reviewCount,
    rating_average: summary.ratingAverage,
  }
}

export function reviewEligibilityMessage(eligibility) {
  if (eligibility?.eligible) return ''
  if (eligibility?.reason === 'author') return '作成者本人は自分のクイズを評価できません。'
  if (eligibility?.reason === 'not_played') return 'レビューするには、このクイズを1回以上プレイしてください。'
  return 'このクイズには現在レビューを投稿できません。'
}
