import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Self-hosted fonts: the app makes no third-party requests, which also allows a strict Content-Security-Policy
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
