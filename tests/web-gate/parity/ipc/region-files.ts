import { bedFilePath, type IpcScenario } from './shared'

export const regionFilesScenario: IpcScenario = {
  area: 'region-files',
  run: async (ctx) => {
    const file = (await ctx.call('regionFiles', 'create', [
      'IPC parity regions',
      'chr22 synthetic parity regions'
    ])) as { id: number }
    return [
      file,
      await ctx.call('regionFiles', 'importBed', [file.id, bedFilePath()]),
      await ctx.call('regionFiles', 'list')
    ]
  }
}
