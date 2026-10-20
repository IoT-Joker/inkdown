import { Menu, type MenuItemConstructorOptions } from 'electron'
import { getMainWindow } from './window'

/** 菜单项统一把命令发给渲染进程，由渲染层的命令中心执行。 */
function cmd(id: string) {
  return () => getMainWindow()?.webContents.send('menu:command', id)
}

/**
 * 应用菜单。参考 Typora 的菜单分组（文件 / 编辑 / 段落 / 格式 / 视图），
 * 并让每个条目带快捷键，快捷键也通过同一命令通道执行，避免两套逻辑。
 */
export function buildAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: cmd('file:new') },
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: cmd('file:open') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('file:openFolder') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: cmd('file:save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('file:saveAs') },
        { type: 'separator' },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: cmd('file:closeTab') },
        { type: 'separator' },
        { label: '导出为 HTML…', click: cmd('file:exportHtml') },
        { label: '导出为 PDF…', click: cmd('file:exportPdf') },
        { type: 'separator' },
        { label: '偏好设置…', accelerator: 'CmdOrCtrl+,', click: cmd('app:preferences') },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: cmd('edit:undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: cmd('edit:redo') },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { label: '粘贴为纯文本', accelerator: 'CmdOrCtrl+Shift+V', click: cmd('edit:pastePlain') },
        { type: 'separator' },
        { label: '复制为 Markdown', click: cmd('edit:copyMarkdown') },
        { label: '复制为 HTML', click: cmd('edit:copyHtml') },
        { type: 'separator' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: cmd('edit:find') },
        { label: '替换', accelerator: 'CmdOrCtrl+H', click: cmd('edit:replace') }
      ]
    },
    {
      label: '段落',
      submenu: [
        { label: '标题 1', accelerator: 'CmdOrCtrl+1', click: cmd('paragraph:h1') },
        { label: '标题 2', accelerator: 'CmdOrCtrl+2', click: cmd('paragraph:h2') },
        { label: '标题 3', accelerator: 'CmdOrCtrl+3', click: cmd('paragraph:h3') },
        { label: '标题 4', accelerator: 'CmdOrCtrl+4', click: cmd('paragraph:h4') },
        { label: '标题 5', accelerator: 'CmdOrCtrl+5', click: cmd('paragraph:h5') },
        { label: '标题 6', accelerator: 'CmdOrCtrl+6', click: cmd('paragraph:h6') },
        { label: '正文', accelerator: 'CmdOrCtrl+0', click: cmd('paragraph:p') },
        { type: 'separator' },
        { label: '无序列表', accelerator: 'CmdOrCtrl+Shift+8', click: cmd('paragraph:ul') },
        { label: '有序列表', accelerator: 'CmdOrCtrl+Shift+7', click: cmd('paragraph:ol') },
        { label: '任务列表', accelerator: 'CmdOrCtrl+Shift+9', click: cmd('paragraph:task') },
        { type: 'separator' },
        { label: '引用', accelerator: 'CmdOrCtrl+Shift+Q', click: cmd('paragraph:quote') },
        { label: '代码块', accelerator: 'CmdOrCtrl+Shift+K', click: cmd('paragraph:code') },
        { label: '数学公式块', accelerator: 'CmdOrCtrl+Shift+M', click: cmd('paragraph:math') },
        { label: '表格', click: cmd('paragraph:table') },
        { label: '分隔线', click: cmd('paragraph:hr') },
        { label: 'YAML 前言', click: cmd('paragraph:frontMatter') }
      ]
    },
    {
      label: '格式',
      submenu: [
        { label: '加粗', accelerator: 'CmdOrCtrl+B', click: cmd('format:strong') },
        { label: '斜体', accelerator: 'CmdOrCtrl+I', click: cmd('format:emphasis') },
        { label: '下划线', accelerator: 'CmdOrCtrl+U', click: cmd('format:underline') },
        { label: '删除线', accelerator: 'Alt+Shift+5', click: cmd('format:strike') },
        { label: '行内代码', accelerator: 'CmdOrCtrl+Shift+`', click: cmd('format:inlineCode') },
        { label: '高亮', accelerator: 'CmdOrCtrl+Shift+H', click: cmd('format:highlight') },
        { label: '行内公式', accelerator: 'CmdOrCtrl+Shift+E', click: cmd('format:inlineMath') },
        { type: 'separator' },
        { label: '超链接', accelerator: 'CmdOrCtrl+L', click: cmd('format:link') },
        { label: '图片', accelerator: 'CmdOrCtrl+Shift+I', click: cmd('format:image') },
        { label: '清除格式', accelerator: 'CmdOrCtrl+\\', click: cmd('format:clear') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '显示/隐藏侧边栏', accelerator: 'CmdOrCtrl+Shift+L', click: cmd('view:toggleSidebar') },
        { label: '显示/隐藏大纲', accelerator: 'CmdOrCtrl+Shift+1', click: cmd('view:toggleOutline') },
        { type: 'separator' },
        { label: '源码模式', accelerator: 'CmdOrCtrl+/', click: cmd('view:toggleSource') },
        { label: '专注模式', accelerator: 'F8', click: cmd('view:toggleFocus') },
        { label: '打字机模式', accelerator: 'F9', click: cmd('view:toggleTypewriter') },
        { type: 'separator' },
        { label: '切换主题', click: cmd('view:toggleTheme') },
        { label: '放大', accelerator: 'CmdOrCtrl+=', click: cmd('view:zoomIn') },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: cmd('view:zoomOut') },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+Shift+0', click: cmd('view:zoomReset') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { label: '开发者工具', accelerator: 'F12', click: cmd('view:devtools') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
