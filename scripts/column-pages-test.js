const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const root=process.env.INKDOWN_PAGES_ROOT||path.resolve(__dirname,'..')
if(!process.versions.electron){
  const {spawn}=require('node:child_process')
  const output=process.env.INKDOWN_PAGES_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'inkdown-pages-'))
  fs.mkdirSync(output,{recursive:true})
  const env={...process.env,INKDOWN_PAGES_ROOT:root,INKDOWN_PAGES_OUTPUT:output,INKDOWN_NO_SESSION_RESTORE:'1',INKDOWN_NO_SESSION_PERSIST:'1'}
  for(const name of Object.keys(env))if(/^INKDOWN_.*(?:CHECK|TEST|PROBE|SCREENSHOT|SHOT_)/.test(name))delete env[name]
  delete env.ELECTRON_RUN_AS_NODE
  const runner=path.join(output,'pages-runner.cjs');fs.copyFileSync(__filename,runner)
  const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[runner,'--user-data-dir='+path.join(output,'profile')],{cwd:root,env,stdio:'inherit'})
  const timer=setTimeout(()=>{child.kill();process.exitCode=1},90000)
  child.on('error',e=>{clearTimeout(timer);console.error(e);process.exitCode=1})
  child.on('exit',code=>{clearTimeout(timer);let passed=false;try{const r=JSON.parse(fs.readFileSync(path.join(output,'results.json'),'utf8'));passed=r.completed&&r.checks.length>=15&&r.checks.every(x=>x.pass)}catch{}console.log('Pages evidence: '+output);process.exitCode=code===0&&passed?0:1})
}else{
  const {app,BrowserWindow,session}=require('electron'),wait=ms=>new Promise(r=>setTimeout(r,ms))
  app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true})))
  require(path.join(root,'out/main/index.js'))
  app.whenReady().then(async()=>{
    let win
    for(let i=0;i<120;i++){win=BrowserWindow.getAllWindows()[0];if(win&&await win.webContents.executeJavaScript('!!window.__inkdownMuya&&!!window.__inkdownApp?.tabs().length&&!!window.__inkdownCommands').catch(()=>false))break;await wait(100)}
    win.webContents.setBackgroundThrottling(false);win.setSize(1480,900);await wait(250)
    const run=fn=>win.webContents.executeJavaScript('('+fn.toString()+')()')
    const checks=await run(async()=>{
      const checks=[],check=(name,pass,detail)=>checks.push({name,pass,detail}),wait=ms=>new Promise(r=>setTimeout(r,ms))
      window.__inkdownApp.settings().autoSave=false
      window.__inkdownLoad('# Adjacent pages\n\n'+Array.from({length:100},(_,i)=>'Paragraph '+String(i+1).padStart(3,'0')+'：左页读完接右页，向下翻一页后原来的右页成为新的左页。 Both pages remain editable.').join('\n\n'))
      await wait(100);await window.__inkdownCommands.execute('view:toggleColumns');await wait(180)
      const editor=window.__inkdownMuya,scroller=document.querySelector('.editor-scroll'),original=editor.getMarkdown()
      const read=()=>{
        const b=scroller.getBoundingClientRect(),mid=b.left+b.width/2,left=[],right=[]
        for(const p of editor.domNode.querySelectorAll('.mu-paragraph')){const r=p.getBoundingClientRect();if(r.left>=b.left&&r.right<=b.right+1&&r.top>=b.top&&r.top<b.bottom)(r.left<mid?left:right).push(p.textContent)}
        return {left,right,scroll:scroller.scrollLeft,label:document.querySelector('.columns-pager')?.textContent}
      }
      const wheel=async delta=>{scroller.dispatchEvent(new WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true}));await wait(65);return read()}
      const first=read(),step=(editor.domNode.clientWidth+64)/2
      check('initial view shows adjacent pages 1-2',/1\s*[–—-]\s*2/.test(first.label)&&first.left.length>0&&first.right.length>0,first.label)
      const second=await wheel(120)
      check('wheel changes 1-2 to 2-3',/2\s*[–—-]\s*3/.test(second.label),second.label)
      check('old right page becomes the entire new left page',JSON.stringify(second.left)===JSON.stringify(first.right),{before:first.right.map(x=>x.slice(0,13)),after:second.left.map(x=>x.slice(0,13))})
      check('one wheel notch advances exactly one column width',Math.abs(second.scroll-step)<1,{actual:second.scroll,step})
      const third=await wheel(120)
      check('next notch changes 2-3 to 3-4',/3\s*[–—-]\s*4/.test(third.label)&&JSON.stringify(third.left)===JSON.stringify(second.right),third.label)
      const back=await wheel(-120)
      check('reverse wheel returns the previous adjacent pair',JSON.stringify(back.left)===JSON.stringify(second.left)&&JSON.stringify(back.right)===JSON.stringify(second.right),back.label)
      await wheel(-120);const clamped=await wheel(-120)
      check('wheel at beginning stays on pages 1-2',Math.abs(clamped.scroll)<1&&/1\s*[–—-]\s*2/.test(clamped.label),clamped)
      document.querySelector('.columns-pager button:last-child').click();await wait(60)
      check('next button also advances one page',JSON.stringify(read().left)===JSON.stringify(first.right),read().label)
      document.querySelector('.columns-pager button:first-of-type').click();await wait(60)
      check('previous button returns one page',JSON.stringify(read().left)===JSON.stringify(first.left),read().label)
      for(let i=0;i<4;i++)scroller.dispatchEvent(new WheelEvent('wheel',{deltaY:12,bubbles:true,cancelable:true}));await wait(70)
      check('small touchpad deltas accumulate into one full page',Math.abs(scroller.scrollLeft-step)<1,scroller.scrollLeft)
      for(let i=0;i<3;i++)scroller.dispatchEvent(new WheelEvent('wheel',{deltaY:12,bubbles:true,cancelable:true}))
      for(let i=0;i<4;i++)scroller.dispatchEvent(new WheelEvent('wheel',{deltaY:-12,bubbles:true,cancelable:true}));await wait(70)
      check('reversing a small gesture clears old direction and returns one page',Math.abs(scroller.scrollLeft)<1,scroller.scrollLeft)
      for(let i=0;i<40&&!document.querySelector('.columns-pager button:last-child').disabled;i++){document.querySelector('.columns-pager button:last-child').click();await wait(20)}
      const last=read(),lastOffset=last.scroll;await wheel(120)
      check('last view has two actual pages and next is disabled',last.left.length>0&&last.right.length>0&&document.querySelector('.columns-pager button:last-child').disabled,last.label)
      check('wheel at end cannot create an empty extra page',scroller.scrollLeft===lastOffset,scroller.scrollLeft)
      const firstId=window.__inkdownApp.activeTab().id
      await window.__inkdownCommands.execute('file:new');await wait(60)
      window.__inkdownLoad('# Short second tab\n\nOne page only.');await wait(90)
      const shortId=window.__inkdownApp.activeTab().id
      window.__inkdownApp.setActive(firstId);await wait(180)
      check('returning from a short tab restores the previous late page pair',Math.abs(scroller.scrollLeft-lastOffset)<1&&JSON.stringify(read().left)===JSON.stringify(last.left),{before:lastOffset,after:scroller.scrollLeft,label:read().label})
      window.__inkdownApp.setActive(shortId);await wait(70)
      window.__inkdownApp.setActive(firstId)
      for(let i=0;i<4;i++)await Promise.resolve()
      window.__inkdownApp.setActive(shortId)
      for(let i=0;i<4;i++)await Promise.resolve()
      await wait(70);window.__inkdownApp.setActive(firstId);await wait(150)
      check('rapid switching before a restore frame preserves the saved page',Math.abs(scroller.scrollLeft-lastOffset)<1,{before:lastOffset,after:scroller.scrollLeft,label:read().label})
      scroller.scrollLeft=0;await wait(60)
      const pageThree=[...editor.domNode.querySelectorAll('.mu-paragraph')].find(p=>p.textContent===second.right[0])
      const pageThreeBlock=pageThree?.querySelector('.mu-content')?.__MUYA_BLOCK__
      if(pageThreeBlock){editor.setCursor({block:pageThreeBlock,anchor:{offset:0},focus:{offset:0}});await wait(100)}
      check('caret entering page 3 keeps page 2 on the left',!!pageThreeBlock&&/2\s*[–—-]\s*3/.test(read().label),read().label)
      check('paging leaves Markdown unchanged',editor.getMarkdown()===original)
      const lastBlock=editor.editor.scrollPage.lastContentInDescendant()
      scroller.scrollLeft=0;editor.setCursor({block:lastBlock,anchor:{offset:0},focus:{offset:0}});await wait(100)
      const caret=getSelection().getRangeAt(0).getBoundingClientRect(),bounds=scroller.getBoundingClientRect()
      check('last-page caret is still revealed in a full pair',caret.left>=bounds.left&&caret.right<=bounds.right&&Math.abs(scroller.scrollLeft/step-Math.round(scroller.scrollLeft/step))<.01,{caret:caret.left,scroll:scroller.scrollLeft,step})
      scroller.scrollLeft=0
      const immediately=await wheel(120)
      check('wheel immediately after a scroll reset uses the actual visible page',/2\s*[–—-]\s*3/.test(immediately.label)&&Math.abs(immediately.scroll-step)<1,immediately.label)
      window.__pagesOriginal=original
      return checks
    })
    for(const result of checks)console.log(JSON.stringify(result))
    const printed=checks.length
    // Horizontal gestures should settle on a complete page as well.
    await run(()=>{document.querySelector('.editor-scroll').scrollLeft=window.__inkdownMuya.domNode.clientWidth*.33})
    await wait(180)
    const snapped=await run(()=>{const s=document.querySelector('.editor-scroll'),step=(window.__inkdownMuya.domNode.clientWidth+64)/2;return {scroll:s.scrollLeft,step}})
    checks.push({name:'horizontal scrolling settles on a complete page',pass:Math.abs(snapped.scroll/snapped.step-Math.round(snapped.scroll/snapped.step))<.01,detail:snapped})
    win.setSize(1320,800);await wait(180)
    const resized=await run(()=>{const s=document.querySelector('.editor-scroll'),step=(window.__inkdownMuya.domNode.clientWidth+64)/2;return {scroll:s.scrollLeft,step,active:s.classList.contains('is-columns')}})
    checks.push({name:'resizing keeps pages aligned',pass:resized.active&&Math.abs(resized.scroll/resized.step-Math.round(resized.scroll/resized.step))<.01,detail:resized})
    await run(()=>{const s=document.querySelector('.editor-scroll');s.scrollLeft=0;s.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}))});await wait(130)
    fs.writeFileSync(path.join(process.env.INKDOWN_PAGES_OUTPUT,'pages-2-3.png'),(await win.webContents.capturePage()).toPNG())
    await run(()=>{window.__inkdownLoad('# Single page\n\nA short document');return true});await wait(150)
    checks.push({name:'short documents stay on their only page',pass:await run(()=>{const s=document.querySelector('.editor-scroll'),before=s.scrollLeft;s.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}));return s.scrollLeft===before&&document.querySelector('.columns-pager button:last-child').disabled})})
    for(const result of checks.slice(printed))console.log(JSON.stringify(result))
    fs.writeFileSync(path.join(process.env.INKDOWN_PAGES_OUTPUT,'results.json'),JSON.stringify({completed:true,checks},null,2))
    app.exit(checks.every(x=>x.pass)?0:1)
  }).catch(e=>{console.error(e.stack);app.exit(1)})
}
