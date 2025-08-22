export type IpcAction =
  | {type: 'ping'}
  | {type: 'pong'; isVideoMode: boolean; elapsed: number}
  | {type: 'play'; elapsed: number}
  | {type: 'video-send-video-time'; elapsed: number; duration: number}

export type IpcMessage = IpcAction & IpcMeta

export interface IpcMeta {
  ipcId: string
  dynamicMockedTime: string | null
}
