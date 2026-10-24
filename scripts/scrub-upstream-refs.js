/**
 * 一次性清理：减少对上游项目的提及。
 *
 * 用户要求「少提 marktext」：对外文案不把它当卖点，
 * 溯源说明保留一处即可，代码注释只讲这里做了什么。
 *
 * 用法：node scripts/scrub-upstream-refs.js
 */
const fs = require('fs')
const path = require('path')

const root = path.dirname(__dirname)

/** 逐条替换：改到了就报告。 */
const EDITS = [
  [
    'src/main/index.ts',
    [
      [
        ' * 参考 marktext 的 main 进程分层，但只保留 Typora 式编辑器所需的最小集合，',
        ' * 主进程只保留桌面编辑器所需的最小集合，'
      ]
    ]
  ],
  [
    'src/renderer/src/components/CommandPalette.vue',
    [[' * 命令面板（对齐 marktext 的 Command Palette）。', ' * 命令面板：模糊检索并执行所有已注册命令。']]
  ],
  [
    'src/renderer/src/components/EditorHost.vue',
    [
      [
        ' * 段落与格式命令的取值直接对齐 marktext desktop 的菜单词汇表',
        ' * 段落与格式命令的取值直接对齐内核的块类型词汇表'
      ],
      ['    // 段落操作（对齐 marktext 的 Edit 菜单）', '    // 段落操作']
    ]
  ],
  [
    'src/renderer/src/composables/useCommands.ts',
    [['    // 插入当前时间（marktext 的 Insert Current Time）', '    // 插入当前时间']]
  ],
  [
    'package.json',
    [
      [
        `"description": "Inkdown - a Typora-like WYSIWYG markdown editor built on marktext's muya engine"`,
        `"description": "Inkdown - a focused WYSIWYG markdown editor for the desktop"`
      ]
    ]
  ],
  [
    'README.md',
    [
      ['packages/muya/       内联的 marktext 编辑器内核源码', 'packages/muya/       编辑器内核（内联源码）'],
      ['菜单包含一些 marktext 式的实用项：', '菜单还包含一些实用项：']
    ]
  ],
  [
    'examples/demo.md',
    [
      [
        'Inkdown 基于 marktext 的编辑器内核构建[^1]，并参考了 Typora 的交互设计。',
        'Inkdown 内置所见即所得编辑器内核[^1]，交互参考了主流 Markdown 编辑器的习惯。'
      ],
      [
        '[^1]: muya（`@muyajs/core`）是 marktext 抽离出的独立 Markdown 编辑器内核。',
        '[^1]: 内核为 muya，以 workspace 包形式内联，随应用一起编译。'
      ],
      ['更多信息参见 [marktext 仓库](https://github.com/marktext/marktext)。', '更多信息参见 [项目主页](https://github.com/IoT-Joker/inkdown)。']
    ]
  ]
]

let changed = 0
for (const [rel, pairs] of EDITS) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) {
    console.warn('跳过（文件不存在）:', rel)
    continue
  }
  let text = fs.readFileSync(abs, 'utf8')
  let hits = 0
  for (const [from, to] of pairs) {
    if (text.includes(from)) {
      text = text.split(from).join(to)
      hits++
    }
  }
  if (hits) {
    fs.writeFileSync(abs, text, 'utf8')
    console.log(`已改 ${rel}（${hits} 处）`)
    changed += hits
  } else {
    console.log(`未命中 ${rel}`)
  }
}

console.log(`\n共替换 ${changed} 处`)
