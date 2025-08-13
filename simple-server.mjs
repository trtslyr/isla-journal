#!/usr/bin/env node
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist', 'renderer')
const PORT = process.env.PORT || 5177
const OLLAMA = 'http://127.0.0.1:11434'

// Simple file serving
function serveFile(filePath, res) {
  try {
    const fullPath = path.join(DIST, filePath === '/' ? 'index.html' : filePath)
    if (!fs.existsSync(fullPath)) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    
    const ext = path.extname(fullPath)
    const contentType = {
      '.html': 'text/html',
      '.js': 'application/javascript', 
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.ttf': 'font/ttf',
      '.png': 'image/png'
    }[ext] || 'text/plain'
    
    const content = fs.readFileSync(fullPath)
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
  } catch (err) {
    res.writeHead(500)
    res.end('Server error')
  }
}

// Proxy to Ollama
function proxyToOllama(req, res) {
  // Clean up headers for Ollama - remove browser-specific headers
  const cleanHeaders = { ...req.headers }
  cleanHeaders.host = '127.0.0.1:11434'
  
  // Remove browser security headers that Ollama doesn't like
  delete cleanHeaders.origin
  delete cleanHeaders.referer
  delete cleanHeaders['sec-ch-ua']
  delete cleanHeaders['sec-ch-ua-mobile']
  delete cleanHeaders['sec-ch-ua-platform']
  delete cleanHeaders['sec-fetch-site']
  delete cleanHeaders['sec-fetch-mode']
  delete cleanHeaders['sec-fetch-dest']
  delete cleanHeaders['upgrade-insecure-requests']
  
  const options = {
    hostname: '127.0.0.1',
    port: 11434,
    path: req.url,
    method: req.method,
    headers: cleanHeaders
  }
  
  console.log(`Proxying ${req.method} ${req.url} to Ollama`)
  console.log('Headers:', JSON.stringify(cleanHeaders, null, 2))
  
  // Log request body for POST requests
  if (req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      console.log('Request body:', body)
    })
  }
  
  const proxyReq = http.request(options, (proxyRes) => {
    // Add CORS headers to response
    const responseHeaders = {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
    
    res.writeHead(proxyRes.statusCode, responseHeaders)
    proxyRes.pipe(res)
  })
  
  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err)
    res.writeHead(502, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain'
    })
    res.end(`Ollama connection failed: ${err.message}`)
  })
  
  req.pipe(proxyReq)
}

const server = http.createServer((req, res) => {
  // CORS for all
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }
  
  console.log(`${req.method} ${req.url}`)
  
  if (req.url && req.url.startsWith('/api/')) {
    proxyToOllama(req, res)
  } else {
    serveFile(req.url, res)
  }
})

server.listen(PORT, () => {
  console.log(`🚀 Isla Journal running on http://localhost:${PORT}`)
  console.log(`📂 Serving from ${DIST}`)
  console.log(`🤖 Proxying /api/ → ${OLLAMA}`)
  
  // Auto-open browser
  import('child_process').then(({ spawn }) => {
    const cmd = process.platform === 'darwin' ? 'open' : 
                 process.platform === 'win32' ? 'start' : 'xdg-open'
    try {
      spawn(cmd, [`http://localhost:${PORT}`], { detached: true, stdio: 'ignore' })
    } catch {}
  })
})
