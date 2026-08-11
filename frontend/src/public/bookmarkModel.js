export function normalizeBookmarkPayload(payload = {}) {
  const pagination = payload.pagination ?? {}
  return {
    items: (payload.items ?? []).map((item) => ({
      ...item,
      quiz: {
        ...(item.quiz ?? {}),
        question_count: Number(item.quiz?.question_count ?? 0),
      },
    })),
    pagination: {
      page: Number(pagination.page ?? 1),
      per_page: Number(pagination.per_page ?? 12),
      total: Number(pagination.total ?? 0),
      total_pages: Number(pagination.total_pages ?? 0),
    },
  }
}

export function formatBookmarkedAt(value) {
  if (!value) return '保存日時なし'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '保存日時なし'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function canMoveBookmarkPage(pagination, direction) {
  const page = Number(pagination?.page ?? 1)
  const totalPages = Number(pagination?.total_pages ?? 0)
  if (direction === 'previous') return page > 1
  if (direction === 'next') return totalPages > 0 && page < totalPages
  return false
}
