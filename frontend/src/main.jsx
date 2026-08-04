import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { AdminApp } from './AdminApp'
import { AdminUserManagementApp } from './AdminUserManagementApp'
import { CreateQuizApp } from './public/CreateQuizApp'
import { EditQuizApp } from './public/EditQuizApp'
import { MyQuizzesApp } from './public/MyQuizzesApp'
import { PublicQuizApp } from './public/PublicQuizApp'
import { QuizDetailSessionGate } from './public/QuizDetailSessionGate'
import { removeLegacyAuthToken } from './public/api'

// Run the localStorage JWT cleanup for every entry path, including /status and
// /admin, before selecting the React root.
removeLegacyAuthToken()

function PublicQuizRoot() {
  return (
    <>
      <PublicQuizApp />
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
        <a
          href="/my/quizzes"
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          <span aria-hidden="true">▣</span>
          マイクイズ
        </a>
        <a
          href="/quizzes/new"
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 py-3 font-semibold text-white shadow-xl shadow-cyan-500/25 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-indigo-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/30"
        >
          <span aria-hidden="true">＋</span>
          クイズを作る
        </a>
      </div>
    </>
  )
}

const pathname = window.location.pathname
let RootApp = PublicQuizRoot
if (pathname === '/status') RootApp = App
if (pathname === '/admin/users') RootApp = AdminUserManagementApp
else if (pathname.startsWith('/admin')) RootApp = AdminApp
if (pathname === '/quizzes/new') RootApp = CreateQuizApp
if (pathname === '/my/quizzes') RootApp = MyQuizzesApp
if (/^\/my\/quizzes\/\d+\/edit$/.test(pathname)) RootApp = EditQuizApp
if (/^\/quizzes\/\d+$/.test(pathname)) RootApp = QuizDetailSessionGate

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
)