import { promises as fsp } from 'node:fs'
import { join, extname, relative } from 'node:path'

/**
 * 全库搜索（纯 Node，零依赖）。
 *
 * 不引入 ripgrep 之类的原生依赖，代价是速度；
 * 对数千篇 Markdown 文档量级足够用，且打包体积与构建复杂度不受影响。
 *
 * 设计要点：
 * - 递归遍历时跳过隐藏目录、node_modules 等
 * - 单文件超过 MAX_FILE_BYTES 跳过，避免读入巨大文件
 * - 结果带行号与列号，便于定位；每文件最多保留若干命中，避免单文件刷屏
 */

/** Markdown 扩展名（与文件树保持一致）。 */
const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx', '.txt'])

/** 跳过的目录名。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'out',
  'release',
  'build',
  'coverage',
  '.next',
  '.cache'
])

/** 单文件大小上限（2 MB）。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024

/** 每个文件最多返回的命中数。 */
const MAX_HITS_PER_FILE = 20

export interface SearchHit {
  /** 文件绝对路径 */
  filePath: string
  /** 相对搜索根目录的路径，用于展示 */
  relativePath: string
  /** 行号（从 1 开始） */
  line: number
  /** 列号（从 1 开始） */
  column: number
  /** 该行内容（截断） */
  lineText: string
  /** 命中片段在行内的起始位置（用于高亮） */
  matchStart: number
  /** 命中片段长度 */
  matchLength: number
}

export interface SearchResult {
  hits: SearchHit[]
  /** 扫描的文件数 */
  filesScanned: number
  /** 命中过的文件数 */
  filesMatched: number
  /** 是否因为达到上限而截断 */
  truncated: boolean
}

export interface SearchOptions {
  /** 关键词 */
  query: string
  /** 是否区分大小写 */
  isCaseSensitive?: boolean
  /** 是否全词匹配 */
  isWholeWord?: boolean
  /** 是否正则 */
  isRegexp?: boolean
  /** 结果总数上限 */
  maxResults?: number
}

/** 转义正则元字符。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 依据选项构造匹配正则；非法正则返回 null。 */
function buildRegExp(opts: SearchOptions): RegExp | null {
  if (!opts.query) return null
  let pattern = opts.isRegexp ? opts.query : escapeRegExp(opts.query)
  if (opts.isWholeWord) pattern = `\\b${pattern}\\b`
  try {
    return new RegExp(pattern, opts.isCaseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

/** 递归收集目录下的 Markdown 文件。 */
async function collectMarkdownFiles(dir: string, out: string[], depth = 0): Promise<void> {
  // 限制递归深度，避免符号链接成环或超深目录
  if (depth > 12) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectMarkdownFiles(full, out, depth + 1)
    } else if (MARKDOWN_EXT.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
}

/**
 * 在指定目录下搜索所有 Markdown 文件。
 * 返回结果按文件路径与行号排序，便于阅读。
 */
export async function searchInFolder(rootDir: string, opts: SearchOptions): Promise<SearchResult> {
  const empty: SearchResult = { hits: [], filesScanned: 0, filesMatched: 0, truncated: false }
  const regexp = buildRegExp(opts)
  if (!regexp) return empty

  const maxResults = opts.maxResults ?? 500

  const files: string[] = []
  await collectMarkdownFiles(rootDir, files)

  const hits: SearchHit[] = []
  let filesMatched = 0
  let truncated = false

  for (const filePath of files) {
    if (hits.length >= maxResults) {
      truncated = true
      break
    }

    let stat: import('node:fs').Stats
    try {
      stat = await fsp.stat(filePath)
    } catch {
      continue
    }
    if (stat.size > MAX_FILE_BYTES) continue

    let content: string
    try {
      content = await fsp.readFile(filePath, 'utf8')
    } catch {
      continue
    }

    const lines = content.split(/\r?\n/)
    let perFile = 0
    let matchedThisFile = false

    for (let i = 0; i < lines.length; i++) {
      if (perFile >= MAX_HITS_PER_FILE) break
      const line = lines[i]
      regexp.lastIndex = 0
      let m: RegExpExecArray | null
      let first = true
      while ((m = regexp.exec(line)) !== null) {
        // 防止零宽匹配导致死循环
        if (m[0].length === 0) {
          regexp.lastIndex += 1
          continue
        }
        // 同一行只取第一处，避免重复行刷屏
        if (!first) break
        first = false
        matchedThisFile = true
        hits.push({
          filePath,
          relativePath: relative(rootDir, filePath).split('\\').join('/'),
          line: i + 1,
          column: m.index + 1,
          lineText: line.length > 200 ? line.slice(0, 200) + '…' : line,
          matchStart: m.index,
          matchLength: m[0].length
        })
        perFile += 1
        if (hits.length >= maxResults) {
          truncated = true
          break
        }
      }
      if (hits.length >= maxResults) break
    }

    if (matchedThisFile) filesMatched += 1
  }

  hits.sort((a, b) =>
    a.relativePath === b.relativePath
      ? a.line - b.line
      : a.relativePath.localeCompare(b.relativePath)
  )

  return { hits, filesScanned: files.length, filesMatched, truncated }
}
