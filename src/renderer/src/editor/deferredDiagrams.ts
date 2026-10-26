interface RenderJob {
  target: HTMLElement
  render: () => Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
  visible: boolean
}

/** Keep offscreen/cached-tab diagrams off the input path; render one visible job at a time. */
export class DeferredDiagrams {
  private jobs = new Map<HTMLElement, RenderJob>()
  private observer: IntersectionObserver | null = null
  private mutations: MutationObserver | null = null
  private cancelIdle: (() => void) | null = null
  /** requestIdleCallback 的兜底定时器：空闲迟迟不来时强制渲染一次。 */
  private idleFallbackTimer: number | null = null
  private running = false
  private disposed = false
  /**
   * 最近一次滚动的时间戳。
   *
   * Mermaid 渲染是同步计算（实测单次阻塞主线程 50-57ms）。
   * 若在滚动过程中触发，滚轮事件会排在渲染之后才处理，
   * 表现为「滚轮转了一圈，页面过一会儿才动」。
   * 因此记录滚动时间，滚动静止后才允许渲染。
   */
  private lastScrollAt = 0
  private scrollQuietTimer: number | null = null
  private scrollListening = false
  private onScroll = (): void => {
    this.lastScrollAt = DeferredDiagrams.now()
  }

  /** 滚动停止多久后才允许渲染图表（毫秒）。 */
  private static readonly SCROLL_QUIET_MS = 160

  /** 取时间戳；单测环境的 window 替身可能没有 performance。 */
  private static now(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  }

  constructor(private root: HTMLElement) {
    if (typeof IntersectionObserver === 'undefined') return
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const job = this.jobs.get(entry.target as HTMLElement)
        if (job) job.visible = entry.isIntersecting
      }
      this.arm()
    }, { root: root.parentElement, rootMargin: '240px' })
    this.mutations = new MutationObserver(() => {
      for (const [target, job] of this.jobs) {
        if (!root.contains(target)) {
          this.jobs.delete(target)
          this.observer?.unobserve(target)
          job.resolve()
        }
      }
      this.arm()
    })
    this.mutations.observe(root, { childList: true, subtree: true })
    // 滚动事件不冒泡，用捕获阶段监听；passive 保证不拖慢滚动本身。
    // 单测环境用的是最小 window 替身（可能没有 addEventListener），因此做能力判断。
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('scroll', this.onScroll, { passive: true, capture: true })
      this.scrollListening = true
    }
  }

  schedule(target: HTMLElement, render: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    // Preserve the standalone editor fallback where IntersectionObserver is unavailable.
    if (!this.observer) return Promise.resolve().then(() => { if (!this.disposed) return render() })
    const old = this.jobs.get(target)
    old?.resolve()
    // Re-observing an already observed target does not produce an initial entry.
    // Reset observation when replacing queued source so visibility cannot stall.
    if (old) this.observer.unobserve(target)
    return new Promise<void>((resolve, reject) => {
      this.jobs.set(target, { target, render, resolve, reject, visible: false })
      this.observer!.observe(target)
    })
  }

  private arm(): void {
    if (this.disposed || this.running || this.cancelIdle || !this.root.isConnected) return
    if (![...this.jobs.values()].some(job => job.visible)) return

    // 滚动静止前不渲染：Mermaid 同步渲染会阻塞主线程数十毫秒，
    // 期间滚轮与 hover 事件都排在后面，正是「延迟才动」的来源。
    const quietFor = DeferredDiagrams.now() - this.lastScrollAt
    if (quietFor < DeferredDiagrams.SCROLL_QUIET_MS) {
      if (this.scrollQuietTimer == null) {
        this.scrollQuietTimer = window.setTimeout(() => {
          this.scrollQuietTimer = null
          this.arm()
        }, DeferredDiagrams.SCROLL_QUIET_MS - quietFor + 8)
      }
      return
    }

    const run = () => {
      this.cancelIdle = null
      // 兜底定时器也一并清掉，避免它稍后再触发一次
      if (this.idleFallbackTimer != null) {
        window.clearTimeout(this.idleFallbackTimer)
        this.idleFallbackTimer = null
      }
      if (this.disposed || !this.root.isConnected) return
      const job = [...this.jobs.values()].find(job => job.visible && this.root.contains(job.target))
      if (!job) return
      this.jobs.delete(job.target)
      this.observer?.unobserve(job.target)
      this.running = true
      Promise.resolve().then(job.render).then(job.resolve, job.reject).finally(() => {
        this.running = false
        this.arm()
      })
    }
    if (typeof window.requestIdleCallback === 'function') {
      // 用 requestIdleCallback 挑空闲时机，但**必须**配一个兜底超时。
      //
      // 只写 requestIdleCallback(run) 而不给 timeout 会死锁：
      // 页面持续有动画/滚动时浏览器可能长时间不给空闲回调，
      // 于是 cancelIdle 一直非空，arm() 每次都在开头 early-return，
      // 图表永远停在「加载中...」（实测踩到过：打包版与开发版都渲不出 SVG）。
      // 兜底超时只在空闲迟迟不来时强制渲染一次，正常情况仍走空闲。
      const id = window.requestIdleCallback(run, { timeout: 800 })
      this.cancelIdle = () => window.cancelIdleCallback(id)
      this.idleFallbackTimer = window.setTimeout(() => {
        if (this.cancelIdle === null) return
        window.cancelIdleCallback(id)
        this.cancelIdle = null
        this.idleFallbackTimer = null
        run()
      }, 1200)
    } else {
      const id = window.setTimeout(run, 0)
      this.cancelIdle = () => window.clearTimeout(id)
    }
  }

  dispose(): void {
    this.disposed = true
    this.cancelIdle?.()
    this.cancelIdle = null
    if (this.idleFallbackTimer != null) {
      window.clearTimeout(this.idleFallbackTimer)
      this.idleFallbackTimer = null
    }
    if (this.scrollQuietTimer != null) {
      window.clearTimeout(this.scrollQuietTimer)
      this.scrollQuietTimer = null
    }
    if (this.scrollListening && typeof window.removeEventListener === 'function') {
      window.removeEventListener('scroll', this.onScroll, { capture: true })
    }
    this.scrollListening = false
    this.observer?.disconnect()
    this.mutations?.disconnect()
    for (const job of this.jobs.values()) job.resolve()
    this.jobs.clear()
  }
}
