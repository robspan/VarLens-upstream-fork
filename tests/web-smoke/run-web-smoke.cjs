#!/usr/bin/env node

const { existsSync } = require('fs')
const { resolve } = require('path')
const { spawnSync } = require('child_process')

const command = process.argv[2] ?? 'run'
const passThroughArgs = process.argv.slice(3)
const rootDir = resolve(__dirname, '../..')
const cypressBin = resolve(
  __dirname,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'cypress.cmd' : 'cypress'
)

if (!existsSync(cypressBin)) {
  console.error(
    [
      'VarLens web-smoke dependencies are not installed.',
      'Run:',
      '  npm --prefix tests/web-smoke ci',
      '  npm --prefix tests/web-smoke exec -- cypress install'
    ].join('\n')
  )
  process.exit(1)
}

const modeArgs =
  command === 'open'
    ? ['open', '--config-file', 'tests/web-smoke/cypress.config.cjs', '--e2e']
    : [
        'run',
        '--config-file',
        'tests/web-smoke/cypress.config.cjs',
        '--e2e',
        '--browser',
        'electron'
      ]

const result = spawnSync(cypressBin, [...modeArgs, ...passThroughArgs], {
  cwd: rootDir,
  env: process.env,
  stdio: 'inherit'
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
