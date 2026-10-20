import {
  CodeBlockLanguageSelector,
  EmojiSelector,
  FootnoteTool,
  ImageEditTool,
  ImageResizeBar,
  ImageToolBar,
  InlineFormatToolbar,
  LinkTools,
  Muya,
  ParagraphFrontButton,
  ParagraphFrontMenu,
  ParagraphQuickInsertMenu,
  PreviewToolBar,
  TableColumnToolbar,
  TableDragBar,
  TableRowColumMenu,
  zhCN,
  type IMuyaOptions,
  type ITocItem
} from '@muyajs/core'
import { settings } from '../store'

let pluginsRegistered = false

/** 当前文档路径，供图片落盘时确定 assets 目录。 */
let currentDocPath: string | null = null

export function setDocPathForImages(p: string | null): void {
  currentDocPath = p
}

/**
 * 注册 muya 的 UI 插件。muya 要求插件在创建实例前全局注册一次。
 * 这里的 imageAction / clipboardText / getPathForFile 钩子把图片与剪贴板
 * 能力接到主进程，形成 Typora 那样的本地文件工作流。
 */
export function registerMuyaPlugins(): void {
  if (pluginsRegistered) return
  pluginsRegistered = true

  Muya.use(EmojiSelector)
  Muya.use(FootnoteTool)
  Muya.use(InlineFormatToolbar)
  Muya.use(ImageToolBar)
  Muya.use(ImageResizeBar)
  Muya.use(ImageEditTool, {
    imagePathPicker: async () => {
      const files = await window.typra.openFileDialog()
      return files[0]?.filePath ?? ''
    },
    imageAction: async (state: { src: string; alt: string; title: string }) => {
      const docPath = currentDocPath
      // 粘贴的位图以 data: URL 传入，落盘到 assets 目录并改写成相对路径
      if (state.src.startsWith('data:')) {
        return window.typra.saveImage(docPath, state.alt || 'image.png', state.src)
      }
      return window.typra.copyImage(docPath, state.src)
    }
  })
  Muya.use(CodeBlockLanguageSelector)
  Muya.use(LinkTools, {
    jumpClick: (linkInfo: { href?: string } | null) => {
      const href = linkInfo?.href
      if (href && /^https?:\/\//.test(href)) window.typra.openExternal(href)
    }
  })
  Muya.use(ParagraphFrontButton)
  Muya.use(ParagraphFrontMenu)
  Muya.use(ParagraphQuickInsertMenu)
  Muya.use(TableColumnToolbar)
  Muya.use(TableDragBar)
  Muya.use(TableRowColumMenu)
  Muya.use(PreviewToolBar)
}

/** 由设置对象构造 muya 的选项，保证两边字段保持一致。 */
export function buildMuyaOptions(extra: Partial<IMuyaOptions> = {}): Partial<IMuyaOptions> {
  return {
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    editorFontFamily: settings.editorFontFamily || undefined,
    codeFontSize: settings.codeFontSize,
    codeFontFamily: settings.codeFontFamily || undefined,
    wrapCodeBlocks: settings.wrapCodeBlocks,
    focusMode: false,
    trimUnnecessaryCodeBlockEmptyLines: true,
    preferLooseListItem: settings.preferLooseListItem,
    autoPairBracket: settings.autoPairBracket,
    autoPairMarkdownSyntax: settings.autoPairMarkdownSyntax,
    autoPairQuote: settings.autoPairQuote,
    bulletListMarker: settings.bulletListMarker,
    orderListDelimiter: settings.orderListDelimiter,
    tabSize: settings.tabSize,
    codeBlockLineNumbers: settings.codeBlockLineNumbers,
    listIndentation: settings.listIndentation,
    frontMatter: settings.frontMatter,
    frontmatterType: '-',
    mermaidTheme: settings.mermaidTheme,
    vegaTheme: settings.vegaTheme,
    plantumlServer: settings.plantumlServer,
    sequenceTheme: settings.sequenceTheme,
    hideQuickInsertHint: settings.hideQuickInsertHint,
    hideLinkPopup: settings.hideLinkPopup,
    autoCheck: settings.autoCheck,
    spellcheckEnabled: settings.spellcheckEnabled,
    spellcheckHideMarks: settings.spellcheckHideMarks,
    superSubScript: settings.superSubScript,
    footnote: settings.footnote,
    texMathDollars: settings.texMathDollars,
    texMathGfm: settings.texMathGfm,
    texMathSingleBackslash: settings.texMathSingleBackslash,
    texMathDoubleBackslash: settings.texMathDoubleBackslash,
    highlightSyntax: settings.highlightSyntax,
    inlineDiff: true,
    multilineBlockquote: settings.multilineBlockquote,
    githubAlerts: settings.githubAlerts,
    softNewlineAsSpace: settings.softNewlineAsSpace,
    autoMoveCheckedToEnd: settings.autoMoveCheckedToEnd,
    disableHtml: settings.disableHtml,
    locale: zhCN,
    clipboardText: () => window.typra.readClipboardText(),
    fetchLinkHtml: async (url: string) => {
      try {
        const res = await fetch(url)
        const text = await res.text()
        return text.slice(0, 200_000)
      } catch {
        return ''
      }
    },
    getPathForFile: (file: File) => window.typra.getPathForFile(file),
    ...extra
  }
}

export { Muya, zhCN }
export type { ITocItem }
