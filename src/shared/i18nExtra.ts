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

/* ------------------------------ 分栏预览 ------------------------------ */

const splitView: Record<LocaleCode, Dict> = {
  'zh-CN': {
    'view.splitPreview': '分栏预览',
    'view.splitHint': '左侧编辑源码，右侧实时预览',
    'view.splitPreviewHead': '预览',
    'view.splitSyncScroll': '跟随光标',
    'view.splitSyncScrollHint': '左侧光标移动时，右侧滚动到对应位置并居中',
    'view.splitHighlightBlock': '标出位置',
    'view.splitHighlightBlockHint': '用虚线框标出光标所在的块'
  },
  en: {
    'view.splitPreview': 'Split Preview',
    'view.splitHint': 'Edit source on the left, preview on the right',
    'view.splitPreviewHead': 'Preview',
    'view.splitSyncScroll': 'Follow cursor',
    'view.splitSyncScrollHint': 'Scroll the preview to keep the cursor block centered',
    'view.splitHighlightBlock': 'Mark block',
    'view.splitHighlightBlockHint': 'Outline the block under the cursor with a dashed box'
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

const EXTRA: Record<LocaleCode, Dict[]> = {
  'zh-CN': [folderSearch['zh-CN'], splitView['zh-CN'], drag['zh-CN'], palette['zh-CN']],
  en: [folderSearch.en, splitView.en, drag.en, palette.en]
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
