/*
  Embeds all missing chunks into the app database using Ollama.
  Usage:
    OLLAMA_HOST=http://127.0.0.1:11434 node scripts/embed-all.js [model]
  Notes:
    - Respects OLLAMA_HOST (http or https). If https fails with SSL error, tries http fallback.
    - Default model: llama3.1:latest
*/

const path = require('path')
const os = require('os')
const Database = require('better-sqlite3')
const { Ollama } = require('ollama')

function resolveDbPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'isla-journal', 'database', 'isla.db')
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'Isla Journal', 'database', 'isla.db')
  }
  // linux and others
  return path.join(os.homedir(), '.local', 'share', 'Isla Journal', 'database', 'isla.db')
}

async function makeOllamaClient() {
  const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
  try {
    const client = new Ollama({ host })
    await client.list()
    console.log(`✅ Ollama reachable at ${host}`)
    return client
  } catch (err) {
    const msg = String(err?.message || err)
    if (host.startsWith('https://') && /WRONG_VERSION_NUMBER|ssl/i.test(msg)) {
      const httpHost = host.replace('https://', 'http://')
      try {
        const client = new Ollama({ host: httpHost })
        await client.list()
        console.log(`✅ Ollama reachable at ${httpHost} (http fallback)`) 
        return client
      } catch (err2) {
        console.error('❌ Failed to reach Ollama via https and http fallback')
        throw err2
      }
    }
    throw err
  }
}

function ensureEmbeddingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id INTEGER NOT NULL,
      vector TEXT NOT NULL,
      dim INTEGER NOT NULL,
      model TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chunk_id) REFERENCES content_chunks (id) ON DELETE CASCADE
    );
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings (model);`)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_chunk_model ON embeddings (chunk_id, model);`)
}

async function main() {
  const model = process.argv[2] || 'llama3.1:latest'
  const dbPath = resolveDbPath()
  console.log('🗄️ DB:', dbPath)
  console.log('🧠 Model:', model)
  const db = new Database(dbPath)
  ensureEmbeddingsTable(db)

  const selectBatch = db.prepare(`
    SELECT c.id, c.chunk_text
    FROM content_chunks c
    LEFT JOIN embeddings e ON e.chunk_id = c.id AND e.model = ?
    WHERE e.chunk_id IS NULL
    LIMIT ?
  `)
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO embeddings (chunk_id, vector, dim, model)
    VALUES (?, ?, ?, ?)
  `)
  const countChunks = db.prepare('SELECT COUNT(*) as c FROM content_chunks')
  const countEmbedded = db.prepare('SELECT COUNT(*) as c FROM embeddings WHERE model = ?')

  const client = await makeOllamaClient()

  const batchSize = 32
  const total = countChunks.get().c
  let embedded = countEmbedded.get(model).c
  console.log(`📊 Total chunks: ${total}, already embedded: ${embedded}`)

  while (true) {
    const batch = selectBatch.all(model, batchSize)
    if (!batch.length) break
    const vectors = []
    for (const row of batch) {
      const res = await client.embeddings({ model, prompt: row.chunk_text })
      const v = res?.embedding || (res?.data && res.data[0]?.embedding) || []
      vectors.push({ id: row.id, vec: v })
      // gentle pacing to avoid overloading
      await new Promise(r => setTimeout(r, 5))
    }
    const tx = db.transaction(() => {
      for (const item of vectors) {
        upsert.run(item.id, JSON.stringify(item.vec), item.vec.length, model)
      }
    })
    tx()
    embedded += batch.length
    console.log(`✅ Embedded batch: ${batch.length} → ${embedded}/${total}`)
  }

  console.log('🎉 Done. Embeddings built.')
  db.close()
}

main().catch(err => {
  console.error('❌ Failed to build embeddings:', err)
  process.exit(1)
})


