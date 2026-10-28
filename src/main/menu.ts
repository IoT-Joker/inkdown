import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { getMainWindow } from './window'
import { t } from './locale'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 快捷键覆盖由渲染层维护，主进程重建菜单时读取同一份 JSON。 */
let shortcutOverrides: Record<string, string> = {}

/**
 * 原生菜单只负责显示快捷键，不注册键盘加速器。
 *
 * 所有实际键盘分发统一交给渲染层的 installShortcutDispatcher()，否则
 * Windows 原生菜单与 window keydown 会各执行一次，新建标签等命令会重复。
 * 菜单点击仍通过 click 回调走同一套命令中心。
 */
const DISPLAY_ONLY_SHORTCUT = { registerAccelerator: false } as const

export function setShortcutOverrides(overrides: Record<string, string>): void {
  shortcutOverrides = { ...overrides }
  buildAppMenu()
}

function shortcutFile(): string {
  return join(app.getPath('userData'), 'inkdown-shortcuts.json')
}

/** 主进程启动时加载已保存的快捷键；损坏文件回退到默认快捷键。 */
export function loadShortcutOverrides(): void {
  try {
    const parsed = JSON.parse(readFileSync(shortcutFile(), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const valid: Record<string, string> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0 && value.length <= 80) valid[id] = value
    }
    shortcutOverrides = valid
  } catch {
    /* 首次启动或文件损坏时使用默认快捷键。 */
  }
}

/** 取某个命令当前生效的快捷键。 */
function shortcutFor(defaultAccelerator: string, commandId: string): string {
  return shortcutOverrides[commandId] ?? defaultAccelerator
}

/** 菜单项统一把命令发给渲染进程，由渲染层的命令中心执行。 */
function cmd(id: string) {
  return () => getMainWindow()?.webContents.send('menu:command', id)
}

/**
 * 应用菜单。参考 Typora 的菜单分组（文件 / 编辑 / 段落 / 格式 / 视图），
 * 并让每个条目带快捷键，快捷键也通过同一命令通道执行，避免两套逻辑。
 *
 * 所有文案走 t()，切换语言后调用 buildAppMenu() 重建即可生效。
 */
export function buildAppMenu(): void {
  const withAccelerator = (
    label: string,
    accelerator: string,
    commandId: string
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    ...DISPLAY_ONLY_SHORTCUT,
    click: cmd(commandId)
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: t('menu.file'),
      submenu: [
        withAccelerator(t('menu.file.new'), shortcutFor('CmdOrCtrl+N', 'file:new'), 'file:new'),
        withAccelerator(t('menu.file.open'), shortcutFor('CmdOrCtrl+O', 'file:open'), 'file:open'),
        withAccelerator(
          t('menu.file.openFolder'),
          shortcutFor('CmdOrCtrl+Shift+O', 'file:openFolder'),
          'file:openFolder'
        ),
        { type: 'separator' },
        withAccelerator(t('menu.file.save'), shortcutFor('CmdOrCtrl+S', 'file:save'), 'file:save'),
        withAccelerator(
          t('menu.file.saveAs'),
          shortcutFor('CmdOrCtrl+Shift+S', 'file:saveAs'),
          'file:saveAs'
        ),
        { type: 'separator' },
        withAccelerator(
          t('menu.file.closeTab'),
          shortcutFor('CmdOrCtrl+W', 'file:closeTab'),
          'file:closeTab'
        ),
        { type: 'separator' },
        { label: t('menu.file.exportHtml'), click: cmd('file:exportHtml') },
        { label: t('menu.file.exportPdf'), click: cmd('file:exportPdf') },
        { label: t('menu.file.exportDocx'), click: cmd('file:exportDocx') },
        { type: 'separator' },
        {
          label: t('menu.file.print'),
          accelerator: 'CmdOrCtrl+P',
          click: cmd('file:print')
        },
        { type: 'separator' },
        withAccelerator(
          t('menu.file.preferences'),
          shortcutFor('CmdOrCtrl+,', 'app:preferences'),
          'app:preferences'
        ),
        { type: 'separator' },
        { role: 'quit', label: t('menu.file.quit') }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        withAccelerator(t('menu.edit.undo'), shortcutFor('CmdOrCtrl+Z', 'edit:undo'), 'edit:undo'),
        withAccelerator(
          t('menu.edit.redo'),
          shortcutFor('CmdOrCtrl+Shift+Z', 'edit:redo'),
          'edit:redo'
        ),
        { type: 'separator' },
        { role: 'cut', label: t('menu.edit.cut') },
        { role: 'copy', label: t('menu.edit.copy') },
        { role: 'paste', label: t('menu.edit.paste') },
        withAccelerator(
          t('menu.edit.pastePlain'),
          shortcutFor('CmdOrCtrl+Shift+V', 'edit:pastePlain'),
          'edit:pastePlain'
        ),
        { type: 'separator' },
        { label: t('menu.edit.copyMarkdown'), click: cmd('edit:copyMarkdown') },
        { label: t('menu.edit.copyHtml'), click: cmd('edit:copyHtml') },
        { type: 'separator' },
        { role: 'selectAll', label: t('menu.edit.selectAll') },
        { type: 'separator' },
        withAccelerator(t('menu.edit.find'), shortcutFor('CmdOrCtrl+F', 'edit:find'), 'edit:find'),
        withAccelerator(
          t('menu.edit.replace'),
          shortcutFor('CmdOrCtrl+H', 'edit:replace'),
          'edit:replace'
        ),
        withAccelerator(
          t('search.folder'),
          shortcutFor('CmdOrCtrl+Shift+F', 'edit:findInFolder'),
          'edit:findInFolder'
        )
      ]
    },
    {
      label: t('menu.paragraph'),
      submenu: [
        withAccelerator(t('menu.paragraph.h1'), shortcutFor('CmdOrCtrl+1', 'paragraph:h1'), 'paragraph:h1'),
        withAccelerator(t('menu.paragraph.h2'), shortcutFor('CmdOrCtrl+2', 'paragraph:h2'), 'paragraph:h2'),
        withAccelerator(t('menu.paragraph.h3'), shortcutFor('CmdOrCtrl+3', 'paragraph:h3'), 'paragraph:h3'),
        withAccelerator(t('menu.paragraph.h4'), shortcutFor('CmdOrCtrl+4', 'paragraph:h4'), 'paragraph:h4'),
        withAccelerator(t('menu.paragraph.h5'), shortcutFor('CmdOrCtrl+5', 'paragraph:h5'), 'paragraph:h5'),
        withAccelerator(t('menu.paragraph.h6'), shortcutFor('CmdOrCtrl+6', 'paragraph:h6'), 'paragraph:h6'),
        withAccelerator(t('menu.paragraph.p'), shortcutFor('CmdOrCtrl+0', 'paragraph:p'), 'paragraph:p'),
        { type: 'separator' },
        withAccelerator(
          t('menu.paragraph.ul'),
          shortcutFor('CmdOrCtrl+Shift+8', 'paragraph:ul'),
          'paragraph:ul'
        ),
        withAccelerator(
          t('menu.paragraph.ol'),
          shortcutFor('CmdOrCtrl+Shift+7', 'paragraph:ol'),
          'paragraph:ol'
        ),
        withAccelerator(
          t('menu.paragraph.task'),
          shortcutFor('CmdOrCtrl+Shift+9', 'paragraph:task'),
          'paragraph:task'
        ),
        { type: 'separator' },
        withAccelerator(
          t('menu.paragraph.quote'),
          shortcutFor('CmdOrCtrl+Shift+Q', 'paragraph:quote'),
          'paragraph:quote'
        ),
        withAccelerator(
          t('menu.paragraph.code'),
          shortcutFor('CmdOrCtrl+Shift+K', 'paragraph:code'),
          'paragraph:code'
        ),
        withAccelerator(
          t('menu.paragraph.math'),
          shortcutFor('CmdOrCtrl+Shift+M', 'paragraph:math'),
          'paragraph:math'
        ),
        { label: t('menu.paragraph.table'), click: cmd('paragraph:table') },
        { label: t('menu.paragraph.hr'), click: cmd('paragraph:hr') },
        { label: t('menu.paragraph.frontMatter'), click: cmd('paragraph:frontMatter') }
      ]
    },
    {
      label: t('menu.format'),
      submenu: [
        withAccelerator(t('menu.format.strong'), shortcutFor('CmdOrCtrl+B', 'format:strong'), 'format:strong'),
        withAccelerator(t('menu.format.emphasis'), shortcutFor('CmdOrCtrl+I', 'format:emphasis'), 'format:emphasis'),
        withAccelerator(t('menu.format.underline'), shortcutFor('CmdOrCtrl+U', 'format:underline'), 'format:underline'),
        withAccelerator(t('menu.format.strike'), shortcutFor('Alt+Shift+5', 'format:strike'), 'format:strike'),
        withAccelerator(
          t('menu.format.inlineCode'),
          shortcutFor('CmdOrCtrl+Shift+`', 'format:inlineCode'),
          'format:inlineCode'
        ),
        withAccelerator(
          t('menu.format.highlight'),
          shortcutFor('CmdOrCtrl+Shift+H', 'format:highlight'),
          'format:highlight'
        ),
        withAccelerator(
          t('menu.format.inlineMath'),
          shortcutFor('CmdOrCtrl+Shift+E', 'format:inlineMath'),
          'format:inlineMath'
        ),
        { type: 'separator' },
        withAccelerator(t('menu.format.link'), shortcutFor('CmdOrCtrl+L', 'format:link'), 'format:link'),
        withAccelerator(t('menu.format.image'), shortcutFor('CmdOrCtrl+Shift+I', 'format:image'), 'format:image'),
        withAccelerator(t('menu.format.clear'), shortcutFor('CmdOrCtrl+\\', 'format:clear'), 'format:clear')
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        withAccelerator(
          t('menu.view.toggleSidebar'),
          shortcutFor('CmdOrCtrl+Shift+L', 'view:toggleSidebar'),
          'view:toggleSidebar'
        ),
        withAccelerator(
          t('menu.view.toggleOutline'),
          shortcutFor('CmdOrCtrl+Shift+1', 'view:toggleOutline'),
          'view:toggleOutline'
        ),
        { type: 'separator' },
        withAccelerator(
          t('palette.title'),
          shortcutFor('CmdOrCtrl+Shift+P', 'app:commandPalette'),
          'app:commandPalette'
        ),
        withAccelerator(
          t('menu.view.toggleSource'),
          shortcutFor('CmdOrCtrl+/', 'view:toggleSource'),
          'view:toggleSource'
        ),
        { label: t('view.splitPreview'), click: cmd('view:toggleSplit') },
        withAccelerator(
          t('menu.view.toggleReading'),
          shortcutFor('Ctrl+R', 'view:toggleReading'),
          'view:toggleReading'
        ),
        withAccelerator(t('menu.view.toggleFocus'), shortcutFor('F8', 'view:toggleFocus'), 'view:toggleFocus'),
        withAccelerator(
          t('menu.view.toggleTypewriter'),
          shortcutFor('F9', 'view:toggleTypewriter'),
          'view:toggleTypewriter'
        ),
        { type: 'separator' },
        { label: t('menu.view.toggleTheme'), click: cmd('view:toggleTheme') },
        withAccelerator(t('menu.view.zoomIn'), shortcutFor('CmdOrCtrl+=', 'view:zoomIn'), 'view:zoomIn'),
        withAccelerator(t('menu.view.zoomOut'), shortcutFor('CmdOrCtrl+-', 'view:zoomOut'), 'view:zoomOut'),
        withAccelerator(
          t('menu.view.zoomReset'),
          shortcutFor('CmdOrCtrl+Shift+0', 'view:zoomReset'),
          'view:zoomReset'
        ),
        { type: 'separator' },
        withAccelerator(t('menu.view.fullscreen'), shortcutFor('F11', 'view:fullscreen'), 'view:fullscreen'),
        withAccelerator(t('menu.view.devtools'), shortcutFor('F12', 'view:devtools'), 'view:devtools')
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        withAccelerator(
          t('menu.help.shortcuts'),
          shortcutFor('CmdOrCtrl+Shift+/', 'help:shortcuts'),
          'help:shortcuts'
        ),
        { label: t('menu.help.repo'), click: cmd('help:repo') },
        { label: t('menu.help.feedback'), click: cmd('help:feedback') },
        { type: 'separator' },
        { label: t('menu.help.update'), click: cmd('help:checkUpdate') },
        { label: t('menu.help.about'), click: cmd('help:about') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
