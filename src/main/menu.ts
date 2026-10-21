import { Menu, type MenuItemConstructorOptions } from 'electron'
import { getMainWindow } from './window'
import { t } from './locale'

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
  const template: MenuItemConstructorOptions[] = [
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.file.new'), accelerator: 'CmdOrCtrl+N', click: cmd('file:new') },
        { label: t('menu.file.open'), accelerator: 'CmdOrCtrl+O', click: cmd('file:open') },
        {
          label: t('menu.file.openFolder'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: cmd('file:openFolder')
        },
        { type: 'separator' },
        { label: t('menu.file.save'), accelerator: 'CmdOrCtrl+S', click: cmd('file:save') },
        {
          label: t('menu.file.saveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: cmd('file:saveAs')
        },
        { type: 'separator' },
        { label: t('menu.file.closeTab'), accelerator: 'CmdOrCtrl+W', click: cmd('file:closeTab') },
        { type: 'separator' },
        { label: t('menu.file.exportHtml'), click: cmd('file:exportHtml') },
        { label: t('menu.file.exportPdf'), click: cmd('file:exportPdf') },
        { label: t('menu.file.exportDocx'), click: cmd('file:exportDocx') },
        { type: 'separator' },
        {
          label: t('menu.file.preferences'),
          accelerator: 'CmdOrCtrl+,',
          click: cmd('app:preferences')
        },
        { type: 'separator' },
        { role: 'quit', label: t('menu.file.quit') }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { label: t('menu.edit.undo'), accelerator: 'CmdOrCtrl+Z', click: cmd('edit:undo') },
        { label: t('menu.edit.redo'), accelerator: 'CmdOrCtrl+Shift+Z', click: cmd('edit:redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.edit.cut') },
        { role: 'copy', label: t('menu.edit.copy') },
        { role: 'paste', label: t('menu.edit.paste') },
        {
          label: t('menu.edit.pastePlain'),
          accelerator: 'CmdOrCtrl+Shift+V',
          click: cmd('edit:pastePlain')
        },
        { type: 'separator' },
        { label: t('menu.edit.copyMarkdown'), click: cmd('edit:copyMarkdown') },
        { label: t('menu.edit.copyHtml'), click: cmd('edit:copyHtml') },
        { type: 'separator' },
        { role: 'selectAll', label: t('menu.edit.selectAll') },
        { type: 'separator' },
        { label: t('menu.edit.find'), accelerator: 'CmdOrCtrl+F', click: cmd('edit:find') },
        { label: t('menu.edit.replace'), accelerator: 'CmdOrCtrl+H', click: cmd('edit:replace') },
        {
          label: t('search.folder'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click: cmd('edit:findInFolder')
        }
      ]
    },
    {
      label: t('menu.paragraph'),
      submenu: [
        { label: t('menu.paragraph.h1'), accelerator: 'CmdOrCtrl+1', click: cmd('paragraph:h1') },
        { label: t('menu.paragraph.h2'), accelerator: 'CmdOrCtrl+2', click: cmd('paragraph:h2') },
        { label: t('menu.paragraph.h3'), accelerator: 'CmdOrCtrl+3', click: cmd('paragraph:h3') },
        { label: t('menu.paragraph.h4'), accelerator: 'CmdOrCtrl+4', click: cmd('paragraph:h4') },
        { label: t('menu.paragraph.h5'), accelerator: 'CmdOrCtrl+5', click: cmd('paragraph:h5') },
        { label: t('menu.paragraph.h6'), accelerator: 'CmdOrCtrl+6', click: cmd('paragraph:h6') },
        { label: t('menu.paragraph.p'), accelerator: 'CmdOrCtrl+0', click: cmd('paragraph:p') },
        { type: 'separator' },
        {
          label: t('menu.paragraph.ul'),
          accelerator: 'CmdOrCtrl+Shift+8',
          click: cmd('paragraph:ul')
        },
        {
          label: t('menu.paragraph.ol'),
          accelerator: 'CmdOrCtrl+Shift+7',
          click: cmd('paragraph:ol')
        },
        {
          label: t('menu.paragraph.task'),
          accelerator: 'CmdOrCtrl+Shift+9',
          click: cmd('paragraph:task')
        },
        { type: 'separator' },
        {
          label: t('menu.paragraph.quote'),
          accelerator: 'CmdOrCtrl+Shift+Q',
          click: cmd('paragraph:quote')
        },
        {
          label: t('menu.paragraph.code'),
          accelerator: 'CmdOrCtrl+Shift+K',
          click: cmd('paragraph:code')
        },
        {
          label: t('menu.paragraph.math'),
          accelerator: 'CmdOrCtrl+Shift+M',
          click: cmd('paragraph:math')
        },
        { label: t('menu.paragraph.table'), click: cmd('paragraph:table') },
        { label: t('menu.paragraph.hr'), click: cmd('paragraph:hr') },
        { label: t('menu.paragraph.frontMatter'), click: cmd('paragraph:frontMatter') }
      ]
    },
    {
      label: t('menu.format'),
      submenu: [
        { label: t('menu.format.strong'), accelerator: 'CmdOrCtrl+B', click: cmd('format:strong') },
        { label: t('menu.format.emphasis'), accelerator: 'CmdOrCtrl+I', click: cmd('format:emphasis') },
        { label: t('menu.format.underline'), accelerator: 'CmdOrCtrl+U', click: cmd('format:underline') },
        { label: t('menu.format.strike'), accelerator: 'Alt+Shift+5', click: cmd('format:strike') },
        {
          label: t('menu.format.inlineCode'),
          accelerator: 'CmdOrCtrl+Shift+`',
          click: cmd('format:inlineCode')
        },
        { label: t('menu.format.highlight'), accelerator: 'CmdOrCtrl+Shift+H', click: cmd('format:highlight') },
        { label: t('menu.format.inlineMath'), accelerator: 'CmdOrCtrl+Shift+E', click: cmd('format:inlineMath') },
        { type: 'separator' },
        { label: t('menu.format.link'), accelerator: 'CmdOrCtrl+L', click: cmd('format:link') },
        { label: t('menu.format.image'), accelerator: 'CmdOrCtrl+Shift+I', click: cmd('format:image') },
        { label: t('menu.format.clear'), accelerator: 'CmdOrCtrl+\\', click: cmd('format:clear') }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        {
          label: t('menu.view.toggleSidebar'),
          accelerator: 'CmdOrCtrl+Shift+L',
          click: cmd('view:toggleSidebar')
        },
        {
          label: t('menu.view.toggleOutline'),
          accelerator: 'CmdOrCtrl+Shift+1',
          click: cmd('view:toggleOutline')
        },
        { type: 'separator' },
        {
          label: t('palette.title'),
          accelerator: 'CmdOrCtrl+Shift+P',
          click: cmd('app:commandPalette')
        },
        {
          label: t('menu.view.toggleSource'),
          accelerator: 'CmdOrCtrl+/',
          click: cmd('view:toggleSource')
        },
        { label: t('view.splitPreview'), click: cmd('view:toggleSplit') },
        { label: t('menu.view.toggleFocus'), accelerator: 'F8', click: cmd('view:toggleFocus') },
        {
          label: t('menu.view.toggleTypewriter'),
          accelerator: 'F9',
          click: cmd('view:toggleTypewriter')
        },
        { type: 'separator' },
        { label: t('menu.view.toggleTheme'), click: cmd('view:toggleTheme') },
        { label: t('menu.view.zoomIn'), accelerator: 'CmdOrCtrl+=', click: cmd('view:zoomIn') },
        { label: t('menu.view.zoomOut'), accelerator: 'CmdOrCtrl+-', click: cmd('view:zoomOut') },
        {
          label: t('menu.view.zoomReset'),
          accelerator: 'CmdOrCtrl+Shift+0',
          click: cmd('view:zoomReset')
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.view.fullscreen') },
        { label: t('menu.view.devtools'), accelerator: 'F12', click: cmd('view:devtools') }
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.help.shortcuts'),
          accelerator: 'CmdOrCtrl+Shift+/',
          click: cmd('help:shortcuts')
        },
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
