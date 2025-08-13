#!/usr/bin/env node
import http from 'http'
import httpProxy from 'http-proxy'
import sirv from 'sirv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DIST = join(__dirname, '..', 'dist', 'renderer')
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5173
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'

const serve = sirv(DIST, { dev: false, etag: true, gzip: true, brotli: true })
const proxy = httpProxy.createProxyServer({ target: OLLAMA, changeOrigin: false, ws: true })

proxy.on('error', (err, req, res) => {
  res.writeHead(502, { 'Content-Type': 'text/plain' })
  res.end(`Proxy error: ${err.message}`)
})

const server = http.createServer((req, res) => {
  // Add CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }
  
  if (req.url && (req.url === '/api' || req.url.startsWith('/api/'))) {
    proxy.web(req, res, { target: OLLAMA })
    return
  }
  serve(req, res)
})

server.on('upgrade', (req, socket, head) => {
  if (req.url && (req.url === '/api' || req.url.startsWith('/api/'))) {
    proxy.ws(req, socket, head)
  }
})

server.listen(PORT, () => {
  console.log(`Isla PWA proxy server running on http://localhost:${PORT}`)
  console.log(`Serving static from ${DIST}`)
  console.log(`Proxying /api → ${OLLAMA}`)
})
