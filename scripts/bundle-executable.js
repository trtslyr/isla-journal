#!/usr/bin/env node

// Creates a single executable that users can double-click
// Bundles the PWA + proxy server into one file

const fs = require('fs')
const path = require('path')

function getStaticFiles() {
  const distPath = path.join(__dirname, '..', 'dist', 'renderer')
  const files = {}
  
  function walkDir(dir, prefix = '') {
    if (!fs.existsSync(dir)) return
    const items = fs.readdirSync(dir)
    for (const item of items) {
      const fullPath = path.join(dir, item)
      const relativePath = path.join(prefix, item).replace(/\\/g, '/')
      if (fs.statSync(fullPath).isDirectory()) {
        walkDir(fullPath, relativePath)
      } else {
        files[relativePath] = fs.readFileSync(fullPath, 'base64')
      }
    }
  }
  
  walkDir(distPath)
  return files
}

const bundleScript = `#!/usr/bin/env node

// Isla Journal PWA - Self-contained executable
// Double-click to start, then open http://localhost:5173

const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

// Embedded static files (base64 encoded)
const STATIC_FILES = ${JSON.stringify(getStaticFiles(), null, 2)}

const OLLAMA_HOST = 'http://127.0.0.1:11434'
let PORT = 5173

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.listen(startPort, (err) => {
      if (err) {
        server.close()
        resolve(findAvailablePort(startPort + 1))
      } else {
        const port = server.address().port
        server.close()
        resolve(port)
      }
    })
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1))
    })
  })
}

function serve(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }
  
  // Proxy API requests to Ollama
  if (req.url && (req.url === '/api' || req.url.startsWith('/api/'))) {
    proxyToOllama(req, res)
    return
  }
  
  // Serve static files
  let filePath = req.url === '/' ? 'index.html' : req.url.slice(1)
  if (STATIC_FILES[filePath]) {
    const ext = path.extname(filePath)
    const contentType = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ttf': 'font/ttf'
    }[ext] || 'text/plain'
    
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(Buffer.from(STATIC_FILES[filePath], 'base64'))
  } else {
    // SPA fallback
    if (STATIC_FILES['index.html']) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(Buffer.from(STATIC_FILES['index.html'], 'base64'))
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  }
}

function proxyToOllama(req, res) {
  const url = new URL(req.url, \`http://localhost:\${PORT}\`)
  
  const options = {
    hostname: '127.0.0.1',
    port: 11434,
    path: url.pathname + url.search,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:11434' }
  }
  
  const proxyReq = http.request(options, (proxyRes) => {
    // Copy CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res)
  })
  
  proxyReq.on('error', (err) => {
    res.writeHead(502)
    res.end(\`Ollama connection failed: \${err.message}\`)
  })
  
  req.pipe(proxyReq)
}

async function startServer() {
  PORT = await findAvailablePort(PORT)
  const server = http.createServer(serve)
  
  server.listen(PORT, () => {
    console.log(\`🚀 Isla Journal PWA running on http://localhost:\${PORT}\`)
    console.log('📝 Open the URL above in Chrome, Edge, or another Chromium browser')
    console.log('🤖 Make sure Ollama is running: ollama serve')
    console.log('⏹️  Press Ctrl+C to stop')
    
    // Auto-open browser on macOS/Windows
    const open = process.platform === 'darwin' ? 'open' : 
                  process.platform === 'win32' ? 'start' : 'xdg-open'
    try {
      spawn(open, [\`http://localhost:\${PORT}\`], { detached: true, stdio: 'ignore' })
    } catch {}
  })
}

startServer().catch(console.error)
`

fs.writeFileSync(path.join(__dirname, '..', 'isla-journal'), bundleScript, { mode: 0o755 })
console.log('✅ Created isla-journal executable')
console.log('Users can now just run: ./isla-journal')
