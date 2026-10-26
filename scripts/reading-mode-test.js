const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { test } = require('node:test')
const root = process.env.INKDOWN_PROJECT || path.resolve(__dirname, '..')
const ts = require(path.join(root, 'node_modules/typescript'))
function load(name, dependencies = {}, globals = {}) {
  const file = path.join(root, name)
  if (!fs.existsSync(file)) return {}
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext('(function(require,exports){'+output+'})', { Event, URL, ...globals })(id => {
    if (id in dependencies) return dependencies[id]
    throw Error('Unexpected dependency '+id)
  }, exports)
  return exports
}
const api = load('src/renderer/src/editor/reading.ts')
function required(name) { assert.equal(typeof api[name], 'function', name+' must be implemented'); return api[name] }
test('reading blocks document mutations while keeping find, copy, navigation and file actions', () => {
  const allowed = required('readingCommandAllowed')
  for (const id of ['format:strong','format:image','paragraph:table','edit:undo','edit:redo','edit:pastePlain','edit:cut','edit:duplicate','edit:deleteParagraph','edit:replace','edit:insertTime','edit:lineEnding']) assert.equal(allowed(id), false, id)
  for (const id of ['edit:copy','edit:copyMarkdown','edit:copyHtml','edit:selectAll','edit:find','edit:findInFolder','reading:back','view:toggleColumns','view:toggleSource','file:save','file:open','file:exportPdf']) assert.equal(allowed(id), true, id)
})
test('typing, paste, cut and drop are canceled; pointer selection and copy defaults are retained', () => {
  const gate = required('guardReadingEvent')
  for (const type of ['beforeinput','paste','cut','drop','dragover']) { const e=new Event(type,{cancelable:true});gate(e);assert.equal(e.defaultPrevented,true,type) }
  for (const type of ['mousedown','mouseup','mousemove','dblclick','copy']) { const e=new Event(type,{cancelable:true});gate(e);assert.equal(e.defaultPrevented,false,type) }
})
test('reading Back is LIFO, ignores no-op jumps, and does not leak across tabs', () => {
  const History=required('ReadingHistory'), a=new History([]),b=new History([])
  assert.equal(a.record({top:80,left:0},{top:80,left:0}),false)
  a.record({top:80,left:0},{top:400,left:0});a.record({top:400,left:0},{top:900,left:0})
  assert.equal(b.pop(),undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(a.pop())),{top:400,left:0})
  assert.deepEqual(JSON.parse(JSON.stringify(a.pop())),{top:80,left:0})
  assert.equal(a.pop(),undefined)
})
test('reading history survives a navigator being recreated for the same tab', () => {
  const History=required('ReadingHistory'),saved=[]
  new History(saved).record({top:20,left:600,column:1},{top:20,left:1200,column:2})
  assert.equal(new History(saved).pop().column,1)
})
test('duplicate heading aliases resolve separately and stable outline ids still work', () => {
  const index=required('readingHeadingAliases')([{slug:'stable-a',githubSlug:'repeat'},{slug:'stable-b',githubSlug:'repeat'},{slug:'stable-c',githubSlug:'repeat-1'},{slug:'stable-d',githubSlug:'中文'}])
  assert.equal(index.get('repeat'),0);assert.equal(index.get('repeat-1'),1);assert.equal(index.get('repeat-1-1'),2);assert.equal(index.get('stable-b'),1);assert.equal(index.get('中文'),3)
})
test('chapter tracking uses cached positions in single and adjacent dual pages', () => {
  const current=required('readingChapterAt'), headings=[{x:44,y:30},{x:44,y:300},{x:644,y:30},{x:1244,y:30}]
  assert.equal(current(headings,{top:0,left:0},true),0)
  assert.equal(current(headings,{top:0,left:600},true),2)
  assert.equal(current(headings,{top:0,left:1200},true),3)
  assert.equal(current([{x:0,y:40},{x:0,y:400},{x:0,y:850}],{top:450,left:0},false),1)
})
test('command dispatcher rejects reading mutation even when invoked by menu or IPC', async () => {
  // 契约：只有「阅读态」（viewMode=wysiwyg 且 readingMode=true）才拦截改动命令。
  // 可编辑的所见即所得必须放行，否则复制段落、插入表格等全部失效。
  const state={viewMode:'wysiwyg',readingMode:false,notice:null}, calls=[]
  const commands=load('src/renderer/src/composables/useCommands.ts',{
    vue:{reactive:x=>x},'../store':{state},'./useFile':{},'../../../shared/i18n':{translate:(_l,k)=>k},'./useI18n':{currentLocale:{value:'en'}},'../editor/reading':api
  })
  commands.registerCommand('format:strong',()=>calls.push('format'))
  commands.registerCommand('edit:copy',()=>calls.push('copy'))

  // 可编辑的所见即所得：改动命令放行
  await commands.executeCommand('format:strong')
  assert.deepEqual(calls,['format'])

  // 进入阅读态：改动命令被拒，只读类命令放行
  state.readingMode=true
  await commands.executeCommand('format:strong')
  await commands.executeCommand('edit:copy')
  assert.deepEqual(calls,['format','copy'])

  // 退出阅读态后恢复放行
  state.readingMode=false
  await commands.executeCommand('format:strong')
  assert.deepEqual(calls,['format','copy','format'])

  // 源码 / 源码预览本就是编辑视图
  state.viewMode='source';await commands.executeCommand('format:strong');assert.deepEqual(calls,['format','copy','format','format'])
  state.viewMode='split';await commands.executeCommand('format:strong');assert.deepEqual(calls,['format','copy','format','format','format'])
})

test('relative reading links resolve documents but reject executable and script protocols', () => {
  const resolve = required('readingLinkTarget')
  assert.deepEqual(JSON.parse(JSON.stringify(resolve('../other.md#repeat-1', 'E:/docs/chapter/main.md'))), {kind:'document',path:'E:/docs/other.md',fragment:'#repeat-1'})
  assert.equal(resolve('javascript:alert(1)','E:/docs/main.md'),null)
  assert.equal(resolve('file:///C:/Windows/calc.exe','E:/docs/main.md'),null)
  assert.equal(resolve('https://example.test/page','E:/docs/main.md').kind,'external')
  assert.equal(resolve('#fn1','E:/docs/main.md').kind,'fragment')
})

test('heading navigation uses the same top-level set as Muya TOC, excluding nested blockquote headings', () => {
  const collect=required('readingHeadingElements')
  const a={label:'A',matches:()=>true},quote={label:'quote with Nested',matches:()=>false},b={label:'B',matches:()=>true}
  const root={querySelector:()=>({children:[a,quote,b]})}
  assert.deepEqual(Array.from(collect(root),x=>x.label),['A','B'])
})

test('explicit reading copy uses selected rendered text and falls back to whole Markdown only without a selection', () => {
  const copy=required('readingCopyText')
  assert.equal(copy({isCollapsed:false,toString:()=> 'Only selected paragraph'},'# Whole document\n\nOther content'),'Only selected paragraph')
  assert.equal(copy({isCollapsed:true,toString:()=> ''},'# Whole document'),'# Whole document')
  assert.equal(copy(null,'# Whole document'),'# Whole document')
})

test('reading renders CRLF headings without rewriting the original Markdown snapshot', () => {
  const normalize=required('readingRenderMarkdown'),original='# A\r\n\r\n# B\r\n'
  assert.equal(normalize(original),'# A\n\n# B\n')
  assert.equal(original,'# A\r\n\r\n# B\r\n')
})

test('the final chapter remains active when its short section cannot reach the viewport top', () => {
  const current=required('readingChapterAt')
  assert.equal(current([{x:0,y:0},{x:0,y:1000}],{top:500,left:0},false,true),1)
  assert.equal(current([{x:44,y:30},{x:644,y:500}],{top:0,left:0},true,true),1)
})

test('relative links accept every Markdown extension supported by file opening', () => {
  const resolve=required('readingLinkTarget')
  for(const extension of ['md','markdown','mdown','mkd','mkdn','mdx','txt']) assert.notEqual(resolve('guide.'+extension,'E:/docs/main.md'),null,extension)
})
