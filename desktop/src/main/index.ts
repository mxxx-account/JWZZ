import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'

let engineProcess: ChildProcess | undefined
const root = (): string => process.env.DKD_PROJECT_ROOT ?? path.resolve(__dirname, '../../..')
const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForEngine(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { if ((await fetch('http://127.0.0.1:8765/health')).ok) return } catch { /* engine is loading */ }
    await sleep(250)
  }
  throw new Error('本地预测引擎启动失败，请确认模型文件和 Python 环境完整。')
}

async function startEngine(): Promise<void> {
  if (engineProcess) return
  if (app.isPackaged) throw new Error('打包版 Python 引擎尚未配置；请先使用开发模式运行。')
  const projectRoot = root()
  engineProcess = spawn(path.join(projectRoot, '.venv', 'Scripts', 'python.exe'), [path.join(projectRoot, 'backend', 'app.py')], { cwd: projectRoot, windowsHide: true, stdio: 'ignore' })
  engineProcess.once('exit', () => { engineProcess = undefined })
  await waitForEngine()
}

function createWindow(): void {
  const window = new BrowserWindow({ width: 1040, minWidth: 900, height: 780, minHeight: 650, webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  await startEngine()
  ipcMain.handle('assessment:predict', async (_event, payload: unknown) => {
    const response = await fetch('http://127.0.0.1:8765/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const body = await response.json()
    if (!response.ok) throw new Error(body.detail?.[0]?.msg ?? '输入数据不符合要求。')
    return body
  })
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { engineProcess?.kill() })

