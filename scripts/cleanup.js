/**
 * 启动前的环境清理：结束残留的应用进程。
 *
 * 应用把会话、设置等存进 localStorage（底层是 leveldb），leveldb 会加文件锁。
 * 若之前跑过的打包版或中断的测试留下进程，仍持有锁，新启动就读不到数据，
 * 表现为「会话恢复失败」这类看似功能坏掉、实为环境被占的问题。
 *
 * 用法（在各测试脚本的启动逻辑前调用）：
 *   const { killStaleProcesses } = require('./cleanup')
 *   killStaleProcesses()
 */
const { execFileSync } = require('child_process')

/** 结束残留的 Inkdown / electron 进程，并等待文件锁释放。 */
function killStaleProcesses(waitMs = 3000) {
  if (process.platform === 'win32') {
    for (const name of ['Inkdown.exe', 'electron.exe']) {
      try {
        execFileSync('taskkill', ['/F', '/IM', name, '/T'], { stdio: 'ignore' })
      } catch {
        // 没有该进程时 taskkill 返回非 0，属于正常情况
      }
    }
  }
  // 同步等待，确保锁已释放再启动新进程
  const until = Date.now() + waitMs
  while (Date.now() < until) {
    /* busy wait */
  }
}

module.exports = { killStaleProcesses }
