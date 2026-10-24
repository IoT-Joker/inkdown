// Capture actual rendered gutter pixels, not just declared CSS colors.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const root=process.env.INKDOWN_GUTTER_ROOT||path.resolve(__dirname,'..')
if(!process.versions.electron){
  const {spawn}=require('node:child_process')
  const output=process.env.INKDOWN_GUTTER_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'inkdown-gutter-'))
  fs.mkdirSync(output,{recursive:true})
  const env={...process.env,INKDOWN_GUTTER_ROOT:root,INKDOWN_GUTTER_OUTPUT:output,INKDOWN_NO_SESSION_RESTORE:'1',INKDOWN_NO_SESSION_PERSIST:'1'}
  for(const name of Object.keys(env))if(/^INKDOWN_.*(?:CHECK|TEST|PROBE|SCREENSHOT|SHOT_)/.test(name))delete env[name]
  delete env.ELECTRON_RUN_AS_NODE
  const runner=path.join(output,'gutter-runner.cjs');fs.copyFileSync(__filename,runner)
  const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[runner,'--user-data-dir='+path.join(output,'profile')],{cwd:root,env,stdio:'inherit'})
  const timer=setTimeout(()=>{child.kill();process.exitCode=1},60000)
  child.on('error',e=>{clearTimeout(timer);console.error(e);process.exitCode=1})
  child.on('exit',code=>{clearTimeout(timer);let passed=false;try{const r=JSON.parse(fs.readFileSync(path.join(output,'results.json'),'utf8'));passed=r.completed&&r.checks.length>=7&&r.checks.every(x=>x.pass)}catch{}console.log('Gutter evidence: '+output);process.exitCode=code===0&&passed?0:1})
}else{
  const {app,BrowserWindow,session}=require('electron'),wait=ms=>new Promise(r=>setTimeout(r,ms))
  app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true})))
  require(path.join(root,'out/main/index.js'))
  app.whenReady().then(async()=>{
    let win
    for(let i=0;i<120;i++){win=BrowserWindow.getAllWindows()[0];if(win&&await win.webContents.executeJavaScript('!!window.__inkdownMuya&&!!window.__inkdownApp?.tabs().length&&!!window.__inkdownCommands').catch(()=>false))break;await wait(100)}
    win.webContents.setBackgroundThrottling(false);win.setSize(1480,900);await wait(200)
    const run=fn=>win.webContents.executeJavaScript('('+fn.toString()+')()')
    await run(async()=>{
      window.__inkdownApp.settings().autoSave=false
      window.__inkdownLoad('# Page background regression\n\n'+Array.from({length:100},(_,i)=>'Paragraph '+i+'：分页后，页间背景必须保持一致。 The gutter should remain separate from the paper background.').join('\n\n'))
      await window.__inkdownCommands.execute('view:toggleColumns')
    })
    await wait(150)
    const checks=[],check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(JSON.stringify(checks.at(-1)))}
    check('two-page control uses the requested short label',await run(()=>document.querySelector('.columns-toggle')?.textContent.trim()==='双页'))
    const pixel=async(x,y)=>{
      const native=await win.webContents.capturePage({x:Math.round(x),y:Math.round(y),width:1,height:1})
      const bytes=native.toBitmap({scaleFactor:1})
      return [bytes[2],bytes[1],bytes[0],bytes[3]]
    }
    for(const theme of ['light','dark']){
      if(theme==='dark'){await run(()=>window.__inkdownCommands.execute('view:toggleTheme'));await wait(100)}
      for(const page of [1,2,3]){
        await win.webContents.executeJavaScript('document.querySelector(".editor-scroll").scrollLeft='+String(page-1)+'*((window.__inkdownMuya.domNode.clientWidth+64)/2)')
        await wait(90)
        const info=await run(()=>{
          const b=document.querySelector('.editor-scroll').getBoundingClientRect(),host=document.querySelector('.editor-host')
          const c=document.createElement('canvas');c.width=c.height=1
          const ctx=c.getContext('2d');ctx.fillStyle=getComputedStyle(host).backgroundColor;ctx.fillRect(0,0,1,1)
          return {x:b.left+b.width/2,ys:[b.top+80,b.top+b.height/2,b.bottom-80],expected:[...ctx.getImageData(0,0,1,1).data],paperX:b.left+34,label:document.querySelector('.columns-pager').textContent}
        })
        const samples=[];for(const y of info.ys)samples.push(await pixel(info.x,y))
        const paper=await pixel(info.paperX,info.ys[1])
        check(theme+' pages '+page+'-'+(page+1)+' show the same gutter along the full height',samples.every(p=>p.every((v,i)=>Math.abs(v-info.expected[i])<=2))&&paper.some((v,i)=>Math.abs(v-info.expected[i])>2),{samples,expected:info.expected,paper,label:info.label})
        if(page===1)fs.writeFileSync(path.join(process.env.INKDOWN_GUTTER_OUTPUT,theme+'-pages.png'),(await win.webContents.capturePage()).toPNG())
      }
    }
    check('single-page editing retains its original opaque editor background',await run(async()=>{
      await window.__inkdownCommands.execute('view:toggleColumns')
      await new Promise(r=>requestAnimationFrame(r))
      const c=document.createElement('canvas');c.width=c.height=1
      const ctx=c.getContext('2d');ctx.fillStyle=getComputedStyle(window.__inkdownMuya.domNode).backgroundColor;ctx.fillRect(0,0,1,1)
      return ctx.getImageData(0,0,1,1).data[3]===255
    }))
    fs.writeFileSync(path.join(process.env.INKDOWN_GUTTER_OUTPUT,'results.json'),JSON.stringify({completed:true,checks},null,2))
    app.exit(checks.every(x=>x.pass)?0:1)
  }).catch(e=>{console.error(e.stack);app.exit(1)})
}
