import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initAntiDebug } from './lib/antiDebug'

// Инициализация защиты от реверс-инжиниринга
if (import.meta.env.PROD) {
  initAntiDebug()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

