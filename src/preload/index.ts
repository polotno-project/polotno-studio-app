import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { InvokeApi, MainEvents, RendererEvents } from '../shared/ipc-contract'

type Invoke = <C extends keyof InvokeApi>(
  channel: C,
  ...args: Parameters<InvokeApi[C]>
) => Promise<ReturnType<InvokeApi[C]>>

const desktop = {
  platform: process.platform,

  invoke: ((channel, ...args) => ipcRenderer.invoke(channel, ...args)) as Invoke,

  on<C extends keyof MainEvents>(channel: C, listener: (payload: MainEvents[C]) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: MainEvents[C]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  send<C extends keyof RendererEvents>(channel: C, payload: RendererEvents[C]): void {
    ipcRenderer.send(channel, payload)
  }
}

export type DesktopApi = typeof desktop

contextBridge.exposeInMainWorld('desktop', desktop)
