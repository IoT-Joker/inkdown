// Real Electron acceptance: continuous columns, live-tab cache and inline update states.
if (!process.versions.electron) {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { spawn } = require('node:child_process')
  const output = process.env.INKDOWN_UI_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'inkdown-ui-'))
  fs.mkdirSync(output, { recursive: true })
  const env = { ...process.env, INKDOWN_UI_ROOT: path.resolve(__dirname, '..'), INKDOWN_UI_OUTPUT: output }
  for (const name of Object.keys(env)) if (/^INKDOWN_.*(?:CHECK|TEST|PROBE|SCREENSHOT|SHOT_)/.test(name)) delete env[name]
  delete env.ELECTRON_RUN_AS_NODE
  const runner = path.join(output, 'ui-runner.cjs')
  fs.copyFileSync(__filename, runner)
  const child = spawn(require('electron'), [runner, '--user-data-dir=' + path.join(output, 'profile')], { env, cwd: path.resolve(__dirname, '..'), stdio: 'inherit' })
  const timer = setTimeout(() => { child.kill(); process.exitCode = 1 }, 60000)
  child.on('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1 })
  child.on('exit', code => { clearTimeout(timer); console.log('UI evidence: ' + output); const result = path.join(output, 'inkdown-ui-acceptance.json'); process.exitCode = code === 0 && fs.existsSync(result) && JSON.parse(fs.readFileSync(result, 'utf8')).length >= 30 ? 0 : 1 })
} else {
const { app, BrowserWindow, dialog, session } = require('electron')
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: !details.url.startsWith('http://127.0.0.1:') })))
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const root = process.env.INKDOWN_UI_ROOT || path.resolve(__dirname, '..')
const wait = ms => new Promise(r => setTimeout(r, ms))
const outputDir = process.env.INKDOWN_UI_OUTPUT
const checks = []
const check = (name, pass, detail) => { checks.push({name,pass,detail}); console.log(JSON.stringify(checks.at(-1))) }
let release = '1.0.0', failFeed = false, dialogs = 0
dialog.showMessageBox = async () => { dialogs++; return {response:1,checkboxChecked:false} }
app.getVersion = () => require(path.join(root,'package.json')).version
const server = http.createServer((req, res) => setTimeout(() => {
  if (failFeed) { res.writeHead(500); res.end('offline fixture'); return }
  res.writeHead(200, {'Content-Type':'text/yaml'})
  res.end('version: ' + release + '\nfiles:\n  - url: Inkdown-Setup.exe\n    sha512: ' + Buffer.alloc(64).toString('base64') + '\n    size: 100\npath: Inkdown-Setup.exe\nsha512: ' + Buffer.alloc(64).toString('base64') + '\nreleaseDate: 2026-10-24T00:00:00.000Z\n')
}, 230))
server.listen(0,'127.0.0.1',() => {
  process.env.INKDOWN_UPDATE_URL = 'http://127.0.0.1:' + server.address().port
  process.env.INKDOWN_NO_SESSION_RESTORE = '1'
  process.env.INKDOWN_NO_SESSION_PERSIST = '1'
  require(path.join(root,'out/main/index.js'))
  app.whenReady().then(run).catch(finishError)
})
function finishError(error) { check('runtime exception',false,String(error.stack)); finish() }
function finish() {
  fs.writeFileSync(path.join(outputDir,'inkdown-ui-acceptance.json'),JSON.stringify(checks,null,2))
  server.close()
  app.exit(checks.every(x=>x.pass)?0:1)
}
async function run() {
  let win
  for (let i=0;i<120;i++) {
    win=BrowserWindow.getAllWindows()[0]
    if (win && await win.webContents.executeJavaScript('!!window.__inkdownApp?.tabs().length && !!window.__inkdownCommands').catch(()=>false)) break
    await wait(100)
  }
  win.setSize(1480,900)
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)console.log('[renderer]',message)})
  await wait(400)
  const evalUI = body => win.webContents.executeJavaScript('(async()=>{try{return await ('+body.toString()+')()}catch(e){console.error(e.stack);throw e}})()')
  const results = await evalUI(async () => {
    const checks=[]
    const check=(name,pass,detail)=>checks.push({name,pass,detail})
    const wait=ms=>new Promise(r=>setTimeout(r,ms))
    const api=window.__inkdownApp, cmd=window.__inkdownCommands
    api.settings().autoSave=false
    const md='# 连续双栏编辑\n\n'+Array.from({length:48},(_,i)=>'段落 '+String(i+1).padStart(2,'0')+'：同一篇文档从左栏底部延续到右栏顶部。Both columns are editable, with one undo history. **粗体内容**。\n\n').join('')
    window.__inkdownLoad(md); await wait(180)
    const original=window.__inkdownMuya.getMarkdown()
    const initialSource=api.activeTab().content
    check('Source Preview has one status entry', [...document.querySelectorAll('.status-right button')].filter(x=>x.textContent.trim()==='源码预览').length===1)
    check('continuous-columns toggle exists in WYSIWYG', !!document.querySelector('.columns-toggle'))
    await cmd.execute('view:toggleColumns'); await wait(220)
    const editor=window.__inkdownMuya, scroller=editor.domNode.closest('.editor-scroll')
    const bounds=scroller.getBoundingClientRect(), blocks=[...editor.domNode.querySelectorAll('.mu-paragraph')]
    const cols=blocks.map(x=>({text:x.textContent,left:x.getBoundingClientRect().left,top:x.getBoundingClientRect().top,bottom:x.getBoundingClientRect().bottom}))
    const left=cols.filter(x=>x.left>bounds.left && x.left<bounds.left+bounds.width/2)
    const right=cols.filter(x=>x.left>=bounds.left+bounds.width/2 && x.left<bounds.right)
    check('two visible continuous columns',scroller.classList.contains('is-columns') && left.length>0 && right.length>0,{left:left.map(x=>x.text.slice(0,5)),right:right.map(x=>x.text.slice(0,5)),pager:document.querySelector('.columns-pager')?.textContent})
    const number=x=>Number(x?.text.match(/段落 (\d+)/)?.[1])
    check('right column starts after the last left paragraph',number(right[0])===number(left.at(-1))+1,{leftLast:number(left.at(-1)),rightFirst:number(right[0])})
    check('enabling columns preserves source text',api.activeTab().content===initialSource)
    const target=blocks.find(x=>x.textContent.startsWith(right[0]?.text.slice(0,5)))
    const content=target?.querySelector('.mu-content'), leaf=content?.__MUYA_BLOCK__
    if (leaf) {
      editor.setCursor({block:leaf,anchor:{offset:0},focus:{offset:5}})
      await cmd.execute('format:strong'); editor.flush(); await wait(60)
      check('right-column formatting edits the document',api.activeTab().content!==original && editor.getMarkdown().includes('**段落'))
      await cmd.execute('edit:undo'); editor.flush(); await wait(60)
      check('one undo restores right-column edit',window.__inkdownMuya.getMarkdown()===original,{actual:window.__inkdownMuya.getMarkdown().slice(0,180),original:original.slice(0,180)})
    } else check('right column has live editable blocks',false)
    const before= document.querySelector('.columns-pager')?.textContent
    const next=document.querySelector('.columns-pager button:last-child'); next?.click(); await wait(100)
    check('pager advances to following content',scroller.scrollLeft>0 && document.querySelector('.columns-pager')?.textContent!==before,{scrollLeft:scroller.scrollLeft})
    const endBlock=editor.editor.scrollPage.lastContentInDescendant()
    editor.setCursor({block:endBlock,anchor:{offset:0},focus:{offset:0}}); await wait(80)
    const caretRect=window.getSelection().getRangeAt(0).getBoundingClientRect()
    check('caret in a later spread is revealed',caretRect.left>=bounds.left && caretRect.right<=bounds.right,{caretLeft:caretRect.left,boundsRight:bounds.right,scrollLeft:scroller.scrollLeft})
    await cmd.execute('view:toggleColumns'); await wait(80)
    check('returning to single column preserves source text',window.__inkdownMuya.getMarkdown()===original && !scroller.classList.contains('is-columns'))
    const first=api.activeTab().id, firstEditor=window.__inkdownMuya
    // An edit and tab switch in the same task must flush to the outgoing tab.
    const firstBlock=firstEditor.editor.scrollPage.firstContentInDescendant()
    firstEditor.setCursor({block:firstBlock,anchor:{offset:0},focus:{offset:0}})
    await cmd.execute('paragraph:h2')
    await cmd.execute('file:new'); await wait(80)
    const firstText=api.tabs().find(x=>x.id===first).content
    check('immediate tab switch retains pending edit in outgoing tab',/^## /.test(firstText))
    const second=api.activeTab().id, secondEditor=window.__inkdownMuya
    window.__inkdownLoad('# Second\n\nIndependent second document\n'); await wait(100)
    const secondText=api.activeTab().content
    api.setActive(first); await wait(80)
    check('returning tab reuses live DOM and history',window.__inkdownMuya===firstEditor && api.activeTab().content===firstText)
    await cmd.execute('edit:undo'); window.__inkdownMuya.flush(); await wait(80)
    check('undo stack survives switching tabs',api.activeTab().content===original)
    api.setActive(second); await wait(80)
    check('second tab content and editor remain independent',window.__inkdownMuya===secondEditor && api.activeTab().content===secondText)
    await cmd.execute('view:toggleFocus'); api.setActive(first); await wait(60)
    check('cached tabs apply current focus-mode preference',window.__inkdownMuya.domNode.classList.contains('mu-focus-mode'))
    await cmd.execute('view:toggleFocus'); api.setActive(second); await wait(60)
    await cmd.execute('view:toggleSplit'); await wait(80)
    window.__inkdownLoad('# Source replacement\n\nChanged in source preview'); await wait(180)
    await cmd.execute('view:toggleSplit'); await wait(120)
    check('source changes invalidate cached WYSIWYG content',window.__inkdownMuya.getMarkdown().includes('Source replacement'))
    await cmd.execute('file:new'); await wait(40)
    window.__inkdownLoad('hello'); await wait(60)
    const rawTab=api.activeTab(), rawEditor=window.__inkdownMuya
    rawTab.savedContent='hello'
    api.setActive(second); await wait(50); api.setActive(rawTab.id); await wait(50)
    check('switching untouched tabs preserves raw file bytes and clean state',rawTab.content==='hello' && rawTab.content===rawTab.savedContent)
    api.setActive(second); await wait(40)
    rawEditor.setContent('hello plus completed upload',false)
    rawEditor.eventCenter.emit('json-change', {source:'user'})
    await wait(60)
    check('asynchronous changes in an inactive editor reach their own tab',rawTab.content.includes('completed upload') && api.activeTab().id===second)
    const suspended=window.__inkdownMuya
    const originalSetOptions=suspended.setOptions
    let hiddenRebuilds=0
    suspended.setOptions=function(...args){hiddenRebuilds++;return originalSetOptions.apply(this,args)}
    await cmd.execute('view:toggleSplit'); await wait(40)
    await cmd.execute('file:new'); await wait(40)
    window.dispatchEvent(new Event('inkdown:settings-changed')); await wait(60)
    check('source-mode preferences do not rebuild a different hidden document',hiddenRebuilds===0)
    await cmd.execute('view:toggleSplit'); await wait(60)
    for(let i=0;i<4;i++) { await cmd.execute('file:new'); await wait(20); window.__inkdownLoad('Eviction '+i) }
    api.setActive(first); await wait(120)
    check('evicted tab reloads saved live content',api.activeTab().content===original && window.__inkdownMuya.getMarkdown().includes('连续双栏编辑'))
    check('only the active editor is in the document',document.querySelectorAll('.editor-scroll .muya-container').length===1)
    return checks
  })
  results.forEach(x=>check(x.name,x.pass,x.detail))
  await evalUI(async()=>{await window.__inkdownCommands.execute('view:toggleColumns')})
  await wait(150)
  fs.writeFileSync(path.join(outputDir,'inkdown-continuous-columns.png'),(await win.webContents.capturePage()).toPNG())
  win.setSize(800,700); await wait(120)
  check('narrow windows fall back to one readable column',await evalUI(()=>!document.querySelector('.editor-scroll.is-columns')))
  win.setSize(1480,900); await wait(120)
  check('wide windows restore continuous columns',await evalUI(()=>!!document.querySelector('.editor-scroll.is-columns')))
  await evalUI(async()=>{ [...document.querySelectorAll('.menu-label')].find(x=>/帮助|Help/.test(x.textContent)).click(); await new Promise(r=>setTimeout(r,30)); document.querySelector('.menu-update-check').click() })
  await wait(50)
  check('checking spinner appears at Help row right',await evalUI(()=>!!document.querySelector('.menu-update-row .update-spinner') && !!document.querySelector('.menu-panel')))
  await wait(1200)
  check('same release shows up-to-date inline',await evalUI(()=>/已是最新|up.to.date/i.test(document.querySelector('.menu-update-state')?.textContent)),await evalUI(()=>document.querySelector('.menu-update')?.textContent))
  release='9.9.9'
  await evalUI(()=>document.querySelector('.menu-update-check').click()); await wait(900)
  check('new release shows download arrow inside Help',await evalUI(()=>!!document.querySelector('.phase-available .menu-update-action svg')),await evalUI(()=>document.querySelector('.menu-update')?.textContent))
  await evalUI(()=>document.querySelector('.menu-update-action')?.click()); await wait(100)
  check('bat build explains packaged-only install inline',await evalUI(()=>!!document.querySelector('.menu-update-message') && !!document.querySelector('.menu-panel')),await evalUI(()=>document.querySelector('.menu-update-message')?.textContent))
  fs.writeFileSync(path.join(outputDir,'inkdown-update-inline.png'),(await win.webContents.capturePage()).toPNG())
  release='1.0.0'
  await evalUI(()=>document.querySelector('.menu-update-check').click()); await wait(900)
  check('available Help row can recheck the feed',await evalUI(()=>/已是最新|up.to.date/i.test(document.querySelector('.menu-update-state')?.textContent)))
  const menuBounds=await evalUI(()=>document.querySelector('.menu-update-row').getBoundingClientRect().toJSON())
  await evalUI(()=>{
    const dom=window.__inkdownMuya.domNode
    const rects=dom.getClientRects.bind(dom), points=document.elementsFromPoint.bind(document)
    window.__hoverGeometry=0
    dom.getClientRects=(...args)=>{window.__hoverGeometry++;return rects(...args)}
    document.elementsFromPoint=(...args)=>{window.__hoverGeometry++;return points(...args)}
  })
  for(let i=0;i<18;i++) { win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(menuBounds.left+40+i*4),y:Math.round(menuBounds.top+12)});await wait(16) }
  await wait(350)
  check('real pointer movement inside Help avoids editor hit tests',await evalUI(()=>window.__hoverGeometry===0),await evalUI(()=>window.__hoverGeometry))
  check('no update dialogs were used',dialogs===0,dialogs)
  finish()
}

}
