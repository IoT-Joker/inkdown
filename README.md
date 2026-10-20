# Typra2

一个模仿 [Typora](https://typora.io/) 的桌面 Markdown 编辑器，以 [marktext](https://github.com/marktext/marktext) 的编辑器内核 **muya**（`@muyajs/core`）为基础构建。

- **实时渲染（所见即所得）**：边写边渲染，光标所在段落显示 Markdown 源码，离开后立即呈现排版效果
- **应用外壳**：文件树、多标签、大纲、状态栏、查找替换、偏好设置、多主题
- **内核能力**：CommonMark + GFM、表格、任务列表、KaTeX 数学公式、Mermaid/PlantUML/Vega 图表、Prism 代码高亮、脚注、YAML 前言、上下标

## 与 marktext 的关系

marktext 已重构为 monorepo：`packages/muya`（纯 JS/DOM 的编辑器内核）与 `packages/desktop`（Electron 外壳）。

Typra2 把 marktext 的 **muya 内核源码**（develop 分支）以 workspace 包的形式内联到 `packages/muya`，
直接作为编辑器内核复用；外壳、交互与 Typora 式功能全部自行实现。这样做的原因：

- npm 上发布的 `@muyajs/core@0.2.0` 是**精简快照**，只暴露 18 个方法，
  缺少 `updateParagraph`、`format`、`createTable`、`insertImage`、`getCursorOffset`、
  `setFocusMode`、`revealElement` 等 Typora 式交互必需的 API；
- develop 分支的完整源码提供约 60 个公共方法，覆盖段落转换、行内格式、表格、
  光标换算、专注模式、大纲跳转等全部能力；
- 内联源码后由 Vite 直接编译 TypeScript，无需额外构建步骤。

同时避开了 desktop 包中 `keytar` / `native-keymap` / `@vscode/ripgrep`
等原生依赖带来的构建负担。

```
src/
  main/        Electron 主进程：窗口、IPC、菜单、端到端自检、截图
  preload/     上下文隔离桥接（window.typra）
  renderer/    Vue 3 界面
    src/components/   编辑器宿主、标签栏、侧边栏、状态栏、查找栏、偏好设置
    src/composables/  命令总线、文件操作、导出
    src/editor/       muya 内核封装与插件注册
    src/store/        全局响应式状态与设置持久化
    src/assets/styles 应用样式与主题变量
packages/muya/       内联的 marktext 编辑器内核源码
examples/demo.md     功能演示文档
```

## 功能

| 分类 | 能力 |
| --- | --- |
| 编辑 | 所见即所得实时渲染、源码模式、撤销/重做、自动配对括号与 Markdown 语法 |
| 排版 | 标题 1-6、引用、代码块、数学公式块、表格、分隔线、YAML 前言 |
| 行内 | 加粗、斜体、下划线、删除线、行内代码、高亮、行内公式、超链接、图片 |
| 视图 | 大纲、文件树、专注模式、打字机模式、5 套主题、缩放 |
| 文件 | 新建/打开/保存/另存为、打开文件夹、多标签、外部改动检测 |
| 工具 | 查找与替换（正则/大小写/全词）、字数统计、导出 HTML/PDF |

## 开发

需要 Node.js 20+ 与 pnpm。

```bash
pnpm install
pnpm dev        # 开发模式（热更新）
pnpm build      # 生产构建
pnpm typecheck  # 主进程 + 渲染层类型检查
pnpm verify     # 构建 + 端到端自检 + 真实文件工作流测试
pnpm shots      # 生成界面截图到 screenshots/
```

### 验证方式

项目自带两层自动化验证，都会启动真实的 Electron 进程：

**1. 端到端自检**（`pnpm smoke`）——在渲染层内验证：

- 编辑器挂载与段落块渲染
- 内核公共 API 完整性（缺失即失败，防止 API 适配错误）
- Markdown 往返一致性（写入 → 读回）
- 命令中心实效：标题/列表/任务列表/加粗/表格命令真的改变文档内容
- 命令注册齐备性（36 条关键命令必须存在）
- 查找替换、专注模式开关
- 主题配色按背景亮度判断深色/浅色真的切换
- 源码模式双向同步且不丢改动
- 导出产物是完整独立 HTML
- 大纲生成与字数统计

**2. 真实文件工作流测试**（`pnpm filetest`）——验证完整链路：

打开文件 → 编辑内容 → 保存到磁盘（并回读校验）→ 导出 HTML 并落盘。

**3. 像素采样**（`node scripts/sample-pixels.py <png>`）——客观核对截图配色，
避免仅凭肉眼判断主题是否生效。

## 键盘快捷键

| 快捷键 | 功能 | 快捷键 | 功能 |
| --- | --- | --- | --- |
| `Ctrl+N` | 新建 | `Ctrl+1..6` | 标题 1-6 |
| `Ctrl+O` | 打开文件 | `Ctrl+0` | 正文 |
| `Ctrl+Shift+O` | 打开文件夹 | `Ctrl+Shift+8` | 无序列表 |
| `Ctrl+S` | 保存 | `Ctrl+Shift+7` | 有序列表 |
| `Ctrl+Shift+S` | 另存为 | `Ctrl+Shift+9` | 任务列表 |
| `Ctrl+W` | 关闭标签页 | `Ctrl+Shift+Q` | 引用 |
| `Ctrl+B` | 加粗 | `Ctrl+Shift+K` | 代码块 |
| `Ctrl+I` | 斜体 | `Ctrl+Shift+M` | 数学公式块 |
| `Ctrl+U` | 下划线 | `Ctrl+Shift+L` | 侧边栏 |
| `Ctrl+F` | 查找 | `Ctrl+Shift+1` | 大纲 |
| `Ctrl+H` | 替换 | `Ctrl+/` | 源码模式 |
| `Ctrl+L` | 超链接 | `F8` / `F9` | 专注 / 打字机 |
| `Ctrl+\` | 清除格式 | `F12` | 开发者工具 |

## 许可

MIT。编辑器内核 muya 来自 [marktext](https://github.com/marktext/marktext)（MIT）。
