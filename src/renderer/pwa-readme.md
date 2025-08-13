# Isla Journal PWA

- Dev: `npm run dev` then open the URL in a Chromium browser
- Build: `npm run build` then `npm run preview`
- Install: Use browser “Install app” in address bar.

Ollama connection:
- Default host: http://127.0.0.1:11434
- You can set a custom host and model by opening DevTools console and running:
```js
localStorage.setItem('ollamaHost', 'http://127.0.0.1:11434')
localStorage.setItem('ollamaModel', 'llama3.2:latest')
```

File access:
- Click “Open Directory” in the UI; it will request access using the File System Access API.
- Browser may restrict recursive operations; current implementation reads top-level entries.