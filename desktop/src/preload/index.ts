import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('assessment', { predict: (input: unknown) => ipcRenderer.invoke('assessment:predict', input) })

