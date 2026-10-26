if (!process.versions.electron) {
  const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process')
  const root=path.resolve(__dirname,'..'),output=process.env.INKDOWN_EXPORT_UI_OUTPUT||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'inkdown-export-ui-'))
  fs.mkdirSync(output,{recursive:true});const env={...process.env,INKDOWN_EXPORT_UI_ROOT:root,INKDOWN_EXPORT_UI_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE
  const runner=path.join(output,'export-ui.cjs');fs.copyFileSync(__filename,runner)
  const child=spawn(require('electron'),[runner,'--user-data-dir='+path.join(output,'profile')],{cwd:root,env,stdio:'inherit'})
  const timer=setTimeout(()=>child.kill(),120000)
  child.on('exit',code=>{clearTimeout(timer);let ok=false;try{const r=JSON.parse(fs.readFileSync(path.join(output,'results.json')));ok=r.completed&&r.checks.length>=9&&r.checks.every(x=>x.pass)}catch{}process.exitCode=code===0&&ok?0:1;console.log('Export UI evidence: '+output)})
} else {
 const {app,BrowserWindow,session,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),root=process.env.INKDOWN_EXPORT_UI_ROOT,output=process.env.INKDOWN_EXPORT_UI_OUTPUT
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];process.env.INKDOWN_NO_SESSION_RESTORE='1';process.env.INKDOWN_NO_SESSION_PERSIST='1'
 app.on('session-created',s=>s.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true})))
 dialog.showSaveDialog=async(_w,o)=>({canceled:false,filePath:path.join(output,path.basename(o.defaultPath||'export.pdf'))})
 require(path.join(root,'out/main/index.js'))
 app.whenReady().then(async()=>{
  let win;for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows()[0];if(win&&await win.webContents.executeJavaScript('!!window.__inkdownCommands&&!!window.__inkdownApp?.tabs().length').catch(()=>false))break;await wait(100)}
  win.webContents.setBackgroundThrottling(false);win.setSize(1420,940)
  const run=fn=>win.webContents.executeJavaScript('('+fn.toString()+')()'),check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(JSON.stringify(checks.at(-1)));if(!pass)throw Error(name)}
  await run(()=>{window.__inkdownApp.settings().autoSave=false;window.__inkdownLoad('# Export preview\n\nText body\n\n![missing](file:///Z:/inkdown-missing-image.png)\n\n```mermaid\nnot valid diagram\n```');void window.__inkdownCommands.execute('file:exportPdf')})
  await wait(300)
  check('export opens a settings and preview dialog before saving',await run(()=>!!document.querySelector('.export-dialog')))
  for(let i=0;i<400;i++){if(await run(()=>!!document.querySelector('.export-pdf-preview')&&!document.querySelector('.export-dialog [aria-busy="true"]')))break;await wait(100)}
  check('preview displays a rendered PDF page',await run(()=>document.querySelector('.export-pdf-preview')?.getAttribute('src')?.startsWith('data:image/png')))
  check('export check panel and confirmation checkbox are removed',await run(()=>!document.querySelector('.export-issues,.export-confirm')))
  check('ready preview can be exported directly despite resource issues',await run(()=>!document.querySelector('.export-save').disabled))
  await wait(300)
  await win.webContents.capturePage().then(image=>fs.writeFileSync(path.join(output,'preview-light.png'),image.toPNG()))
  await run(()=>document.body.classList.replace('theme-light','theme-dark'));await wait(100)
  await win.webContents.capturePage().then(image=>fs.writeFileSync(path.join(output,'preview-dark.png'),image.toPNG()))
  await run(()=>document.body.classList.replace('theme-dark','theme-light'))
  await run(()=>{const page=document.querySelector('[data-export="pageSize"]');page.value='A5';page.dispatchEvent(new Event('change',{bubbles:true}));const size=document.querySelector('[data-export="fontSize"]');size.value='14';size.dispatchEvent(new Event('input',{bubbles:true}));size.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.export-settings input[type=checkbox]').click()})
  await wait(1000)
  await run(()=>document.querySelector('.export-close').click())
  await run(()=>void window.__inkdownCommands.execute('file:exportPdf'));await wait(300)
  check('last paper and font options persist when reopened',await run(()=>document.querySelector('[data-export="pageSize"]').value==='A5'&&Number(document.querySelector('[data-export="fontSize"]').value)===14&&document.querySelector('.export-settings input[type=checkbox]').checked))
  for(let i=0;i<400;i++){if(await run(()=>!!document.querySelector('.export-pdf-preview')&&!document.querySelector('.export-dialog [aria-busy="true"]')))break;await wait(100)}
  await run(()=>document.querySelector('.export-save').click());for(let i=0;i<150&&!fs.readdirSync(output).some(n=>n.endsWith('.pdf'));i++)await wait(100)
  const pdf=fs.readdirSync(output).find(n=>n.endsWith('.pdf'));check('direct export writes PDF',!!pdf)
  const data=fs.readFileSync(path.join(output,pdf));check('PDF is A5 and retains heading outline',data.includes(Buffer.from('/Outlines'))&&(()=>{const m=data.toString('latin1').match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);return m&&Math.abs(Number(m[1])-419.53)<1.1&&Math.abs(Number(m[2])-595.28)<1.1})())
  await run(()=>{window.__inkdownLoad('# Clean document\n\nExport body');void window.__inkdownCommands.execute('file:exportDocx')});await wait(700)
  check('Word also opens export preview',await run(()=>!!document.querySelector('.export-dialog')))
  for(let i=0;i<100;i++){if(await run(()=>!document.querySelector('.export-save')?.disabled))break;await wait(100)}
  await run(()=>document.querySelector('.export-save').click());for(let i=0;i<150&&!fs.readdirSync(output).some(n=>n.endsWith('.docx'));i++)await wait(100)
  check('Word writes from preview settings',fs.readdirSync(output).some(n=>n.endsWith('.docx')))
  await run(()=>void window.__inkdownCommands.execute('file:exportHtml'));await wait(600)
  check('HTML explains print preview scope',await run(()=>!!document.querySelector('.export-format-note')?.textContent));await run(()=>document.querySelector('.export-close').click())
  await run(()=>{window.__inkdownLoad('# Long export\n\n'+Array.from({length:70},(_,i)=>'Paragraph '+i+' — This document tests actual PDF pagination and navigation.').join('\n\n'));void window.__inkdownCommands.execute('file:exportPdf')})
  for(let i=0;i<400;i++){if(await run(()=>!!document.querySelector('.export-pdf-preview')&&!document.querySelector('.export-dialog [aria-busy="true"]')))break;await wait(100)}
  check('long document preview exposes page count',await run(()=>Number(document.querySelector('.export-page-nav span')?.textContent?.split('/')[1])>1))
  const firstPage=await run(()=>document.querySelector('.export-pdf-preview').src)
  await run(()=>document.querySelector('.export-page-nav button:last-child').click())
  for(let i=0;i<200;i++){if(await run(()=>document.querySelector('.export-page-nav span')?.textContent?.trim().startsWith('2 /')))break;await wait(100)}
  check('page navigation renders a different actual PDF page',await run(()=>document.querySelector('.export-page-nav span')?.textContent?.trim().startsWith('2 /'))&&firstPage!==await run(()=>document.querySelector('.export-pdf-preview').src))
  await win.webContents.capturePage().then(image=>fs.writeFileSync(path.join(output,'long-preview.png'),image.toPNG()))
  await run(()=>document.querySelector('.export-close').click())
  await win.webContents.capturePage().then(image=>fs.writeFileSync(path.join(output,'main.png'),image.toPNG()))
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({completed:true,checks},null,2));app.exit(0)
 }).catch(e=>{console.error(e.stack);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({completed:false,checks,error:e.message},null,2));app.exit(1)})
}
