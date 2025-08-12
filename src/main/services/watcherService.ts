import chokidar, { FSWatcher } from 'chokidar'
import path from 'path'
import { database } from '../database'

export class WatcherService {
  private static instance: WatcherService
  private watcher: FSWatcher | null = null

  static getInstance(): WatcherService {
    if (!WatcherService.instance) WatcherService.instance = new WatcherService()
    return WatcherService.instance
  }

  async start(rootDir: string) {
    await database.ensureReady()
    if (this.watcher) await this.watcher.close()

    this.watcher = chokidar.watch(rootDir, {
      ignored: [/(^|[/\\])\../, '**/node_modules/**', '**/.git/**', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.pdf'],
      persistent: true,
      ignoreInitial: true,
      depth: 20,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 }
    })

    this.watcher
      .on('add', async (filePath: string) => {
        if (!filePath.endsWith('.md')) return
        try {
          const fileName = path.basename(filePath)
          const fs = await import('fs/promises')
          const content = await fs.readFile(filePath, 'utf-8')
          database.saveFile(filePath, fileName, content)
        } catch (e) {}
      })
      .on('change', async (filePath: string) => {
        if (!filePath.endsWith('.md')) return
        try {
          const fileName = path.basename(filePath)
          const fs = await import('fs/promises')
          const content = await fs.readFile(filePath, 'utf-8')
          database.saveFile(filePath, fileName, content)
        } catch (e) {}
      })
      .on('unlink', async (filePath: string) => {
        if (!filePath.endsWith('.md')) return
        try {
          ;(database as any).deleteFileByPath?.(filePath)
        } catch (e) {}
      })
      .on('addDir', () => {})
      .on('unlinkDir', () => {})
      .on('error', (error: any) => { console.warn('[Watcher] error', error) })

    return true
  }
}