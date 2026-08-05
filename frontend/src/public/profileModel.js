export const PROFILE_RESULT_FILTERS = [
  { value: 'all', label: 'すべて' },
  { value: 'perfect', label: '全問正解' },
  { value: 'passed', label: '70%以上' },
  { value: 'review', label: '要復習' },
]

export function formatAccuracy(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '0%'
  const rounded = Number.isInteger(numeric) ? numeric : numeric.toFixed(1)
  return `${rounded}%`
}

export function formatProfileDate(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

export function resultPresentation(result) {
  if (result === 'perfect') {
    return { label: '全問正解', symbol: '★', className: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200' }
  }
  if (result === 'passed') {
    return { label: '合格ライン', symbol: '✓', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200' }
  }
  return { label: '要復習', symbol: '↻', className: 'bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200' }
}

export function normalizeProfileStats(stats = {}) {
  return {
    playCount: Number(stats.play_count ?? 0),
    attemptedQuizCount: Number(stats.attempted_quiz_count ?? 0),
    correctAnswers: Number(stats.correct_answers ?? 0),
    totalQuestions: Number(stats.total_questions ?? 0),
    averageAccuracyPercentage: Number(stats.average_accuracy_percentage ?? 0),
    perfectPlayCount: Number(stats.perfect_play_count ?? 0),
    createdQuizCount: Number(stats.created_quiz_count ?? 0),
  }
}

export function canMoveHistoryPage(pagination, direction) {
  const page = Number(pagination?.page ?? 1)
  const totalPages = Number(pagination?.total_pages ?? 0)
  if (direction === 'previous') return page > 1
  if (direction === 'next') return totalPages > 0 && page < totalPages
  return false
}
