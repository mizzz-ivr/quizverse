import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { CreateQuizApp } from './public/CreateQuizApp'
import { PublicQuizApp } from './public/PublicQuizApp'

function PublicQuizRoot() {
  return (
    <>
      <PublicQuizApp />
      <a
        href="/quizzes/new"
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 py-3 font-semibold text-white shadow-xl shadow-cyan-500/25 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-indigo-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/30"
      >
        <span aria-hidden="true">＋</span>
        クイズを作る
      </a>
    </>
  )
}

const pathname = window.location.pathname
let RootApp = PublicQuizRoot
if (pathname === '/status' || pathname.startsWith('/admin')) RootApp = App
if (pathname === '/quizzes/new') RootApp = CreateQuizApp

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
)
