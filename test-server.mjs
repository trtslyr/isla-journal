#!/usr/bin/env node
import http from 'http'

const server = http.createServer((req, res) => {
  console.log(`Request: ${req.method} ${req.url}`)
  
  if (req.url.startsWith('/api/')) {
    // Proxy to Ollama
    const options = {
      hostname: '127.0.0.1',
      port: 11434,
      path: req.url,
      method: req.method,
      headers: req.headers
    }
    
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
    })
    
    proxyReq.on('error', (err) => {
      res.writeHead(502)
      res.end(`Error: ${err.message}`)
    })
    
    req.pipe(proxyReq)
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(`Hello! You requested: ${req.url}`)
  }
})

server.listen(5176, () => {
  console.log('Test server running on http://localhost:5176')
})
