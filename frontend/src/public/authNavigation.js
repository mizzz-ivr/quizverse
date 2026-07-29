const AUTH_RETURN_KEY = 'quizverse_auth_return_to'
const DEFAULT_RETURN_PATH = '/quizzes'

export function normalizeReturnPath(value, fallback = DEFAULT_RETURN_PATH) {
  if (typeof value !== 'string') return fallback
  const candidate = value.trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return fallback

  try {
    const base = new URL('https://quizverse.local')
    const parsed = new URL(candidate, base)
    if (parsed.origin !== base.origin) return fallback
    if (parsed.pathname === '/login' || parsed.pathname === '/signup') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function rememberAuthReturnPath(returnTo, storage = globalThis.sessionStorage) {
  const normalized = normalizeReturnPath(returnTo)
  storage?.setItem?.(AUTH_RETURN_KEY, normalized)
  return normalized
}

export function consumeAuthReturnPath({
  search = globalThis.window?.location?.search ?? '',
  storage = globalThis.sessionStorage,
} = {}) {
  const stored = storage?.getItem?.(AUTH_RETURN_KEY)
  storage?.removeItem?.(AUTH_RETURN_KEY)

  const queryValue = new URLSearchParams(search).get('next')
  if (queryValue) return normalizeReturnPath(queryValue)
  if (stored) return normalizeReturnPath(stored)
  return null
}

export function buildAuthPath(mode, returnTo) {
  const pathname = mode === 'signup' ? '/signup' : '/login'
  const normalized = normalizeReturnPath(returnTo)
  return `${pathname}?next=${encodeURIComponent(normalized)}`
}
