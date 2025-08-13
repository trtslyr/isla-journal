import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Minimal web bridge bootstrap (loaded before App)
import './webBridge'

// Optional: register SW as early as possible
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/sw.js').catch(() => {})
	})
}
 
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
) 