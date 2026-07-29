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

let fallbackSequence = 0

export function createClientId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`
  fallbackSequence += 1
  return `${prefix}-${Date.now()}-${fallbackSequence}`
}

export function createChoice({ body = '', isCorrect = false } = {}) {
  return {
    clientId: createClientId('choice'),
    body,
    isCorrect,
  }
}

export function createQuestion() {
  return {
    clientId: createClientId('question'),
    body: '',
    explanation: '',
    choices: [
      createChoice({ isCorrect: true }),
      createChoice(),
      createChoice(),
      createChoice(),
    ],
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
