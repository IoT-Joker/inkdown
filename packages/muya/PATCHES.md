# 内核改动记录（PATCHES）

`packages/muya` 是内联的编辑器内核源码（源自开源项目 muya，MIT）。
它不是原样拷贝——为了适配 Inkdown 的交互与性能要求，改过一部分文件。

**这份文件存在的意义**：半年后能分清「哪些是上游原版、哪些是自己改的、为什么改」。
没有它，升级内核时无法判断哪些改动会丢失。

维护约定：

- 每次改动 `packages/muya/**`，**同一提交里**补一条记录
- 记录写清「改了什么」「为什么」，不要只写文件名
- 上游对应文件若也修了同名问题，标注「已具备」以便将来还原成原版

---

## 一、浮层命中测试（5 个文件）

**问题**：编辑器里有多个浮动工具条（表格拖拽条、列工具条、段落前按钮、预览工具条）。
原先它们响应全局 mousemove，只要鼠标动就做一次命中测试，其中包含 `getBoundingClientRect`。

鼠标在**应用其它区域**移动（菜单、侧栏、状态栏）时，这些布局读取毫无意义，
却每帧都在触发重排，是「菜单悬停慢半拍」的来源之一。

**做法**：新增 `utils/dom.ts` 的 `isEditorHoverTarget()`，在命中测试**之前**
先判断事件目标是否落在编辑器或该浮层内部，不是就直接返回，跳过布局读取。

涉及文件：

| 文件 | 改动 |
| --- | --- |
| `utils/dom.ts` | 新增 `isEditorHoverTarget()`（唯一新增函数） |
| `ui/tableDragBar/index.ts` | 接入判断；顺带修拖拽状态残留（`_dropTimer`、`_pendingMouseupId`） |
| `ui/tableColumnToolbar/index.ts` | 接入判断 |
| `ui/paragraphFrontButton/index.ts` | 接入判断；缓存已渲染图标避免重复重建 |
| `ui/previewToolBar/index.ts` | 接入判断 |

---

## 二、异步渲染竞态防护（3 个文件）

**问题**：图表、脚注是异步渲染的。若用户在渲染未完成时修改内容或切换文档，
旧的渲染结果会覆盖新内容，表现为「改了却显示旧图」「切文档后图表串了」。

**做法**：每次渲染带一个自增版本号，渲染完成后比对版本，
不一致就丢弃结果（不写入 DOM）。

| 文件 | 改动 |
| --- | --- |
| `block/extra/diagram/diagramPreview.ts` | 引入 `_renderVersion`；每次渲染独占挂载点，旧结果不得覆盖新预览 |
| `ui/baseFloat/index.ts` | 位置重算用 `_resizeFrame` 合并到下一帧，避免连续 reflow |
| `ui/tableRowColumMenu/index.ts` | 菜单开着时表格被撤销删除，块已脱离文档 —— 操作前检查 `outMostBlock` 再动手 |

---

## 三、样式修正（2 个文件）

| 文件 | 改动 |
| --- | --- |
| `assets/styles/githubAlerts.css` | 补 `.markdown-body .markdown-alert` 选择器，让导出与预览的提示块样式一致 |
| `assets/styles/blockSyntax.css` | 1 行间距微调 |

---

## 四、图表与脚注小修（4 个文件）

| 文件 | 改动 |
| --- | --- |
| `utils/diagram/plantuml/index.ts` | 失败时返回可识别的错误占位，不再留下破图 |
| `utils/diagram/render.ts` | 渲染结果收尾统一走 `finalizeRenderedDiagram` |
| `block/extra/footnote/index.ts` | 脚注渲染细节修正 |
| `ui/footnoteTool/index.ts` | 同上 |

对应测试同步更新：`block/extra/footnote/__tests__/footnote.spec.ts`、
`ui/footnoteTool/__tests__/footnoteTool.spec.ts`。

---

## 五、其它（3 个文件）

| 文件 | 改动 |
| --- | --- |
| `state/markdownToHtml.ts` | 1 行导出路径修正 |
| `types.ts` | 补 2 行类型声明（新增配置项） |
| `utils/marked/extensions/githubAlerts.ts` | 1 行告警类型映射修正 |

---

## 升级内核时怎么办

若将来要把内联内核替换成上游新版，按以下顺序处理：

1. 用本文件比对上游同名文件，确认上游是否已修了同样的问题
   （重点看第一节的浮层命中测试——上游可能仍是无条件命中测试）
2. 上游**没有**修的，重新应用本文件的改动
3. 应用后跑 `pnpm typecheck:muya` 与以下测试确认没退化：
   - `node scripts/editor-performance-test.js`（浮层性能与命中测试）
   - `node scripts/diagram-demand-test.js`（图表按需渲染与竞态）
   - `node scripts/deferred-diagrams-test.js`
   - `pnpm smoke`（端到端自检）

**注意**：`src/utils/dom.ts` 的 `isEditorHoverTarget` 是本项目新增的，
上游没有这个函数，替换后需重新加入，否则第一节那 4 个文件会编译失败。
