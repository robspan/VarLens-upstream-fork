import { Project } from 'ts-morph'
import { resolve } from 'path'

let cached: Project | null = null

export function getProject(): Project {
  if (cached) return cached
  cached = new Project({
    tsConfigFilePath: resolve(process.cwd(), 'tsconfig.node.json'),
    skipAddingFilesFromTsConfig: false
  })
  return cached
}

export function relPath(absPath: string): string {
  const cwd = process.cwd().endsWith('/') ? process.cwd() : process.cwd() + '/'
  return absPath.startsWith(cwd) ? absPath.slice(cwd.length) : absPath
}
