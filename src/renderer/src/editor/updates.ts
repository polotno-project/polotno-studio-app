import { toast } from 'sonner'
import type { UpdateStatus } from '../../../shared/ipc-contract'

// The updater's status (src/main/updater.ts) as one toast. A check the person
// asked for shows every step and its outcome; a background check stays silent
// until the update is downloaded and ready to install.

const TOAST_ID = 'update'

function show(status: UpdateStatus): void {
  if (status.state === 'ready') {
    toast(`Polotno ${status.version} is ready`, {
      id: TOAST_ID,
      description: 'It installs when you quit.',
      duration: Infinity,
      closeButton: true,
      action: { label: 'Restart', onClick: () => void window.desktop.invoke('update:install') }
    })
    return
  }
  if (!status.userAsked) {
    toast.dismiss(TOAST_ID)
    return
  }
  switch (status.state) {
    case 'idle':
      toast.dismiss(TOAST_ID)
      break
    case 'checking':
      toast.loading('Checking for updates…', { id: TOAST_ID })
      break
    case 'downloading':
      toast.loading(`Downloading Polotno ${status.version}… ${status.percent}%`, { id: TOAST_ID })
      break
    case 'upToDate':
      toast.success('You’re up to date', {
        id: TOAST_ID,
        description: `Polotno ${status.version} is the latest version.`
      })
      break
    case 'error':
      toast.error('Could not update', {
        id: TOAST_ID,
        description: status.message,
        duration: Infinity,
        closeButton: true
      })
      break
  }
}

export function initUpdateToasts(): () => void {
  void window.desktop.invoke('update:getStatus').then(show)
  return window.desktop.on('update:status', show)
}
