import { basenames, zipBatchPath, type IpcScenario } from './shared'

export const batchImportScenario: IpcScenario = {
  area: 'batch-import',
  run: async (ctx) => {
    const extracted = await ctx.call<{ files: string[]; errors: string[] }>(
      'batchImport',
      'extractZip',
      [zipBatchPath()]
    )
    await ctx.call('batchImport', 'cleanupZipTemp')
    return [{ errors: extracted.errors, files: basenames(extracted.files) }]
  }
}
