/**
 * 应用文案词典（主进程与渲染层共用）。
 *
 * 只覆盖应用自身的界面文案；编辑器内部的提示（表格菜单、图片工具等）
 * 由 muya 内核的语言包负责，见 muyaSetup.ts 的 locale 选项。
 *
 * 约定：
 * - key 用「区域.语义」的点分形式，便于查找
 * - 占位符用 {name}，由 t() 做替换
 */

export type LocaleCode = 'zh-CN' | 'en'

export interface Dict {
  [key: string]: string
}

const zhCN: Dict = {
  // 应用
  'app.name': 'Inkdown',
  'app.tagline': '专注写作的 Markdown 编辑器',

  // 菜单
  'menu.file': '文件',
  'menu.file.new': '新建',
  'menu.file.open': '打开文件…',
  'menu.file.openFolder': '打开文件夹…',
  'menu.file.save': '保存',
  'menu.file.saveAs': '另存为…',
  'menu.file.closeTab': '关闭标签页',
  'menu.file.exportHtml': '导出为 HTML…',
  'menu.file.exportPdf': '导出为 PDF…',
  'menu.file.preferences': '偏好设置…',
  'menu.file.quit': '退出',
  'menu.file.recent': '最近打开',
  'menu.file.recentEmpty': '（无）',
  'menu.file.clearRecent': '清除最近记录',
  'menu.file.moveTo': '移动到…',
  'menu.file.rename': '重命名…',

  'menu.edit.duplicate': '复制段落',
  'menu.edit.insertParagraphBefore': '在下方插入段落',
  'menu.edit.deleteParagraph': '删除段落',
  'menu.edit.lineEnding': '换行符',
  'menu.edit.lineEndingLf': 'LF（Unix）',
  'menu.edit.lineEndingCrlf': 'CRLF（Windows）',
  'menu.edit.insertTime': '插入当前时间',

  'menu.edit': '编辑',
  'menu.edit.undo': '撤销',
  'menu.edit.redo': '重做',
  'menu.edit.cut': '剪切',
  'menu.edit.copy': '复制',
  'menu.edit.paste': '粘贴',
  'menu.edit.pastePlain': '粘贴为纯文本',
  'menu.edit.copyMarkdown': '复制为 Markdown',
  'menu.edit.copyHtml': '复制为 HTML',
  'menu.edit.selectAll': '全选',
  'menu.edit.find': '查找',
  'menu.edit.replace': '替换',

  'menu.paragraph': '段落',
  'menu.paragraph.h1': '标题 1',
  'menu.paragraph.h2': '标题 2',
  'menu.paragraph.h3': '标题 3',
  'menu.paragraph.h4': '标题 4',
  'menu.paragraph.h5': '标题 5',
  'menu.paragraph.h6': '标题 6',
  'menu.paragraph.p': '正文',
  'menu.paragraph.ul': '无序列表',
  'menu.paragraph.ol': '有序列表',
  'menu.paragraph.task': '任务列表',
  'menu.paragraph.quote': '引用',
  'menu.paragraph.code': '代码块',
  'menu.paragraph.math': '数学公式块',
  'menu.paragraph.table': '表格',
  'menu.paragraph.hr': '分隔线',
  'menu.paragraph.frontMatter': 'YAML 前言',

  'menu.format': '格式',
  'menu.format.strong': '加粗',
  'menu.format.emphasis': '斜体',
  'menu.format.underline': '下划线',
  'menu.format.strike': '删除线',
  'menu.format.inlineCode': '行内代码',
  'menu.format.highlight': '高亮',
  'menu.format.inlineMath': '行内公式',
  'menu.format.link': '超链接',
  'menu.format.image': '图片',
  'menu.format.clear': '清除格式',

  'menu.view': '视图',
  'menu.view.toggleSidebar': '显示/隐藏侧边栏',
  'menu.view.toggleOutline': '显示/隐藏大纲',
  'menu.view.toggleSource': '源码模式',
  'menu.view.toggleFocus': '专注模式',
  'menu.view.toggleTypewriter': '打字机模式',
  'menu.view.toggleTheme': '切换主题',
  'menu.view.zoomIn': '放大',
  'menu.view.zoomOut': '缩小',
  'menu.view.zoomReset': '重置缩放',
  'menu.view.fullscreen': '全屏',
  'menu.view.devtools': '开发者工具',

  // 标签栏
  'tab.close': '关闭标签页',
  'tab.new': '新建标签页',
  'tab.settings': '偏好设置',
  'tab.unsaved': '（未保存）',
  'tab.untitled': '未命名',

  // 侧边栏
  'sidebar.files': '文件',
  'sidebar.outline': '大纲',
  'sidebar.hide': '隐藏侧边栏',
  'sidebar.show': '显示侧边栏',
  'sidebar.openFolder': '打开文件夹',
  'sidebar.refresh': '刷新',
  'sidebar.filter': '按名称筛选…',
  'sidebar.noFolder': '尚未打开文件夹',
  'sidebar.noHeadings': '当前文档没有标题',

  // 文件树右键菜单
  'tree.newFile': '新建文件',
  'tree.newFolder': '新建文件夹',
  'tree.rename': '重命名',
  'tree.reveal': '在资源管理器中显示',
  'tree.delete': '删除',
  'tree.promptFileName': '新建文件名（含 .md）',
  'tree.promptFolderName': '新建文件夹名',
  'tree.confirmDelete': '确定删除「{name}」？文件会移入系统回收站。',
  'tree.errCreate': '创建失败：{msg}',
  'tree.errRename': '重命名失败：{msg}',
  'tree.errDelete': '删除失败：{msg}',

  // 状态栏
  'status.notSavedToFile': '未保存到文件',
  'status.unsaved': '未保存',
  'status.saved': '已保存',
  'status.line': '行 {n}',
  'status.lineNone': '行 —',
  'status.source': '源码',
  'status.wysiwyg': '所见即所得',
  'status.focus': '专注',
  'status.typewriter': '打字机',
  'status.switchTheme': '切换主题（当前 {theme}）',
  'status.words': '{n} 字',

  // 主题
  'theme.light': '浅色',
  'theme.dark': '深色',
  'theme.github': 'GitHub',
  'theme.newsprint': '报刊',
  'theme.night': '夜间',

  // 查找替换
  'find.placeholder': '查找',
  'find.replacePlaceholder': '替换为',
  'find.caseSensitive': '区分大小写',
  'find.wholeWord': '全词匹配',
  'find.regexp': '正则表达式',
  'find.wholeWordShort': '全词',
  'find.previous': '上一个',
  'find.next': '下一个',
  'find.replace': '替换',
  'find.replaceAll': '全部替换',
  'find.count': '{n} 处',
  'find.close': '关闭',

  // 偏好设置
  'pref.title': '偏好设置',
  'pref.appearance': '外观',
  'pref.theme': '主题',
  'pref.fontSize': '编辑器字号',
  'pref.lineHeight': '行高',
  'pref.codeFontSize': '代码字号',
  'pref.wrapCode': '代码折行',
  'pref.language': '界面语言',
  'pref.file': '文件',
  'pref.autoSave': '自动保存',
  'pref.autoSaveHint': '停止输入后自动写盘（仅对已保存过的文件生效）',
  'pref.autoSaveDelay': '自动保存延迟',
  'pref.bulletMarker': '默认列表标记',
  'pref.bulletDash': '- 短横线',
  'pref.bulletStar': '* 星号',
  'pref.bulletPlus': '+ 加号',
  'pref.editing': '编辑',
  'pref.autoPairBracket': '自动配对括号',
  'pref.autoPairMarkdown': '自动配对 Markdown 语法',
  'pref.autoPairQuote': '自动配对引号',
  'pref.tabSize': 'Tab 宽度',
  'pref.listIndentation': '列表缩进',
  'pref.looseListItem': '松散列表项',
  'pref.markdown': 'Markdown 语法',
  'pref.frontMatter': 'YAML 前言',
  'pref.superSubScript': '上下标',
  'pref.footnote': '脚注',
  'pref.texMathDollars': '行内公式（$…$）',
  'pref.texMathGfm': 'GFM 公式（```math）',
  'pref.codeLineNumbers': '代码块行号',
  'pref.githubAlerts': 'GitHub 告警块',
  'pref.multilineBlockquote': '多行引用',
  'pref.view': '视图',
  'pref.spellcheck': '拼写检查',
  'pref.hideQuickInsert': '隐藏快捷插入提示',
  'pref.hideLinkPopup': '隐藏链接浮层',
  'pref.disableHtml': '禁用 HTML',
  'pref.cancel': '取消',
  'pref.save': '保存',

  // 编辑器空状态
  'editor.emptyHint': '按 Ctrl+N 新建文档，或 Ctrl+O 打开文件',
  'editor.dropHint': '松开以打开 Markdown 文档',

  // 提示
  'notice.externalChange': '「{name}」已在应用之外被修改',
  'notice.reload': '重新载入',
  'notice.ignore': '忽略',
  'notice.onlyMarkdown': '仅支持拖入 Markdown 文档（.md / .markdown / .txt）',

  // 对话框
  'dialog.allFiles': '所有文件',
  'dialog.saveChanges': '是否保存改动？',
  'dialog.saveChangesDetail': '「{name}」有未保存的改动。',
  'dialog.save': '保存',
  'dialog.dontSave': '不保存',
  'dialog.cancel': '取消',

  // 语言
  'lang.zh-CN': '简体中文',
  'lang.en': 'English'
}

const en: Dict = {
  'app.name': 'Inkdown',
  'app.tagline': 'A focused Markdown editor',

  'menu.file': 'File',
  'menu.file.new': 'New',
  'menu.file.open': 'Open File…',
  'menu.file.openFolder': 'Open Folder…',
  'menu.file.save': 'Save',
  'menu.file.saveAs': 'Save As…',
  'menu.file.closeTab': 'Close Tab',
  'menu.file.exportHtml': 'Export as HTML…',
  'menu.file.exportPdf': 'Export as PDF…',
  'menu.file.preferences': 'Preferences…',
  'menu.file.quit': 'Quit',
  'menu.file.recent': 'Open Recent',
  'menu.file.recentEmpty': '(none)',
  'menu.file.clearRecent': 'Clear Recent',
  'menu.file.moveTo': 'Move To…',
  'menu.file.rename': 'Rename…',

  'menu.edit.duplicate': 'Duplicate Paragraph',
  'menu.edit.insertParagraphBefore': 'Insert Paragraph Below',
  'menu.edit.deleteParagraph': 'Delete Paragraph',
  'menu.edit.lineEnding': 'Line Ending',
  'menu.edit.lineEndingLf': 'LF (Unix)',
  'menu.edit.lineEndingCrlf': 'CRLF (Windows)',
  'menu.edit.insertTime': 'Insert Current Time',

  'menu.edit': 'Edit',
  'menu.edit.undo': 'Undo',
  'menu.edit.redo': 'Redo',
  'menu.edit.cut': 'Cut',
  'menu.edit.copy': 'Copy',
  'menu.edit.paste': 'Paste',
  'menu.edit.pastePlain': 'Paste as Plain Text',
  'menu.edit.copyMarkdown': 'Copy as Markdown',
  'menu.edit.copyHtml': 'Copy as HTML',
  'menu.edit.selectAll': 'Select All',
  'menu.edit.find': 'Find',
  'menu.edit.replace': 'Replace',

  'menu.paragraph': 'Paragraph',
  'menu.paragraph.h1': 'Heading 1',
  'menu.paragraph.h2': 'Heading 2',
  'menu.paragraph.h3': 'Heading 3',
  'menu.paragraph.h4': 'Heading 4',
  'menu.paragraph.h5': 'Heading 5',
  'menu.paragraph.h6': 'Heading 6',
  'menu.paragraph.p': 'Paragraph',
  'menu.paragraph.ul': 'Bullet List',
  'menu.paragraph.ol': 'Ordered List',
  'menu.paragraph.task': 'Task List',
  'menu.paragraph.quote': 'Blockquote',
  'menu.paragraph.code': 'Code Block',
  'menu.paragraph.math': 'Math Block',
  'menu.paragraph.table': 'Table',
  'menu.paragraph.hr': 'Horizontal Rule',
  'menu.paragraph.frontMatter': 'YAML Front Matter',

  'menu.format': 'Format',
  'menu.format.strong': 'Bold',
  'menu.format.emphasis': 'Italic',
  'menu.format.underline': 'Underline',
  'menu.format.strike': 'Strikethrough',
  'menu.format.inlineCode': 'Inline Code',
  'menu.format.highlight': 'Highlight',
  'menu.format.inlineMath': 'Inline Math',
  'menu.format.link': 'Hyperlink',
  'menu.format.image': 'Image',
  'menu.format.clear': 'Clear Format',

  'menu.view': 'View',
  'menu.view.toggleSidebar': 'Toggle Sidebar',
  'menu.view.toggleOutline': 'Toggle Outline',
  'menu.view.toggleSource': 'Source Code Mode',
  'menu.view.toggleFocus': 'Focus Mode',
  'menu.view.toggleTypewriter': 'Typewriter Mode',
  'menu.view.toggleTheme': 'Switch Theme',
  'menu.view.zoomIn': 'Zoom In',
  'menu.view.zoomOut': 'Zoom Out',
  'menu.view.zoomReset': 'Reset Zoom',
  'menu.view.fullscreen': 'Full Screen',
  'menu.view.devtools': 'Developer Tools',

  'tab.close': 'Close Tab',
  'tab.new': 'New Tab',
  'tab.settings': 'Preferences',
  'tab.unsaved': ' (unsaved)',
  'tab.untitled': 'Untitled',

  'sidebar.files': 'Files',
  'sidebar.outline': 'Outline',
  'sidebar.hide': 'Hide Sidebar',
  'sidebar.show': 'Show Sidebar',
  'sidebar.openFolder': 'Open Folder',
  'sidebar.refresh': 'Refresh',
  'sidebar.filter': 'Filter by name…',
  'sidebar.noFolder': 'No folder opened',
  'sidebar.noHeadings': 'This document has no headings',

  'tree.newFile': 'New File',
  'tree.newFolder': 'New Folder',
  'tree.rename': 'Rename',
  'tree.reveal': 'Reveal in File Explorer',
  'tree.delete': 'Delete',
  'tree.promptFileName': 'New file name (include .md)',
  'tree.promptFolderName': 'New folder name',
  'tree.confirmDelete': 'Delete "{name}"? The file will be moved to the recycle bin.',
  'tree.errCreate': 'Create failed: {msg}',
  'tree.errRename': 'Rename failed: {msg}',
  'tree.errDelete': 'Delete failed: {msg}',

  'status.notSavedToFile': 'Not saved to a file',
  'status.unsaved': 'Unsaved',
  'status.saved': 'Saved',
  'status.line': 'Line {n}',
  'status.lineNone': 'Line —',
  'status.source': 'Source',
  'status.wysiwyg': 'WYSIWYG',
  'status.focus': 'Focus',
  'status.typewriter': 'Typewriter',
  'status.switchTheme': 'Switch theme (current: {theme})',
  'status.words': '{n} words',

  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.github': 'GitHub',
  'theme.newsprint': 'Newsprint',
  'theme.night': 'Night',

  'find.placeholder': 'Find',
  'find.replacePlaceholder': 'Replace with',
  'find.caseSensitive': 'Match case',
  'find.wholeWord': 'Match whole word',
  'find.regexp': 'Regular expression',
  'find.wholeWordShort': 'Word',
  'find.previous': 'Previous',
  'find.next': 'Next',
  'find.replace': 'Replace',
  'find.replaceAll': 'Replace All',
  'find.count': '{n} matches',
  'find.close': 'Close',

  'pref.title': 'Preferences',
  'pref.appearance': 'Appearance',
  'pref.theme': 'Theme',
  'pref.fontSize': 'Editor font size',
  'pref.lineHeight': 'Line height',
  'pref.codeFontSize': 'Code font size',
  'pref.wrapCode': 'Wrap code blocks',
  'pref.language': 'Interface language',
  'pref.file': 'File',
  'pref.autoSave': 'Auto save',
  'pref.autoSaveHint': 'Write to disk after you stop typing (only for files already saved)',
  'pref.autoSaveDelay': 'Auto save delay',
  'pref.bulletMarker': 'Default bullet marker',
  'pref.bulletDash': '- Dash',
  'pref.bulletStar': '* Asterisk',
  'pref.bulletPlus': '+ Plus',
  'pref.editing': 'Editing',
  'pref.autoPairBracket': 'Auto pair brackets',
  'pref.autoPairMarkdown': 'Auto pair Markdown syntax',
  'pref.autoPairQuote': 'Auto pair quotes',
  'pref.tabSize': 'Tab size',
  'pref.listIndentation': 'List indentation',
  'pref.looseListItem': 'Loose list items',
  'pref.markdown': 'Markdown Syntax',
  'pref.frontMatter': 'YAML front matter',
  'pref.superSubScript': 'Super / subscript',
  'pref.footnote': 'Footnotes',
  'pref.texMathDollars': 'Inline math ($…$)',
  'pref.texMathGfm': 'GFM math (```math)',
  'pref.codeLineNumbers': 'Code block line numbers',
  'pref.githubAlerts': 'GitHub alerts',
  'pref.multilineBlockquote': 'Multiline blockquote',
  'pref.view': 'View',
  'pref.spellcheck': 'Spell check',
  'pref.hideQuickInsert': 'Hide quick-insert hint',
  'pref.hideLinkPopup': 'Hide link popup',
  'pref.disableHtml': 'Disable HTML',
  'pref.cancel': 'Cancel',
  'pref.save': 'Save',

  'editor.emptyHint': 'Press Ctrl+N for a new document, or Ctrl+O to open a file',
  'editor.dropHint': 'Drop to open Markdown documents',

  'notice.externalChange': '"{name}" was modified outside the app',
  'notice.reload': 'Reload',
  'notice.ignore': 'Ignore',
  'notice.onlyMarkdown': 'Only Markdown documents can be dropped (.md / .markdown / .txt)',

  'dialog.allFiles': 'All Files',
  'dialog.saveChanges': 'Save changes?',
  'dialog.saveChangesDetail': '"{name}" has unsaved changes.',
  'dialog.save': 'Save',
  'dialog.dontSave': "Don't Save",
  'dialog.cancel': 'Cancel',

  'lang.zh-CN': '简体中文',
  'lang.en': 'English'
}

export const DICTS: Record<LocaleCode, Dict> = { 'zh-CN': zhCN, en }

export const LOCALE_LABELS: Record<LocaleCode, string> = {
  'zh-CN': '简体中文',
  en: 'English'
}

/**
 * 翻译函数。缺失的 key 回退到中文，再回退到 key 本身，
 * 这样漏翻不会导致界面出现空白。
 */
export function translate(locale: LocaleCode, key: string, params?: Record<string, string | number>): string {
  const dict = DICTS[locale] ?? DICTS['zh-CN']
  let text = dict[key] ?? DICTS['zh-CN'][key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return text
}
