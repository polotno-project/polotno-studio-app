// The hidden background removal page (src/main/background-host.ts): it only
// takes jobs from main and answers them.
import { contextBridge, ipcRenderer } from 'electron'
import type { HostJob, HostResult } from '../shared/background-host'

const backgroundHost = {
  onJob(listener: (job: HostJob) => void): void {
    ipcRenderer.on('background-host:job', (_event, job: HostJob) => listener(job))
  },
  onCancel(listener: (id: string) => void): void {
    ipcRenderer.on('background-host:cancel', (_event, id: string) => listener(id))
  },
  ready(): void {
    ipcRenderer.send('background-host:ready')
  },
  result(result: HostResult): void {
    ipcRenderer.send('background-host:result', result)
  }
}

export type BackgroundHostApi = typeof backgroundHost

contextBridge.exposeInMainWorld('backgroundHost', backgroundHost)
