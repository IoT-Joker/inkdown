/**
 * 本批新增功能的文案。
 *
 * 主词典 src/shared/i18n.ts 由另一条并行工作流在修改，
 * 为避免冲突，这里把新功能的词条单独存放，并在导入时**自动合并**进主词典，
 * 因此无需改动 i18n.ts 本体。
 *
 * 只要在渲染层（useI18n.ts）与主进程（locale.ts）各导入一次本模块，
 * 合并就会生效。
 */

import { DICTS, type Dict, type LocaleCode } from './i18n'

/* ------------------------------ 全库搜索 ------------------------------ */

const folderSearch: Record<LocaleCode, Dict> = {
  'zh-CN': {
    'search.folder': '在文件夹中查找',
    'search.folderPlaceholder': '在打开的文件夹中搜索…',
    'search.folderScope': '搜索范围：{path}',
    'search.folderNoFolder': '请先打开一个文件夹',
    'search.folderSearching': '搜索中…',
    'search.folderSummary': '{files} 个文件中有 {hits} 处命中',
    'search.folderEmpty': '没有找到匹配内容',
    'search.folderTruncated': '结果过多，仅显示前 {max} 条',
    'search.folderOpen': '打开',
    'search.folderReveal': '在文件树中定位',
    'search.folderCaseSensitive': '区分大小写',
    'search.folderRegexp': '正则'
  },
  en: {
    'search.folder': 'Find in Folder',
    'search.folderPlaceholder': 'Search in the opened folder…',
    'search.folderScope': 'Scope: {path}',
    'search.folderNoFolder': 'Open a folder first',
    'search.folderSearching': 'Searching…',
    'search.folderSummary': '{hits} matches in {files} files',
    'search.folderEmpty': 'No matches found',
    'search.folderTruncated': 'Too many results, showing the first {max}',
    'search.folderOpen': 'Open',
    'search.folderReveal': 'Reveal in tree',
    'search.folderCaseSensitive': 'Match case',
    'search.folderRegexp': 'Regex'
  }
}

/* ------------------------------ 源码预览 ------------------------------ */

const splitView: Record<LocaleCode, Dict> = {
  'zh-CN': {
    'view.splitPreview': '源码预览',
    'view.splitHint': '左侧编辑 Markdown 源码，右侧实时预览',
    'view.splitPreviewHead': '实时预览',
    'view.splitSourceHead': 'Markdown 源码',
    'view.splitSourceMeta': 'UTF-8 · {eol}',
    'view.splitSourcePosition': '第 {line} / {lines} 行 · {chars} 字符',
    'view.splitSyncScroll': '跟随光标',
    'view.splitSyncScrollHint': '左侧光标移动时，右侧预览滚动到对应位置并居中',
    'view.splitHighlightBlock': '标出位置',
    'view.splitHighlightBlockHint': '在右侧预览中突出显示光标所在的块'
  },
  en: {
    'view.splitPreview': 'Source Preview',
    'view.splitHint': 'Edit Markdown on the left, preview live on the right',
    'view.splitPreviewHead': 'Live Preview',
    'view.splitSourceHead': 'Markdown Source',
    'view.splitSourceMeta': 'UTF-8 · {eol}',
    'view.splitSourcePosition': 'Ln {line} / {lines} · {chars} chars',
    'view.splitSyncScroll': 'Follow cursor',
    'view.splitSyncScrollHint': 'Scroll the preview on the right to keep the cursor block centered',
    'view.splitHighlightBlock': 'Mark block',
    'view.splitHighlightBlockHint': 'Highlight the cursor block in the preview on the right'
  }
}

/* ------------------------------ 正文右键菜单 ------------------------------ */

const contextMenu: Record<LocaleCode, Dict> = {
  'zh-CN': {
    'ctx.copyMarkdown': '复制为 Markdown',
    'ctx.copyHtml': '复制为 HTML',
    'ctx.pastePlain': '粘贴为纯文本',
    'ctx.insertImage': '插入图片…',
    'ctx.insertTable': '插入表格',
    'ctx.insertMath': '插入公式块',
    'ctx.insertCode': '插入代码块',
    'ctx.duplicate': '复制当前段落',
    'ctx.deleteParagraph': '删除当前段落',
    'ctx.find': '查找…'
  },
  en: {
    'ctx.copyMarkdown': 'Copy as Markdown',
    'ctx.copyHtml': 'Copy as HTML',
    'ctx.pastePlain': 'Paste as Plain Text',
    'ctx.insertImage': 'Insert Image…',
    'ctx.insertTable': 'Insert Table',
    'ctx.insertMath': 'Insert Math Block',
    'ctx.insertCode': 'Insert Code Block',
    'ctx.duplicate': 'Duplicate Paragraph',
    'ctx.deleteParagraph': 'Delete Paragraph',
    'ctx.find': 'Find…'
  }
}

/* ------------------------------ 拖拽 ------------------------------ */

const drag: Record<LocaleCode, Dict> = {
  'zh-CN': {
    'tab.dragHint': '拖动可调整标签顺序',
    'tree.dragHint': '拖动可移动文件，或拖到文件夹上移入',
    'tree.errMove': '移动失败：{msg}',
    'tree.errExists': '目标位置已存在「{name}」'
  },
  en: {
    'tab.dragHint': 'Drag to reorder tabs',
    'tree.dragHint': 'Drag to move a file, or drop onto a folder',
    'tree.errMove': 'Move failed: {msg}',
    'tree.errExists': '"{name}" already exists at the destination'
  }
}

/* ------------------------------ 命令面板 ------------------------------ */

const palette: Record<LocaleCode, Dict> = {
  'zh-CN': {
    'palette.title': '命令面板',
    'palette.placeholder': '输入命令名称…',
    'palette.empty': '没有匹配的命令',
    'palette.hint': '↑↓ 选择 · Enter 执行 · Esc 关闭'
  },
  en: {
    'palette.title': 'Command Palette',
    'palette.placeholder': 'Type a command name…',
    'palette.empty': 'No matching commands',
    'palette.hint': '↑↓ to select · Enter to run · Esc to close'
  }
}

/* ------------------------------ 合并 ------------------------------ */

/* ------------------------------ 悬浮球环形菜单 ------------------------------ */

const orbDict: Record<LocaleCode, Dict> = {
  'zh-CN': {
    'orb.title': '快速插入',
    'orb.hint': '悬停展开，拖动可移动',
    'orb.dragging': '拖动中 · 松开后移动位置',
    'orb.heading': '标题',
    'orb.text': '文字',
    'orb.structure': '结构',
    'orb.media': '媒体',
    'orb.h1': '一级标题',
    'orb.h2': '二级标题',
    'orb.h3': '三级标题',
    'orb.h4': '四级标题',
    'orb.h5': '五级标题',
    'orb.h6': '六级标题',
    'orb.list': '列表',
    'orb.ul': '无序列表',
    'orb.ol': '有序列表',
    'orb.task': '任务列表',
    'orb.nestedList': '嵌套列表',
    'orb.code': '代码',
    'orb.codeJs': 'JS 代码',
    'orb.codePy': 'Python',
    'orb.mermaid': 'Mermaid',
    'orb.plantuml': 'PlantUML',
    'orb.inlineDiffAdd': '新增标记',
    'orb.inlineDiffDel': '删除标记',
    'orb.math': '公式块',
    'orb.table': '表格',
    'orb.quote': '引用',
    'orb.hr': '分隔线',
    'orb.image': '图片',
    'orb.link': '链接',
    'orb.strong': '加粗',
    'orb.emphasis': '斜体',
    'orb.strike': '删除线',
    'orb.inlineCode': '行内代码',
    'orb.highlight': '高亮',
    'orb.inlineMath': '行内公式',
    'orb.superscript': '上标',
    'orb.subscript': '下标',
    'orb.underline': '下划线',
    'orb.kbd': '按键',
    'orb.frontmatter': 'Front Matter',
    'orb.frontmatterExists': '文档开头已经有 Front Matter',
    'orb.callout': '提示块',
    'orb.details': '折叠块',
    'orb.footnote': '脚注',
    'orb.toc': '目录',
    'orb.tocEmpty': '暂无标题',
    'orb.refLink': '引用式链接',
    'orb.htmlBlock': 'HTML 块',
    'orb.video': '视频',
    'orb.audio': '音频',
    'orb.timeGroup': '日期',
    'orb.time': '当前时间',
    'orb.date': '当前日期',
    'orb.weekday': '星期',
    'orb.advanced': '快捷操作',
    'orb.save': '保存文档',
    'orb.exportPdf': '导出 PDF',
    'orb.exportDocx': '导出 Word',
    'orb.find': '查找替换',
    'orb.theme': '切换主题',
    'orb.sidebar': '侧边栏'
  },
  en: {
    'orb.title': 'Quick insert',
    'orb.hint': 'Hover to open, drag to move',
    'orb.dragging': 'Dragging · release to move',
    'orb.heading': 'Heading',
    'orb.text': 'Text',
    'orb.structure': 'Structure',
    'orb.media': 'Media',
    'orb.h1': 'Heading 1',
    'orb.h2': 'Heading 2',
    'orb.h3': 'Heading 3',
    'orb.h4': 'Heading 4',
    'orb.h5': 'Heading 5',
    'orb.h6': 'Heading 6',
    'orb.list': 'List',
    'orb.ul': 'Bullet List',
    'orb.ol': 'Numbered List',
    'orb.task': 'Task List',
    'orb.nestedList': 'Nested List',
    'orb.code': 'Code',
    'orb.codeJs': 'JavaScript',
    'orb.codePy': 'Python',
    'orb.mermaid': 'Mermaid',
    'orb.plantuml': 'PlantUML',
    'orb.inlineDiffAdd': 'Addition Mark',
    'orb.inlineDiffDel': 'Deletion Mark',
    'orb.math': 'Math Block',
    'orb.table': 'Table',
    'orb.quote': 'Quote',
    'orb.hr': 'Divider',
    'orb.image': 'Image',
    'orb.link': 'Link',
    'orb.strong': 'Bold',
    'orb.emphasis': 'Italic',
    'orb.strike': 'Strike',
    'orb.inlineCode': 'Inline Code',
    'orb.highlight': 'Highlight',
    'orb.inlineMath': 'Inline Math',
    'orb.superscript': 'Superscript',
    'orb.subscript': 'Subscript',
    'orb.underline': 'Underline',
    'orb.kbd': 'Keyboard Key',
    'orb.frontmatter': 'Front Matter',
    'orb.frontmatterExists': 'Front matter already exists at the top',
    'orb.callout': 'Callout',
    'orb.details': 'Details',
    'orb.footnote': 'Footnote',
    'orb.toc': 'Table of Contents',
    'orb.tocEmpty': 'No headings',
    'orb.refLink': 'Reference Link',
    'orb.htmlBlock': 'HTML Block',
    'orb.video': 'Video',
    'orb.audio': 'Audio',
    'orb.timeGroup': 'Date & Time',
    'orb.time': 'Current Time',
    'orb.date': 'Current Date',
    'orb.weekday': 'Weekday',
    'orb.advanced': 'Actions',
    'orb.save': 'Save Document',
    'orb.exportPdf': 'Export PDF',
    'orb.exportDocx': 'Export Word',
    'orb.find': 'Find & Replace',
    'orb.theme': 'Switch Theme',
    'orb.sidebar': 'Sidebar'
  }
}

const fileSafety: Record<LocaleCode, Dict> = {
  'zh-CN': {
    'notice.saveFailed': '未能保存「{name}」：{error}',
    'notice.saveConflict': '文件已被其他程序修改，请先重新加载或另存为，避免覆盖外部改动。',
    'notice.recoveredDrafts': '已恢复 {count} 份未保存草稿，请确认后保存。',
    'notice.reloadDirty': '重新加载将放弃当前未保存的修改，是否继续？',
    'recovery.title': '{name}（恢复草稿）',
    'pref.orbOpacity': '圆盘不透明度',
    'pref.orbFontSize': '圆盘字号',
    'pref.orbAnimations': '圆盘展开动画'
  },
  en: {
    'notice.saveFailed': 'Could not save "{name}": {error}',
    'notice.saveConflict': 'The file changed outside Inkdown. Reload it or save a copy before overwriting external changes.',
    'notice.recoveredDrafts': 'Recovered {count} unsaved drafts. Review and save them.',
    'notice.reloadDirty': 'Reloading will discard unsaved changes. Continue?',
    'recovery.title': '{name} (Recovered)',
    'pref.orbOpacity': 'Palette opacity',
    'pref.orbFontSize': 'Palette font size',
    'pref.orbAnimations': 'Palette animation'
  }
}

const inlineUpdate: Record<LocaleCode, Dict> = {
  'zh-CN': {
    'update.inlineReady': '重启安装',
    'update.installFailed': '安装失败，请重试',
    'update.inlineCheckFailed': '检查失败，点击重试',
    'update.inlineActionFailed': '操作失败，请重试。',
    'update.devDownloadOnly': '开发版仅检查发布信息；请安装打包版后下载和安装更新。',
    'update.feedMissing': '未配置 GitHub 更新源。'
  },
  en: {
    'update.inlineReady': 'Restart to install',
    'update.installFailed': 'Installation failed; please retry',
    'update.inlineCheckFailed': 'Check failed, retry',
    'update.inlineActionFailed': 'Action failed. Please retry.',
    'update.devDownloadOnly': 'Development builds only check releases. Install a packaged build to download and install updates.',
    'update.feedMissing': 'No GitHub update feed is configured.'
  }
}

const reading: Record<LocaleCode, Dict> = {
  'zh-CN': { 'reading.linkUnavailable': '无法打开此文档链接。', 'reading.back': '返回', 'reading.copy': '复制选中文字', 'reading.selectAll': '全选正文', 'reading.notice': '阅读模式不可修改文档，请切换到源码或源码预览编辑。' },
  en: { 'reading.linkUnavailable': 'This document link could not be opened.', 'reading.back': 'Back', 'reading.copy': 'Copy selected text', 'reading.selectAll': 'Select all text', 'reading.notice': 'Reading mode protects the document. Switch to Source or Split preview to edit.' }
}

const EXTRA: Record<LocaleCode, Dict[]> = {
  'zh-CN': [
    reading['zh-CN'],
    inlineUpdate['zh-CN'],
    folderSearch['zh-CN'],
    splitView['zh-CN'],
    drag['zh-CN'],
    palette['zh-CN'],
    contextMenu['zh-CN'],
    orbDict['zh-CN'], fileSafety['zh-CN']
  ],
  en: [reading.en, inlineUpdate.en, folderSearch.en, splitView.en, drag.en, palette.en, contextMenu.en, orbDict.en, fileSafety.en]
}

let merged = false

/**
 * 把本模块的词条合并进主词典。
 * 幂等：重复调用只合并一次；已存在的 key 不覆盖（主词典优先）。
 */
export function mergeExtraDicts(): void {
  if (merged) return
  merged = true
  for (const locale of Object.keys(EXTRA) as LocaleCode[]) {
    const target = DICTS[locale]
    if (!target) continue
    for (const part of EXTRA[locale]) {
      for (const [k, v] of Object.entries(part)) {
        if (target[k] === undefined) target[k] = v
      }
    }
  }
}

// 导入即合并，调用方无需显式调用
mergeExtraDicts()
