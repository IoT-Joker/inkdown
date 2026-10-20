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
| 文件 | 新建/打开/保存/另存为、打开文件夹、多标签、自动保存、外部改动检测、会话恢复 |
| 工具 | 查找与替换（正则/大小写/全词）、字数统计、导出 HTML/PDF |

### 文件树与拖入

- **文件树只显示 Markdown 文档**（`.md` / `.markdown` / `.mdown` / `.mkd` / `.mkdn` / `.mdx` / `.txt`）。
  目录始终保留用于导航，图片、脚本、配置等文件不会混入。
- **拖入 `.md` 文件即可打开**：拖拽时显示投放提示层，支持一次拖入多个；
  非 Markdown 文件会被忽略并给出提示。

### 会话恢复

关闭软件再打开时，**上次打开的标签页会自动恢复**（含活动标签）。
已被删除或移动的文件会跳过，未命名文档不参与恢复。

### 未保存提示

- 标签栏与窗口标题在文件名后显示 `*` 表示有未保存改动
- 关闭标签或退出时提示「保存 / 不保存 / 取消」，取消则中止关闭
- 应用自身的保存**不会**触发「外部修改」提示；只有真实的外部改动才会
  （以非阻塞提示条呈现，不打断写作）

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

### 如何启动

**方式一：双击** `启动 Typra2.bat`（Windows 最省事）

**方式二：命令行**

```bash
pnpm build      # 首次需先构建
pnpm start       # 或：node scripts/start.js
```

**方式三：直接运行 Electron**（无需 Node 在 PATH）

```bash
node_modules\electron\dist\electron.exe .
```

启动脚本 `scripts/start.js` 会自动处理两个环境问题：
`node` 不在 PATH 时改用内置运行时；剔除宿主的 `ELECTRON_RUN_AS_NODE=1`。

启动后按 `Ctrl+O` 打开 [examples/demo.md](examples/demo.md) 体验全部功能。

### 验证方式

项目自带两层自动化验证，都会启动真实的 Electron 进程：

**1. 端到端自检**（`pnpm smoke`）——在渲染层内验证：

| 用例 | 校验内容 |
| --- | --- |
| 编辑器挂载 | 应用外壳与编辑器容器、段落块渲染 |
| 内核 API 完整性 | 12 个命令中心必需的 API 必须存在，缺失即失败 |
| Markdown 往返 | 写入 → 读回内容一致 |
| 命令中心实效 | 标题/列表/任务列表/加粗/表格命令真的改变文档内容 |
| 命令注册齐备 | 36 条关键命令全部存在（共 56 条） |
| 查找替换 | 全部替换真的生效 |
| 专注模式 | 非当前块 opacity 降到 0.25、当前块保持 1，关闭后恢复 |
| 主题切换 | 按编辑区背景亮度判断深色/浅色真的切换 |
| 源码模式 | 切到源码 → 编辑 → 切回所见即所得，内容不丢 |
| 代码高亮 | 代码块产生 Prism token |
| 数学公式 | 块级公式渲染成 KaTeX |
| 图表 | Mermaid 渲染成 SVG |
| 打字机模式 | 光标后移触发滚动 |
| 多标签 | 两个标签内容各自独立 |
| 文件树 | 读取含子目录的目录结构 |
| 导出 | 产物为完整独立 HTML |
| 大纲与字数 | 大纲条目数正确、字数随长文档更新 |

**2. 真实文件工作流测试**（`pnpm filetest`）——验证完整链路：

打开文件 → 编辑内容 → 保存到磁盘（并回读校验）→ 导出 HTML 并落盘
→ 导出 PDF（校验 `%PDF-` 头部与体积）→ 文件树只显示 Markdown → 会话记录。

**3. 会话恢复测试**（`pnpm sessiontest`）——分两次启动真实进程：

第一次打开两个文件并记录会话；第二次全新启动，校验自动恢复的标签与活动标签
（要求恰好 2 个，防止测试数据污染悄悄通过）。

**3. 像素采样**（`node scripts/sample-pixels.py <png>`）——客观核对截图配色，
避免仅凭肉眼判断主题是否生效。

**4. PDF 内容核对**：主进程支持把导出的 PDF 渲染成图片
（`TYPRA2_RENDER_PDF=<pdf>`），用于确认导出内容不含应用界面。

## 已知环境问题

部分环境（如宿主设置了 `ELECTRON_RUN_AS_NODE=1`）会让 Electron 退化为纯 Node 模式，
启动时报 `Cannot read properties of undefined (reading 'whenReady')`。
三个测试脚本已自动剔除该变量；本地 `pnpm dev` 若遇到同样报错，请先清除它。

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
