import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

export async function runRecoveryTest(win: BrowserWindow, dir: string, phase: string): Promise<boolean> {
  const file = join(dir, 'draft.md')
  for (let i = 0; i < 100; i++) {
    if (await win.webContents.executeJavaScript('!!window.__inkdownApp?.activeTab()').catch(() => false)) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (phase === 'prepare') {
    await fs.writeFile(file, 'disk original')
    await win.webContents.executeJavaScript(`(async () => {
      const app = window.__inkdownApp
      app.settings().autoSave = false
      await app.openPath(${JSON.stringify(file)})
      window.__inkdownLoad('named recovered edits')
      await window.__inkdownCommands.execute('file:new')
      window.__inkdownLoad('untitled recovered edits')
      app.persistRecovery()
      app.persistSession()
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    console.log('[recovery] OK: prepared named and untitled drafts')
    return true
  }
  let result: { named: boolean; untitled: boolean; conflict: boolean } | undefined
  for (let i = 0; i < 80; i++) {
    result = await win.webContents.executeJavaScript(`(() => {
      const tabs = window.__inkdownApp.tabs()
      const named = tabs.find((tab) => tab.content === 'named recovered edits')
      return {
        named: !!named,
        untitled: tabs.some((tab) => !tab.filePath && tab.content === 'untitled recovered edits'),
        conflict: !!named && named.filePath === null && tabs.some((tab) => tab.content === 'external edit')
      }
    })()`)
    if (result?.named && result.untitled) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const disk = await fs.readFile(file, 'utf8')
  const ok = !!result?.named && !!result.untitled &&
    (phase === 'conflict' ? result.conflict && disk === 'external edit' : disk === 'disk original')
  console.log(`[recovery] ${ok ? 'PASS' : 'FAIL'}: ${phase} ${JSON.stringify(result)}`)
  return ok
}
