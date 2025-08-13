#!/usr/bin/env node
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist', 'renderer')
const PORT = 5178
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
  
  // Handle API requests differently
  if (req.url && req.url.startsWith('/api/')) {
    console.log(`🔄 Proxying ${req.method} ${req.url} to Ollama`)
    
    // Create proxy request to Ollama
    const options = {
      hostname: '127.0.0.1',
      port: 11434,
      path: req.url,
      method: req.method,
      headers: {}
    }
    
    // Only add headers that exist
    if (req.headers['content-type']) {
      options.headers['Content-Type'] = req.headers['content-type']
    }
    if (req.headers['content-length']) {
      options.headers['Content-Length'] = req.headers['content-length']
    }
    if (req.headers['accept']) {
      options.headers['Accept'] = req.headers['accept']
    } else {
      options.headers['Accept'] = 'application/json'
    }
    
    const proxyReq = http.request(options, (proxyRes) => {
      console.log(`📡 Ollama responded: ${proxyRes.statusCode}`)

      // Echo headers with CORS additions
      res.writeHead(proxyRes.statusCode, {
        ...(proxyRes.headers || {}),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      })

      if ((proxyRes.statusCode || 0) >= 400) {
        // Collect and log error body for debugging
        let errBody = ''
        proxyRes.setEncoding('utf8')
        proxyRes.on('data', (chunk) => { errBody += chunk })
        proxyRes.on('end', () => {
          try { console.error('❗Ollama error body:', errBody.slice(0, 1000)) } catch {}
          res.end(errBody)
        })
        return
      }

      proxyRes.pipe(res)
    })
    
    proxyReq.on('error', (err) => {
      console.error('❌ Proxy error:', err.message)
      res.writeHead(502, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain'
      })
      res.end(`Proxy error: ${err.message}`)
    })
    
    // Forward the request body
    req.pipe(proxyReq)
  } else {
    // Serve static files
    serveFile(req.url, res)
  }
})

server.listen(PORT, () => {
  console.log(`🚀 Isla Journal PWA running on http://localhost:${PORT}`)
  console.log(`📂 Serving from ${DIST}`)
  console.log(`🤖 Proxying /api/ → ${OLLAMA}`)
})
