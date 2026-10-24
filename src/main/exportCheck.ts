import { nativeImage, type BrowserWindow } from 'electron'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { htmlToVisualDocx } from './exportVisualDocx'
import { withExportWindow, writeHtmlPdf } from './exportWindow'
import { createServer } from 'node:http'
import { inflateRawSync } from 'node:zlib'

export async function runExportCheck(win: BrowserWindow): Promise<boolean> {
  for (let i = 0; i < 80; i++) {
    if (await win.webContents.executeJavaScript('!!window.inkdown && !!window.__inkdownApp').catch(() => false)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const dir = await mkdtemp(join(tmpdir(), 'inkdown-export-check-'))
  const pdf = join(dir, 'local-image.pdf')
  const src = pathToFileURL(join(process.cwd(), 'build/icon.png')).href
  const html = `<html><body><h1>Local image regression</h1><p>Editable text</p><img src="${src}"><script>document.body.innerHTML='SCRIPT EXECUTED'</script></body></html>`
  const saved = await win.webContents.executeJavaScript(`window.inkdown.exportPdf(${JSON.stringify(pdf)}, ${JSON.stringify(html)})`)
  const bytes = saved ? await readFile(pdf) : Buffer.alloc(0)
  const width = nativeImage.createFromPath(join(process.cwd(), 'build/icon.png')).getSize().width
  let pass = new RegExp('/Width ' + width + '\\b').test(bytes.toString('latin1'))
  console.log('[export-check]', pass ? 'PASS' : 'FAIL', 'PDF embeds the actual local icon, not a broken-image placeholder:', pdf)
  const scriptsBlocked = await withExportWindow('<script>window.INKDOWN_EXPORT_UNSAFE=1</script>' + html, (printer) => printer.webContents.executeJavaScript('window.INKDOWN_EXPORT_UNSAFE !== 1'))
  pass &&= scriptsBlocked
  console.log('[export-check]', scriptsBlocked ? 'PASS' : 'FAIL', 'Document scripts remain blocked, including before the HTML head')
  const word = await htmlToVisualDocx(html, 'Visual export check')
  const wordHasImages = word.includes(Buffer.from('word/media/'))
  await writeFile(join(dir, 'visual.docx'), word)
  pass &&= wordHasImages
  console.log('[export-check]', wordHasImages ? 'PASS' : 'FAIL', 'Word contains embedded image parts:', join(dir, 'visual.docx'))
  const protectedPath = join(dir, 'protected.pdf')
  await writeFile(protectedPath, 'existing PDF')
  let rejected = false
  try { await writeHtmlPdf(protectedPath, '<img src="file:///Z:/does-not-exist/inkdown.png">') } catch { rejected = true }
  const unchanged = (await readFile(protectedPath, 'utf8')) === 'existing PDF'
  pass &&= rejected && unchanged
  console.log('[export-check]', rejected && unchanged ? 'PASS' : 'FAIL', 'Missing images report failure and preserve the existing PDF')
  const icon = await readFile(join(process.cwd(), 'build/icon.png'))
  const delayedServer = createServer((_request, response) => {
    setTimeout(() => { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(icon) }, 1200)
  })
  await new Promise<void>((resolve) => delayedServer.listen(0, '127.0.0.1', resolve))
  try {
    const address = delayedServer.address()
    if (!address || typeof address === 'string') throw new Error('Image test server failed')
    const delayedPdf = join(dir, 'delayed-image.pdf')
    await writeHtmlPdf(delayedPdf, `<img src="http://127.0.0.1:${address.port}/slow.png">`)
    const loaded = new RegExp('/Width ' + width + '\\b').test((await readFile(delayedPdf)).toString('latin1'))
    pass &&= loaded
    console.log('[export-check]', loaded ? 'PASS' : 'FAIL', 'An image loading beyond the old 600ms delay is included')
  } finally {
    await new Promise<void>((resolve) => delayedServer.close(() => resolve()))
  }
  const navigationHtml = '<article class="markdown-body"><h1 id="chapter">Chapter</h1><ul><li><a href="#repeat">First repeated title</a><ul><li><a href="#%E4%B8%AD%E6%96%87">Chinese child</a></li></ul></li><li><a href="#repeat-1">Second repeated title</a></li><li><a href="#formula">Complex heading</a></li></ul><h2 id="repeat">Repeated</h2><p>First target</p><h3 id="中文">中文</h3><p>Child target</p><h2 id="repeat-1">Repeated</h2><p>Second target</p><h2 id="formula">Formula <span class="katex">x = 1</span></h2></article>'
  const navigationPdf = join(dir, 'bookmarks.pdf')
  await writeHtmlPdf(navigationPdf, navigationHtml)
  const pdfHasOutline = (await readFile(navigationPdf)).includes(Buffer.from('/Outlines'))
  pass &&= pdfHasOutline
  console.log('[export-check]', pdfHasOutline ? 'PASS' : 'FAIL', 'PDF exports document-outline bookmarks:', navigationPdf)
  const navigationWord = await htmlToVisualDocx(navigationHtml, 'Bookmark regression')
  await writeFile(join(dir, 'bookmarks.docx'), navigationWord)
  const documentXml = zipText(navigationWord, 'word/document.xml')
  const names = [...documentXml.matchAll(/<w:bookmarkStart\b[^>]*w:name="([^"]+)"/g)].map((match) => match[1])
  const anchors = [...documentXml.matchAll(/<w:hyperlink\b[^>]*w:anchor="([^"]+)"/g)].map((match) => match[1])
  const validWordNavigation = names.length === 5 && new Set(names).size === 5 && new Set(anchors).size === 4 && anchors.every((anchor) => names.includes(anchor))
  pass &&= validWordNavigation
  console.log('[export-check]', validWordNavigation ? 'PASS' : 'FAIL', 'Word bookmarks and TOC links handle duplicate headings and encoded Chinese anchors:', { names, anchors })
  const noHeading = await htmlToVisualDocx('<p>No headings</p>', 'Plain document')
  const plainHasNoBookmark = !zipText(noHeading, 'word/document.xml').includes('<w:bookmarkStart')
  pass &&= plainHasNoBookmark
  console.log('[export-check]', plainHasNoBookmark ? 'PASS' : 'FAIL', 'Documents without headings do not get fabricated bookmarks')
  const fixture = join(process.cwd(), 'examples/comprehensive-test.md')
  await win.webContents.executeJavaScript(`window.__inkdownApp.openPath(${JSON.stringify(fixture)})`)
  const fullHtml = await win.webContents.executeJavaScript('window.__inkdownExport.buildHtmlForCheck()') as string
  const fullPdf = join(dir, 'comprehensive-test-fixed.pdf')
  await writeHtmlPdf(fullPdf, fullHtml)
  const fullWord = await htmlToVisualDocx(fullHtml, 'Inkdown comprehensive test')
  await writeFile(join(dir, 'comprehensive-test-fixed.docx'), fullWord)
  console.log('[export-check] Review outputs:', dir)
  return pass
}

/** Read only our generated non-encrypted DOCX test archive. */
function zipText(buffer: Buffer, name: string): string {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('Invalid test DOCX archive')
  let cursor = buffer.readUInt32LE(end + 16)
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    const length = buffer.readUInt16LE(cursor + 28)
    const entryName = buffer.subarray(cursor + 46, cursor + 46 + length).toString('utf8')
    if (entryName === name) {
      const offset = buffer.readUInt32LE(cursor + 42)
      const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28)
      const bytes = buffer.subarray(start, start + buffer.readUInt32LE(cursor + 20))
      return (buffer.readUInt16LE(cursor + 10) === 8 ? inflateRawSync(bytes) : bytes).toString('utf8')
    }
    cursor += 46 + length + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32)
  }
  throw new Error('Missing test DOCX entry: ' + name)
}
