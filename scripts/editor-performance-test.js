// Real editor regression: paging must not remeasure the document on every scroll.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const root = process.env.INKDOWN_PROJECT || path.resolve(__dirname, '..')
if (!process.versions.electron) {
  const { spawn } = require('node:child_process')
  const output = process.env.INKDOWN_PERF_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'inkdown-perf-'))
  fs.mkdirSync(output, {recursive:true})
  const env = {...process.env, INKDOWN_PROJECT:root, INKDOWN_PERF_OUTPUT:output, INKDOWN_NO_SESSION_RESTORE:'1', INKDOWN_NO_SESSION_PERSIST:'1'}
  for(const name of Object.keys(env))if(/^INKDOWN_.*(?:CHECK|TEST|PROBE|SCREENSHOT|SHOT_)/.test(name))delete env[name]
  delete env.ELECTRON_RUN_AS_NODE
  // Electron resolves scripts inside a package through its package.json entry.
  // A standalone runner ensures this probe, rather than the ordinary app, runs.
  const runner=path.join(output,'runner.cjs')
  fs.copyFileSync(__filename,runner)
  const child = spawn(path.join(root,'node_modules/electron/dist/electron.exe'), [runner,'--user-data-dir='+path.join(output,'profile')], {cwd:root,env,stdio:'inherit'})
  const timer=setTimeout(()=>{child.kill();process.exitCode=1},90000)
  child.on('error',e=>{clearTimeout(timer);console.error(e);process.exitCode=1})
  child.on('exit',code=>{clearTimeout(timer);console.log('Performance evidence: '+output);const result=path.join(output,'results.json');process.exitCode=code===0&&fs.existsSync(result)&&JSON.parse(fs.readFileSync(result,'utf8')).length>=15?0:1})
} else {
  const {app,BrowserWindow,session}=require('electron')
  // Profiling never sends document fragments to remote diagram/update services.
  app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})))
  require(path.join(root,'out/main/index.js'))
  const wait=ms=>new Promise(r=>setTimeout(r,ms)), checks=[]
  const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(JSON.stringify(checks.at(-1)))}
  app.whenReady().then(async()=>{
    let win
    for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows()[0];if(win&&await win.webContents.executeJavaScript('!!window.__inkdownMuya && !!window.__inkdownApp?.tabs().length && !!window.__inkdownCommands').catch(()=>false))break;await wait(100)}
    // Measure foreground responsiveness without unrelated window focus throttling.
    win.webContents.setBackgroundThrottling(false)
    win.setSize(1480,900)
    await wait(300)
    const evaluate = fn=>win.webContents.executeJavaScript('('+fn.toString()+')()')
    const debuggerApi=win.webContents.debugger
    debuggerApi.attach('1.3')
    async function blockingWheels(){
      const {root:doc}=await debuggerApi.sendCommand('DOM.getDocument')
      const {nodeId}=await debuggerApi.sendCommand('DOM.querySelector',{nodeId:doc.nodeId,selector:'.editor-scroll'})
      const {object}=await debuggerApi.sendCommand('DOM.resolveNode',{nodeId})
      const {listeners}=await debuggerApi.sendCommand('DOMDebugger.getEventListeners',{objectId:object.objectId})
      return listeners.filter(x=>x.type==='wheel'&&!x.passive).length
    }
    check('single-column scrolling has no cancelable wheel handler',await blockingWheels()===0)
    const fixture=fs.readFileSync(path.join(root,'examples/comprehensive-test.md'),'utf8')
    await win.webContents.executeJavaScript('window.__inkdownLoad('+JSON.stringify(fixture)+')')
    await evaluate(async()=>{await window.__inkdownCommands.execute('view:zoomIn');await window.__inkdownCommands.execute('view:toggleColumns')})
    check('columns install their cancelable wheel handler',await blockingWheels()===1)
    // Visit each chart before measuring warm interactions; offscreen diagrams
    // are intentionally deferred during startup rather than rendered eagerly.
    const charts=await evaluate(()=>document.querySelectorAll('.mu-diagram-block').length)
    for(let chart=0;chart<charts;chart++){
      await win.webContents.executeJavaScript('(()=>{const s=document.querySelector(".editor-scroll"),root=window.__inkdownMuya.domNode,target=root.querySelectorAll(".mu-diagram-block")['+chart+'],step=(root.clientWidth+64)/2;s.scrollLeft=Math.floor((target.getBoundingClientRect().left-root.getBoundingClientRect().left)/step)*step})()')
      for(let i=0;i<60;i++){
        const ready=await win.webContents.executeJavaScript('!!window.__inkdownMuya.domNode.querySelectorAll(".mu-diagram-block")['+chart+'].querySelector("svg,img,.mu-diagram-error")')
        if(ready)break
        await wait(100)
      }
    }
    for(let i=0;i<100;i++){if(await evaluate(()=>document.querySelectorAll('.mu-diagram-preview > svg, .mu-diagram-preview img').length>=4 && ![...document.querySelectorAll('.mu-diagram-preview')].some(x=>x.textContent==='Loading...')))break;await wait(100)}
    await wait(700)
    check('fixture has rendered graphs and multiple spreads',await evaluate(()=>document.querySelectorAll('.mu-diagram-preview svg').length>=3 && /\d+/.test(document.querySelector('.columns-pager').textContent)))
    const original=await evaluate(()=>window.__inkdownMuya.getMarkdown())
    await evaluate(()=>{
      const scroller=document.querySelector('.editor-scroll'), root=window.__inkdownMuya.domNode
      const last=window.__inkdownMuya.editor.scrollPage.domNode.lastElementChild
      window.__perfProbe={paginationReads:0,styleWrites:0,scrolls:0}
      for(const name of ['getClientRects','getBoundingClientRect']){const old=last[name].bind(last);last[name]=(...args)=>{window.__perfProbe.paginationReads++;return old(...args)}}
      const rect=root.getBoundingClientRect.bind(root);root.getBoundingClientRect=(...args)=>{window.__perfProbe.paginationReads++;return rect(...args)}
      new MutationObserver(list=>window.__perfProbe.styleWrites+=list.length).observe(scroller,{attributes:true,attributeFilter:['style']})
      scroller.addEventListener('scroll',()=>window.__perfProbe.scrolls++)
    })
    const wheel=await evaluate(async()=>{
      const scroller=document.querySelector('.editor-scroll')
      scroller.scrollLeft=0
      for(let i=0;i<8;i++)scroller.dispatchEvent(new WheelEvent('wheel',{deltaY:12,bubbles:true,cancelable:true}))
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
      return {scroll:scroller.scrollLeft,step:(window.__inkdownMuya.domNode.clientWidth+64)/2}
    })
    check('small wheel deltas accumulate into complete adjacent pages',Math.abs(wheel.scroll-2*wheel.step)<1,wheel)
    for(let i=0;i<8;i++){await evaluate(()=>document.querySelector('.columns-pager button:last-child').click());await wait(185)}
    const paging=await evaluate(()=>window.__perfProbe)
    check('scrolling uses cached pagination instead of remeasuring the last block',paging.paginationReads===0,paging)
    check('scrolling does not write inherited layout variables',paging.styleWrites===0,paging)
    check('paging preserves Markdown',await evaluate(()=>window.__inkdownMuya.getMarkdown())===original)
    const shifted=await evaluate(()=>{
      const scroller=document.querySelector('.editor-scroll'),before=scroller.scrollLeft
      const box=document.createElement('pre');box.style.cssText='width:200px;height:80px;overflow:auto;padding:0;border:0;line-height:20px'
      box.innerHTML='<span style="display:block;width:900px;height:20px">A long code line for horizontal scrolling</span>'
      window.__inkdownMuya.domNode.appendChild(box)
      const overflowX=box.scrollWidth-box.clientWidth,overflowY=box.scrollHeight-box.clientHeight
      const event=new WheelEvent('wheel',{deltaY:12,shiftKey:true,bubbles:true,cancelable:true})
      box.dispatchEvent(event);box.remove()
      return {canceled:event.defaultPrevented,documentMoved:scroller.scrollLeft!==before,overflowX,overflowY}
    })
    check('Shift+wheel leaves native horizontal scrolling inside code intact',!shifted.canceled&&!shifted.documentMoved&&shifted.overflowX>0&&shifted.overflowY===0,shifted)
    await wait(70)
    const sizes=await evaluate(()=>[...document.querySelectorAll('.mu-diagram-block > .mu-diagram-preview')].map(x=>({max:getComputedStyle(x).maxHeight,viewport:x.closest('.editor-scroll').clientHeight})))
    check('diagram previews are bounded by the column viewport',sizes.length>=4 && sizes.every(x=>parseFloat(x.max)>0 && parseFloat(x.max)<=x.viewport),sizes)
    await evaluate(()=>{window.__perfProbe.paginationReads=0;document.querySelectorAll('.menu-label')[0].click();window.__menuLatency=[];document.addEventListener('mousemove',event=>{if(!event.target.closest?.('.menu-panel'))return;requestAnimationFrame(()=>window.__menuLatency.push(performance.now()-event.timeStamp))},{capture:true})})
    const rows=await evaluate(()=>[...document.querySelectorAll('.menu-panel > .menu-item')].slice(0,8).map(x=>x.getBoundingClientRect().toJSON()))
    for(let i=0;i<40;i++){const r=rows[i%rows.length];win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(r.left+80),y:Math.round(r.top+r.height/2)});await wait(20)}
    const menu=await evaluate(()=>({times:window.__menuLatency,reads:window.__perfProbe.paginationReads}))
    check('menu hover avoids document pagination',menu.reads===0,menu.reads)
    const sorted=menu.times.sort((a,b)=>a-b)
    check('menu hover paints within 50ms at p95 after graphs settle',sorted.length>=20 && sorted[Math.floor(sorted.length*.95)]<50,{events:sorted.length,p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)})
    await evaluate(()=>document.querySelectorAll('.menu-label')[0].click())
    // A real edit must invalidate the cached extent and keep the final caret visible.
    await evaluate(()=>{window.__inkdownMuya.setContent(window.__inkdownMuya.getMarkdown()+'\n\n'+Array.from({length:40},(_,i)=>'Appended paragraph '+i+' with enough text to occupy another spread.').join('\n\n'),false)})
    await wait(400)
    check('content changes invalidate pagination',await evaluate(()=>window.__perfProbe.paginationReads>0))
    await evaluate(()=>{const editor=window.__inkdownMuya;editor.setCursor({block:editor.editor.scrollPage.lastContentInDescendant(),anchor:{offset:0},focus:{offset:0}})})
    await wait(200)
    check('caret in new content remains reachable',await evaluate(()=>{const r=getSelection().getRangeAt(0).getBoundingClientRect(),b=document.querySelector('.editor-scroll').getBoundingClientRect();return r.left>=b.left && r.right<=b.right}))
    const misaligned=await evaluate(async()=>{
      const editor=window.__inkdownMuya,scroller=document.querySelector('.editor-scroll'),failures=[]
      for(let n=28;n<=36;n++){
        scroller.scrollLeft=0
        editor.setContent(Array.from({length:n},(_,i)=>'Boundary paragraph '+i+'：追加内容后立即跳转末尾，检查最后一页是否对齐。').join('\n\n'),false)
        editor.setCursor({block:editor.editor.scrollPage.lastContentInDescendant(),anchor:{offset:0},focus:{offset:0}})
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
        const stride=(editor.domNode.clientWidth+64)/2,remainder=scroller.scrollLeft%stride
        if(remainder>1 && stride-remainder>1)failures.push({n,scrollLeft:scroller.scrollLeft,stride})
      }
      return failures
    })
    check('an immediate caret jump after appending aligns the final spread',misaligned.length===0,misaligned)
    await evaluate(()=>window.__inkdownCommands.execute('view:toggleColumns'))
    await wait(60)
    check('returning to single column removes the blocking wheel handler',await blockingWheels()===0)
    debuggerApi.detach()
    fs.writeFileSync(path.join(process.env.INKDOWN_PERF_OUTPUT,'results.json'),JSON.stringify(checks,null,2))
    app.exit(checks.every(x=>x.pass)?0:1)
  }).catch(e=>{console.error(e.stack);app.exit(1)})
}
