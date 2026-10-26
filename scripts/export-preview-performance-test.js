const fs=require('node:fs'),path=require('node:path')
if(!process.versions.electron){
 const {spawn}=require('node:child_process'),root=path.resolve(__dirname,'..'),output=process.env.INKDOWN_PREVIEW_PERF_OUTPUT||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'inkdown-preview-perf-'))
 fs.mkdirSync(output,{recursive:true});const env={...process.env,INKDOWN_PREVIEW_PERF_ROOT:root,INKDOWN_PREVIEW_PERF_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE
 const runner=path.join(output,'preview-perf.cjs');fs.copyFileSync(__filename,runner)
 const child=spawn(require('electron'),[runner,'--user-data-dir='+path.join(output,'profile')],{cwd:root,env,stdio:'inherit'}),timer=setTimeout(()=>child.kill(),90000)
 child.on('exit',code=>{clearTimeout(timer);let ok=false;try{const r=JSON.parse(fs.readFileSync(path.join(output,'results.json')));ok=r.completed&&r.checks.length>=9&&r.checks.every(x=>x.pass)}catch{}console.log('Preview performance evidence: '+output);process.exitCode=code===0&&ok?0:1})
}else{
 const {app,BrowserWindow}=require('electron'),root=process.env.INKDOWN_PREVIEW_PERF_ROOT,output=process.env.INKDOWN_PREVIEW_PERF_OUTPUT,wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[],timings=[]
 let created=0;app.on('browser-window-created',()=>created++);app.on('session-created',s=>s.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true})))
 process.env.INKDOWN_NO_SESSION_RESTORE='1';process.env.INKDOWN_NO_SESSION_PERSIST='1'
 require(path.join(root,'out/main/index.js'))
 app.whenReady().then(async()=>{
  let win;for(let i=0;i<120;i++){win=BrowserWindow.getAllWindows()[0];if(win&&await win.webContents.executeJavaScript('!!window.__inkdownCommands&&!!window.__inkdownApp?.tabs().length').catch(()=>false))break;await wait(100)}
  win.webContents.setBackgroundThrottling(false);win.setSize(1400,940)
  const run=fn=>win.webContents.executeJavaScript('('+fn.toString()+')()'),check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log(JSON.stringify(checks.at(-1)));if(!pass)throw Error(name)}
  const ready=async()=>{for(let i=0;i<1000;i++){if(await run(()=>!!document.querySelector('.export-pdf-preview')&&!document.querySelector('.export-preview-pane')?.getAttribute('aria-busy')?.includes('true')))return;await wait(15)}throw Error('Preview never became ready')}
  await run(()=>{window.__inkdownApp.settings().autoSave=false;window.__inkdownLoad('# Performance\n\n'+Array.from({length:100},(_,i)=>'## Section '+i+'\n\n'+('Text for preview performance. '.repeat(8))).join('\n\n'));void window.__inkdownCommands.execute('file:exportPdf')});await ready()
  check('long-document preview is ready',await run(()=>Number(document.querySelector('.export-page-nav span').textContent.split('/')[1])>2))
  let before=created,start=Date.now();await run(()=>document.querySelector('.export-page-nav button:last-child').click());await ready();timings.push({name:'unseen page 2',ms:Date.now()-start,newWindows:created-before})
  check('unseen page reuses the existing PDF viewer',created===before,timings.at(-1))
  before=created;start=Date.now();await run(()=>document.querySelector('.export-page-nav button:first-child').click());await ready();timings.push({name:'cached page 1',ms:Date.now()-start,newWindows:created-before})
  check('returning to page 1 is immediate without rebuilding a window',created===before&&timings.at(-1).ms<200,timings.at(-1))
  before=created;await run(()=>{const n=document.querySelector('[data-export="fontSize"]');n.value='1';n.dispatchEvent(new Event('input',{bubbles:true}))});await wait(400)
  check('unfinished font input does not trigger printing or a spinner',created===before&&await run(()=>document.querySelector('.export-preview-pane').getAttribute('aria-busy')==='false'))
  const image=await run(()=>document.querySelector('.export-pdf-preview').src)
  await run(()=>{const n=document.querySelector('[data-export="fontSize"]');n.value='14';n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}))})
  check('previous preview stays visible and is marked while layout updates',await run(()=>!!document.querySelector('.export-updating'))&&image===await run(()=>document.querySelector('.export-pdf-preview').src))
  await ready()
  before=created;start=Date.now();await run(()=>{const n=document.querySelector('[data-export="fontSize"]');n.value='12';n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}))});await ready();timings.push({name:'cached layout',ms:Date.now()-start,newWindows:created-before})
  check('returning to recent layout avoids PDF generation and new viewer',created===before&&timings.at(-1).ms<650,timings.at(-1))
  before=created;await run(()=>{const n=document.querySelector('[data-export="fontSize"]');n.dispatchEvent(new Event('change',{bubbles:true}))});await wait(400)
  check('committing identical settings performs no extra work',created===before&&await run(()=>document.querySelector('.export-preview-pane').getAttribute('aria-busy')==='false'))
  await run(()=>{const n=document.querySelector('[data-export="fontSize"]');n.value='1';n.dispatchEvent(new Event('input',{bubbles:true}))})
  await run(()=>document.querySelector('.export-close').click());for(let i=0;i<100&&BrowserWindow.getAllWindows().length>1;i++)await wait(20)
  check('closing preview disposes all hidden viewer windows',BrowserWindow.getAllWindows().length===1)
  await run(()=>void window.__inkdownCommands.execute('file:exportPdf'));await ready();check('reopening restores committed font rather than an unfinished draft',await run(()=>Number(document.querySelector('[data-export="fontSize"]').value)===12));await run(()=>document.querySelector('.export-close').click());for(let i=0;i<100&&BrowserWindow.getAllWindows().length>1;i++)await wait(20)
  check('reopening preview still works and releases its resources',BrowserWindow.getAllWindows().length===1)
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({completed:true,checks,timings},null,2));app.exit(0)
 }).catch(e=>{console.error(e.stack);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({completed:false,checks,timings,error:e.message},null,2));app.exit(1)})
}
