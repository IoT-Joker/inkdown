if (!process.versions.electron) {
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process')
  const root=path.resolve(__dirname,'..'),output=process.env.INKDOWN_DEMAND_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'inkdown-demand-'))
  fs.mkdirSync(output,{recursive:true})
  const env={...process.env,INKDOWN_DEMAND_ROOT:root,INKDOWN_DEMAND_OUTPUT:output}
  for(const name of Object.keys(env))if(/^INKDOWN_.*(?:CHECK|TEST|PROBE|SCREENSHOT|SHOT_)/.test(name))delete env[name]
  delete env.ELECTRON_RUN_AS_NODE
  const runner=path.join(output,'demand-runner.cjs');fs.copyFileSync(__filename,runner)
  const child=spawn(require('electron'),[runner,'--user-data-dir='+path.join(output,'profile')],{cwd:root,env,stdio:'inherit'})
  const timer=setTimeout(()=>{child.kill();process.exitCode=1},90000)
  child.on('error',e=>{clearTimeout(timer);console.error(e);process.exitCode=1})
  child.on('exit',code=>{clearTimeout(timer);let passed=false;try{const r=JSON.parse(fs.readFileSync(path.join(output,'results.json'),'utf8'));passed=r.completed&&r.checks.length>=8&&r.checks.every(x=>x.pass)}catch{}console.log('Demand evidence: '+output);process.exitCode=code===0&&passed?0:1})
} else {
const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs'),path=require('node:path')
const root=process.env.INKDOWN_DEMAND_ROOT||path.resolve(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[]
process.env.INKDOWN_NO_SESSION_RESTORE='1';process.env.INKDOWN_NO_SESSION_PERSIST='1'
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>cb({cancel:!d.url.startsWith('http://127.0.0.1:')})))
require(path.join(root,'out/main/index.js'))
app.whenReady().then(async()=>{
 let win
 for(let i=0;i<120;i++){win=BrowserWindow.getAllWindows()[0];if(win&&await win.webContents.executeJavaScript('!!window.__inkdownApp?.tabs().length&&!!window.__inkdownCommands').catch(()=>false))break;await wait(100)}
 win.webContents.setBackgroundThrottling(false);win.setSize(1480,900);await wait(200)
 const run=fn=>win.webContents.executeJavaScript('('+fn.toString()+')()'),check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(JSON.stringify(checks.at(-1)))}
 await run(()=>{
  window.__inkdownApp.settings().autoSave=false
  window.__demandMd='# Demand-driven charts\n\n'+Array.from({length:120},(_,i)=>'Introduction '+i+'：打开文档时，屏幕外的图表不应抢占菜单和滚动响应。').join('\n\n')+'\n\n```mermaid\nflowchart LR\n A[Start] --> B[Finish]\n```\n\n'+Array.from({length:80},(_,i)=>'Middle paragraph '+i).join('\n\n')+'\n\n```mermaid\nsequenceDiagram\n A->>B: hello\n```'
  window.__inkdownLoad(window.__demandMd)
 })
 await wait(900)
 check('opening a long document does not eagerly render offscreen diagrams',await run(()=>document.querySelectorAll('.mu-diagram-preview svg').length===0),await run(()=>document.querySelectorAll('.mu-diagram-preview svg').length))
 await run(()=>{const s=document.querySelector('.editor-scroll'),target=document.querySelector('.mu-diagram-block');s.scrollTop+=target.getBoundingClientRect().top-s.getBoundingClientRect().top-80})
 for(let i=0;i<60;i++){if(await run(()=>!!document.querySelector('.mu-diagram-preview svg')))break;await wait(100)}
 check('a diagram renders when scrolled into view',await run(()=>!!document.querySelector('.mu-diagram-preview svg')))
 check('a distant second diagram remains deferred',await run(()=>document.querySelectorAll('.mu-diagram-preview')[1].querySelector('svg')===null))
 check('deferral never changes Markdown',await run(()=>window.__inkdownApp.activeTab().content===window.__demandMd))
 await run(async()=>{await window.__inkdownCommands.execute('view:toggleColumns')})
 await wait(120)
 await run(()=>{const s=document.querySelector('.editor-scroll'),target=document.querySelectorAll('.mu-diagram-block')[1],root=window.__inkdownMuya.domNode,step=(root.clientWidth+64)/2;s.scrollLeft=Math.floor((target.getBoundingClientRect().left-root.getBoundingClientRect().left)/step)*step})
 for(let i=0;i<60;i++){if(await run(()=>!!document.querySelectorAll('.mu-diagram-preview')[1].querySelector('svg')))break;await wait(100)}
 check('offscreen charts also render on demand in two-page mode',await run(()=>!!document.querySelectorAll('.mu-diagram-preview')[1].querySelector('svg')))
 await run(async()=>{await window.__inkdownCommands.execute('file:new');window.__inkdownLoad('# Replacement\n\nNo charts here')})
 check('changing documents remains independent',await run(()=>window.__inkdownMuya.getMarkdown().includes('No charts here')))
 let plantRequested=false
 const server=require('node:http').createServer((_req,res)=>{plantRequested=true;setTimeout(()=>{res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><text x="4" y="30">Local fixture</text></svg>')},2500)})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 await win.webContents.executeJavaScript('window.__inkdownApp.settings().plantumlServer=window.__inkdownMuya.options.plantumlServer='+JSON.stringify('http://127.0.0.1:'+server.address().port)+';window.__inkdownLoad('+JSON.stringify('```plantuml\n@startuml\nAlice -> Bob: Slow local image\n@enduml\n```')+')')
 for(let i=0;i<20&&!plantRequested;i++)await wait(50)
 await win.webContents.executeJavaScript('window.__inkdownLoad('+JSON.stringify('```mermaid\nflowchart LR\nA --> B\n```')+')')
 for(let i=0;i<12;i++){if(await run(()=>!!document.querySelector('.mu-diagram-preview svg')))break;await wait(100)}
 const networkResult=await run(()=>({svg:!!document.querySelector('.mu-diagram-preview svg'),html:document.querySelector('.mu-diagram-preview')?.innerHTML.slice(0,160)}))
 check('a removed slow network diagram does not block new visible local diagrams',plantRequested&&networkResult.svg,{requested:plantRequested,...networkResult})
 await run(async()=>{
  window.__inkdownLoad('```mermaid\nflowchart LR\nA --> B\n```')
  const preview=document.querySelector('.mu-diagram-preview'),block=preview.__MUYA_BLOCK__
  window.__inkdownMuya.options.scheduleDiagramRender=(_target,render)=>{const pending=render();void block.update('');return pending}
  await block.update('flowchart LR\nA --> C')
 })
 await wait(180)
 check('clearing a diagram cannot be overwritten by its older asynchronous render',await run(()=>!document.querySelector('.mu-diagram-preview svg')))
 server.close()
 fs.writeFileSync(path.join(process.env.INKDOWN_DEMAND_OUTPUT||__dirname,'results.json'),JSON.stringify({completed:true,checks},null,2));app.exit(checks.every(x=>x.pass)?0:1)
}).catch(e=>{console.error(e.stack);app.exit(1)})

}
