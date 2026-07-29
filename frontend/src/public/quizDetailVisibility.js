export function shouldShowQuestionExplanation({ viewerIsAuthor = false, hasResult = false } = {}) {
  return viewerIsAuthor === true || hasResult === true
}
