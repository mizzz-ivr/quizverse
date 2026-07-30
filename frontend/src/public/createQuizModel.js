export const QUIZ_LIMITS = {
  title: 120,
  description: 2000,
  category: 80,
  questions: 50,
  questionBody: 2000,
  explanation: 4000,
  choiceBody: 1000,
  minChoices: 2,
  maxChoices: 6,
}

export const QUIZ_DRAFT_KEY = 'quizverse_quiz_create_draft'
export const QUIZ_EDIT_DRAFT_KEY_PREFIX = 'quizverse_quiz_edit_draft:'

let fallbackSequence = 0

export function createClientId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`
  fallbackSequence += 1
  return `${prefix}-${Date.now()}-${fallbackSequence}`
}

export function createChoice({ body = '', isCorrect = false, clientId } = {}) {
  return {
    clientId: clientId || createClientId('choice'),
    body: typeof body === 'string' ? body : '',
    isCorrect: isCorrect === true,
  }
}

export function createQuestion({ body = '', explanation = '', choices, clientId } = {}) {
  const initialChoices = Array.isArray(choices) && choices.length > 0
    ? choices.map((choice) => createChoice(choice))
    : [
        createChoice({ isCorrect: true }),
        createChoice(),
        createChoice(),
        createChoice(),
      ]

  return {
    clientId: clientId || createClientId('question'),
    body: typeof body === 'string' ? body : '',
    explanation: typeof explanation === 'string' ? explanation : '',
    choices: initialChoices,
  }
}

export function createInitialQuizDraft() {
  return {
    title: '',
    description: '',
    category: '',
    questions: [createQuestion()],
  }
}

function normalizeStoredDraft(parsed) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    return null
  }

  return {
    title: typeof parsed.title === 'string' ? parsed.title : '',
    description: typeof parsed.description === 'string' ? parsed.description : '',
    category: typeof parsed.category === 'string' ? parsed.category : '',
    questions: parsed.questions.slice(0, QUIZ_LIMITS.questions).map((question) => createQuestion({
      ...question,
      choices: Array.isArray(question?.choices)
        ? question.choices.slice(0, QUIZ_LIMITS.maxChoices)
        : undefined,
    })),
  }
}

export function saveQuizDraft(draft, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem?.(QUIZ_DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function loadQuizDraft(storage = globalThis.sessionStorage) {
  try {
    const rawDraft = storage?.getItem?.(QUIZ_DRAFT_KEY)
    if (!rawDraft) return createInitialQuizDraft()
    return normalizeStoredDraft(JSON.parse(rawDraft)) ?? createInitialQuizDraft()
  } catch {
    return createInitialQuizDraft()
  }
}

export function clearQuizDraft(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem?.(QUIZ_DRAFT_KEY)
  } catch {
    // Storage can be unavailable in privacy-restricted environments.
  }
}

function editableDraftKey(quizId) {
  return `${QUIZ_EDIT_DRAFT_KEY_PREFIX}${quizId}`
}

export function saveEditableQuizDraft(
  quizId,
  serverUpdatedAt,
  draft,
  storage = globalThis.sessionStorage,
) {
  if (!quizId || !serverUpdatedAt) return false
  try {
    storage?.setItem?.(editableDraftKey(quizId), JSON.stringify({
      serverUpdatedAt,
      draft,
    }))
    return true
  } catch {
    return false
  }
}

export function loadEditableQuizDraft(
  quizId,
  serverUpdatedAt,
  storage = globalThis.sessionStorage,
) {
  if (!quizId || !serverUpdatedAt) return null
  try {
    const rawDraft = storage?.getItem?.(editableDraftKey(quizId))
    if (!rawDraft) return null
    const parsed = JSON.parse(rawDraft)
    if (parsed?.serverUpdatedAt !== serverUpdatedAt) {
      storage?.removeItem?.(editableDraftKey(quizId))
      return null
    }
    return normalizeStoredDraft(parsed.draft)
  } catch {
    return null
  }
}

export function clearEditableQuizDraft(quizId, storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem?.(editableDraftKey(quizId))
  } catch {
    // Storage can be unavailable in privacy-restricted environments.
  }
}

function trimmedLength(value) {
  return typeof value === 'string' ? value.trim().length : 0
}

export function validateQuizDraft(draft) {
  const fields = {}
  const questionErrors = []

  if (!trimmedLength(draft.title)) {
    fields.title = 'タイトルを入力してください。'
  } else if (draft.title.trim().length > QUIZ_LIMITS.title) {
    fields.title = `タイトルは${QUIZ_LIMITS.title}文字以内で入力してください。`
  }

  if ((draft.description ?? '').trim().length > QUIZ_LIMITS.description) {
    fields.description = `説明は${QUIZ_LIMITS.description}文字以内で入力してください。`
  }

  if ((draft.category ?? '').trim().length > QUIZ_LIMITS.category) {
    fields.category = `カテゴリは${QUIZ_LIMITS.category}文字以内で入力してください。`
  }

  const questions = Array.isArray(draft.questions) ? draft.questions : []
  if (questions.length < 1 || questions.length > QUIZ_LIMITS.questions) {
    fields.questions = `問題数は1〜${QUIZ_LIMITS.questions}問にしてください。`
  }

  questions.forEach((question) => {
    const error = { choices: [] }
    const choices = Array.isArray(question.choices) ? question.choices : []

    if (!trimmedLength(question.body)) {
      error.body = '問題文を入力してください。'
    } else if (question.body.trim().length > QUIZ_LIMITS.questionBody) {
      error.body = `問題文は${QUIZ_LIMITS.questionBody}文字以内で入力してください。`
    }

    if ((question.explanation ?? '').trim().length > QUIZ_LIMITS.explanation) {
      error.explanation = `解説は${QUIZ_LIMITS.explanation}文字以内で入力してください。`
    }

    if (choices.length < QUIZ_LIMITS.minChoices || choices.length > QUIZ_LIMITS.maxChoices) {
      error.choiceCount = `選択肢は${QUIZ_LIMITS.minChoices}〜${QUIZ_LIMITS.maxChoices}件にしてください。`
    }

    choices.forEach((choice, choiceIndex) => {
      if (!trimmedLength(choice.body)) {
        error.choices[choiceIndex] = '選択肢を入力してください。'
      } else if (choice.body.trim().length > QUIZ_LIMITS.choiceBody) {
        error.choices[choiceIndex] = `選択肢は${QUIZ_LIMITS.choiceBody}文字以内で入力してください。`
      }
    })

    if (choices.filter((choice) => choice.isCorrect === true).length !== 1) {
      error.correctChoice = '正解を1つ選択してください。'
    }

    questionErrors.push(error)
  })

  const hasQuestionErrors = questionErrors.some((error) => (
    error.body
    || error.explanation
    || error.choiceCount
    || error.correctChoice
    || error.choices.some(Boolean)
  ))

  return {
    valid: Object.keys(fields).length === 0 && !hasQuestionErrors,
    fields,
    questions: questionErrors,
  }
}

export function buildCreateQuizPayload(draft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    category: draft.category.trim() || null,
    questions: draft.questions.map((question) => ({
      body: question.body.trim(),
      explanation: question.explanation.trim() || null,
      choices: question.choices.map((choice) => ({
        body: choice.body.trim(),
        is_correct: choice.isCorrect === true,
      })),
    })),
  }
}

export function buildQuizDraftFromEditableQuiz(quiz) {
  if (!quiz || typeof quiz !== 'object' || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    return createInitialQuizDraft()
  }

  return {
    title: typeof quiz.title === 'string' ? quiz.title : '',
    description: typeof quiz.description === 'string' ? quiz.description : '',
    category: typeof quiz.category === 'string' ? quiz.category : '',
    questions: quiz.questions.slice(0, QUIZ_LIMITS.questions).map((question) => createQuestion({
      body: question?.body,
      explanation: question?.explanation,
      choices: Array.isArray(question?.choices)
        ? question.choices.slice(0, QUIZ_LIMITS.maxChoices).map((choice) => ({
            body: choice?.body,
            isCorrect: choice?.is_correct === true,
          }))
        : undefined,
    })),
  }
}
