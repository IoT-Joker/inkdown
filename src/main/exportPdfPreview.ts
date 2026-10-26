import { BrowserWindow, session, webContents, type Session, type WebFrameMain } from 'electron'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExportPreviewPage } from '../shared/exportOptions'

const PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'
const activePdfs = new Set<string>()
const MAX_PAGES = 12
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
let rasterSession: Session | undefined

interface PdfPreviewDocument {
  hash: string
  generation: number
  pdf?: Buffer
  before: Promise<void>
  dir?: string
  url?: string
  win?: BrowserWindow
  frame?: WebFrameMain
  pageCount: number
  ready?: Promise<void>
  disposed: boolean
  cancelled: Promise<never>
  cancel: (error: Error) => void
  cleanup?: Promise<void>
  pages: Map<number, { result: ExportPreviewPage; bytes: number }>
  imageBytes: number
  pending: Map<number, Promise<ExportPreviewPage>>
}

let current: PdfPreviewDocument | undefined
let generation = 0
let paintQueue: Promise<void> = Promise.resolve()
let cleanupTail: Promise<void> = Promise.resolve()
let idleTimer: ReturnType<typeof setTimeout> | undefined

function getRasterSession(): Session {
  if (rasterSession) return rasterSession
  // Electron 33 cannot initialize its component PDF extension in an in-memory
  // partition. Use a separate persistent partition, with cache/network disabled.
  const isolated = session.fromPartition('persist:inkdown-export-pdf-raster', { cache: false })
  isolated.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, ({ url }, callback) => {
    const withoutHash = url.split('#')[0]
    const allowed = activePdfs.has(withoutHash) || url.startsWith(PDF_VIEWER) || url.startsWith('chrome://resources/')
    callback({ cancel: !allowed })
  })
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.on('will-download', (event) => event.preventDefault())
  rasterSession = isolated
  return isolated
}

async function bounded<T>(operation: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function ensureCurrent(doc: PdfPreviewDocument): void {
  if (doc.disposed || current !== doc || generation !== doc.generation) throw new Error('PDF preview released or cancelled')
}

async function active<T>(doc: PdfPreviewDocument, operation: Promise<T>): Promise<T> {
  const result = await Promise.race([operation, doc.cancelled])
  ensureCurrent(doc)
  return result
}

function disposeDocument(doc: PdfPreviewDocument): Promise<void> {
  if (doc.cleanup) return doc.cleanup
  doc.disposed = true
  doc.cancel(new Error('PDF preview released or cancelled'))
  if (doc.url) activePdfs.delete(doc.url)
  if (doc.win && !doc.win.isDestroyed()) doc.win.destroy()
  doc.pdf = undefined
  doc.pages.clear()
  doc.imageBytes = 0
  doc.pending.clear()
  doc.cleanup = (async () => {
    // Initialization may still be creating its temp directory. It checks the
    // generation after each await, so no viewer can appear after this release.
    await doc.ready?.catch(() => {})
    if (doc.dir) await rm(doc.dir, { recursive: true, force: true }).catch(() => {})
  })()
  return doc.cleanup
}

/** Invalidate immediately; resolve only after the retained file/window are gone. */
export function releasePdfPreview(): Promise<void> {
  generation++
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = undefined
  const previous = current
  current = undefined
  if (previous) cleanupTail = Promise.all([cleanupTail, disposeDocument(previous)]).then(() => {})
  return cleanupTail
}

function touch(doc: PdfPreviewDocument): void {
  if (current !== doc || doc.disposed) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (current === doc) void releasePdfPreview().catch(() => {})
  }, 120000)
  idleTimer.unref?.()
}

async function initialize(doc: PdfPreviewDocument): Promise<void> {
  await doc.before
  ensureCurrent(doc)
  doc.dir = await mkdtemp(join(tmpdir(), 'inkdown-pdf-preview-'))
  ensureCurrent(doc)
  const source = join(doc.dir, 'preview.pdf')
  await writeFile(source, doc.pdf!)
  ensureCurrent(doc)
  doc.pdf = undefined
  doc.url = pathToFileURL(source).href
  activePdfs.add(doc.url)
  doc.win = new BrowserWindow({
    show: false, width: 1180, height: 1500, useContentSize: true,
    webPreferences: {
      session: getRasterSession(), sandbox: true, contextIsolation: true,
      nodeIntegration: false, plugins: true, backgroundThrottling: false
    }
  })
  const printer = doc.win
  printer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  printer.webContents.on('will-navigate', (event) => event.preventDefault())
  printer.webContents.setAudioMuted(true)
  printer.webContents.setZoomFactor(1)
  await active(doc, printer.loadURL(doc.url))
  for (;;) {
    ensureCurrent(doc)
    if (printer.isDestroyed()) throw new Error('PDF preview window was closed')
    const frame = printer.webContents.mainFrame.framesInSubtree.find((candidate) => candidate.url.startsWith(PDF_VIEWER))
    if (frame) {
      const state = await active(doc, frame.executeJavaScript(`(() => {
        const viewer = document.querySelector('pdf-viewer');
        return { ready: viewer?.loadProgress_ === 100 && viewer?.loadState_ === 'success',
          failed: viewer?.loadState_ === 'failed' || viewer?.showPasswordDialog_,
          count: viewer?.docLength_ || viewer?.documentDimensions?.pageDimensions?.length || 0 };
      })()`)) as { ready: boolean; failed: boolean; count: number }
      if (state.failed) throw new Error('PDF preview could not load this document')
      if (state.ready && Number.isSafeInteger(state.count) && state.count > 0) {
        doc.frame = frame
        doc.pageCount = state.count
        webContents.fromFrame(frame)?.setBackgroundThrottling(false)
        return
      }
    }
    await active(doc, delay(75))
  }
}

function cachedPage(doc: PdfPreviewDocument, page: number): ExportPreviewPage | undefined {
  const entry = doc.pages.get(page)
  if (!entry) return undefined
  doc.pages.delete(page)
  doc.pages.set(page, entry)
  return { ...entry.result }
}

function cachePage(doc: PdfPreviewDocument, result: ExportPreviewPage): void {
  ensureCurrent(doc)
  const bytes = Buffer.byteLength(result.image, 'utf8')
  if (bytes > MAX_IMAGE_BYTES) return
  doc.pages.set(result.page, { result, bytes })
  doc.imageBytes += bytes
  while (doc.pages.size > MAX_PAGES || doc.imageBytes > MAX_IMAGE_BYTES) {
    const oldest = doc.pages.keys().next().value!
    doc.imageBytes -= doc.pages.get(oldest)!.bytes
    doc.pages.delete(oldest)
  }
}

async function paintPage(doc: PdfPreviewDocument, requested: number): Promise<ExportPreviewPage> {
  ensureCurrent(doc)
  if (!doc.ready) doc.ready = initialize(doc)
  await active(doc, doc.ready)
  const page = Math.min(requested, doc.pageCount)
  const cached = cachedPage(doc, page)
  if (cached) return cached
  const rect = await active(doc, doc.frame!.executeJavaScript(`(async () => {
    const viewer = document.querySelector('pdf-viewer');
    const viewport = viewer.viewport_;
    viewport.setSmoothScrolling(false);
    viewport.fitToPage({ page: ${page - 1} });
    viewport.goToPage(${page - 1});
    await viewer.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const page = viewport.getPageScreenRect(${page - 1});
    const main = viewer.shadowRoot.querySelector('#main').getBoundingClientRect();
    return { x: main.left + page.x, y: main.top + page.y, width: page.width, height: page.height };
  })()`)) as { x: number; y: number; width: number; height: number }
  const printer = doc.win!
  const [width, height] = printer.getContentSize()
  const x = Math.max(0, Math.ceil(rect.x))
  const y = Math.max(0, Math.ceil(rect.y))
  const clip = { x, y, width: Math.min(Math.floor(rect.width), width - x), height: Math.min(Math.floor(rect.height), height - y) }
  if (Object.values(clip).some((number) => !Number.isFinite(number)) || clip.width < 1 || clip.height < 1) throw new Error('PDF preview returned invalid page bounds')
  await active(doc, printer.webContents.capturePage(clip, { stayHidden: true, stayAwake: true }))
  await active(doc, delay(150))
  const image = await active(doc, printer.webContents.capturePage(clip, { stayHidden: true, stayAwake: true }))
  if (image.isEmpty()) throw new Error('PDF preview produced an empty page image')
  const result = { image: image.toDataURL(), pageCount: doc.pageCount, page }
  cachePage(doc, result)
  return { ...result }
}

/** One content-addressed viewer; painting is serialized and duplicate requests join. */
export async function renderPdfPreviewPage(input: unknown, requestedPage: unknown): Promise<ExportPreviewPage> {
  if (!ArrayBuffer.isView(input) || !(input instanceof Uint8Array) || input.byteLength < 5 || input.byteLength > 50 * 1024 * 1024) {
    throw new Error('PDF preview requires PDF bytes (up to 50 MiB)')
  }
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Invalid PDF preview data')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const requested = typeof requestedPage === 'number' && Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1
  if (!current || current.hash !== hash || current.win?.isDestroyed()) {
    const before = releasePdfPreview()
    let cancel!: (error: Error) => void
    const cancelled = new Promise<never>((_resolve, reject) => { cancel = reject })
    void cancelled.catch(() => {})
    current = { hash, generation, pdf: Buffer.from(bytes), before, pageCount: 0, disposed: false,
      cancelled, cancel, pages: new Map(), imageBytes: 0, pending: new Map() }
  }
  const doc = current
  touch(doc)
  const key = doc.pageCount ? Math.min(requested, doc.pageCount) : requested
  const cached = cachedPage(doc, key)
  if (cached) return cached
  const pending = doc.pending.get(key)
  if (pending) return pending
  const work = paintQueue.then(async () => {
    try {
      ensureCurrent(doc)
      return await bounded(paintPage(doc, requested), 30000, 'PDF page preview timed out')
    } catch (error) {
      // Preserve the initiating failure (especially a timeout) for every waiter.
      doc.cancel(error instanceof Error ? error : new Error(String(error)))
      if (current === doc) await releasePdfPreview()
      else await disposeDocument(doc)
      throw error
    }
  })
  paintQueue = work.then(() => {}, () => {})
  const result = Promise.race([work, doc.cancelled])
  doc.pending.set(key, result)
  void result.then(() => { doc.pending.delete(key); touch(doc) }, () => { doc.pending.delete(key) })
  return result
}
