import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { INVOKE_PREFIXES, type PreloadApi } from '../shared/ipc'

const EVENTS = ['library:changed', 'importer:progress', 'menu:import', 'menu:settings', 'lyrics:progress', 'package:progress', 'menu:openFiles']

const api: PreloadApi = {
  invoke: ((channel: string, ...args: unknown[]) => {
    if (!INVOKE_PREFIXES.some((p) => channel.startsWith(p))) return Promise.reject(new Error(`blocked channel ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  }) as PreloadApi['invoke'],
  on: ((event: string, cb: (payload: unknown) => void) => {
    if (!EVENTS.includes(event)) throw new Error(`blocked event ${event}`)
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }) as PreloadApi['on'],
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
