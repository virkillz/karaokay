import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { openDatabase } from './db/connection'
import { SongsRepo } from './db/songs'
import { HistoryRepo, PlaylistRepo, QueueRepo, SettingsRepo } from './db/repos'
import { Library } from './library/library'
import { Importer } from './library/importer'
import { AlignService } from './align/service'
import { handleMediaProtocol, registerSchemePrivileges } from './protocol'
import { registerIpc, send } from './ipc'
import type { Settings } from '../shared/types'

// KARAOKAY_HOME isolates all data (database + default library) for development and tests.
const HOME = process.env.KARAOKAY_HOME ? path.resolve(process.env.KARAOKAY_HOME) : null
if (HOME) app.setPath('userData', path.join(HOME, 'userdata'))

registerSchemePrivileges()

let mainWindow: BrowserWindow | null = null

// ---- files the OS asks us to open (double-clicked .karaokay packages)
const isPackagePath = (p: string): boolean => p.toLowerCase().endsWith('.karaokay')
/** held until the renderer asks for them; null once it has (later opens are sent straight away) */
let pendingOpens: string[] | null = process.argv.slice(1).filter(isPackagePath)
function openFiles(paths: string[]): void {
  if (paths.length === 0) return
  if (pendingOpens) pendingOpens.push(...paths)
  else send('menu:openFiles', paths)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}
// macOS delivers Finder opens here, possibly before the app is ready
app.on('open-file', (e, file) => {
  e.preventDefault()
  openFiles([file])
})
// Windows/Linux: a second launch passes the file on the command line
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', (_e, argv) => openFiles(argv.slice(1).filter(isPackagePath)))

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Karaokay',
    backgroundColor: '#FFF0F6',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.once('ready-to-show', () => {
    if (!process.env.KARAOKAY_SNAPSHOT) win.show()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('menu:settings', undefined) },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Import Songs…', accelerator: 'CmdOrCtrl+I', click: () => send('menu:import', undefined) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Development aid: KARAOKAY_SNAPSHOT=<png> captures the window and quits. */
async function snapshot(win: BrowserWindow): Promise<void> {
  const out = process.env.KARAOKAY_SNAPSHOT
  if (!out) return
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  await wait(Number(process.env.KARAOKAY_SNAPSHOT_DELAY ?? 2500))
  const script = process.env.KARAOKAY_SNAPSHOT_SCRIPT
  if (script) {
    try {
      const r = await win.webContents.executeJavaScript(script, true)
      if (r !== undefined) console.log('[snapshot-script]', typeof r === 'string' ? r : JSON.stringify(r))
    } catch (e) {
      console.error('[snapshot-script] failed', e)
    }
    await wait(Number(process.env.KARAOKAY_SNAPSHOT_AFTER ?? 1500))
  }
  const img = await win.webContents.capturePage()
  await fs.writeFile(out, img.toPNG())
  app.quit()
}

void app.whenReady().then(async () => {
  // packaged builds take the icon from the app bundle; in development show ours instead of Electron's
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(app.getAppPath(), 'build', 'icon.png'))
  const userData = app.getPath('userData')
  await fs.mkdir(userData, { recursive: true })
  const db = openDatabase(path.join(userData, 'karaokay.db'))
  const defaults: Settings = {
    libraryRoot: HOME ? path.join(HOME, 'library') : path.join(app.getPath('music'), 'Karaokay'),
    importMode: 'copy',
    defaultGuideVocal: 0.3,
    interstitialSeconds: 8,
    focusOnPlay: false,
    volume: 0.85,
    focusTheme: 'party'
  }
  const settings = new SettingsRepo(db, defaults)
  const songs = new SongsRepo(db)
  const library = new Library(songs, () => settings.getAll().libraryRoot, (change) => send('library:changed', change))
  const importer = new Importer(songs, library)
  const aligner = new AlignService()
  registerIpc({
    songs,
    queue: new QueueRepo(db, songs),
    playlists: new PlaylistRepo(db, songs),
    history: new HistoryRepo(db, songs),
    settings,
    library,
    importer,
    aligner,
    setLibraryRoot: async (root) => {
      settings.set('libraryRoot', root)
      library.startWatching()
      await library.scanAll()
    },
    takeOpened: () => {
      const paths = pendingOpens ?? []
      pendingOpens = null
      return paths
    }
  })
  handleMediaProtocol(library, aligner.pickedFiles)
  buildMenu()
  mainWindow = createWindow()
  mainWindow.webContents.once('did-finish-load', () => void snapshot(mainWindow!))

  await fs.mkdir(library.root, { recursive: true }).catch(() => undefined)
  library.startWatching()
  void library.scanAll()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
