import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTests } from '@vscode/test-electron'

const here = path.dirname(fileURLToPath(import.meta.url))
const extensionDevelopmentPath = path.resolve(here, '..', '..')
const extensionTestsPath = path.resolve(here, 'suite', 'index.cjs')
const workspacePath = path.resolve(here, 'workspace', 'multi.code-workspace')

// Codex itself may run inside a VS Code extension host, which exports this
// flag. Inheriting it would make the downloaded Electron binary behave like
// plain Node and reject every VS Code CLI option.
delete process.env.ELECTRON_RUN_AS_NODE

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  })
} catch (error) {
  console.error('VS Code integration tests failed:', error)
  process.exitCode = 1
}
