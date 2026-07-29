export function countPageQuizStatuses(items = []) {
  return items.reduce((counts, quiz) => {
    if (quiz?.status) counts[quiz.status] = (counts[quiz.status] ?? 0) + 1
    return counts
  }, {})
}

export function pageAfterQuizStatusChange() {
  return 1
}
