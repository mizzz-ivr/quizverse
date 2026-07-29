import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { PublicQuizApp } from './public/PublicQuizApp'

const pathname = window.location.pathname
const RootApp = pathname === '/status' || pathname.startsWith('/admin') ? App : PublicQuizApp

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
)
