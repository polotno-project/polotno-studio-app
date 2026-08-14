import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { createEditorWindow } from '../window'
import { registerIpcHandlers } from '../ipc'
import { initBridgeRouter, execAppCommand, execCommand } from '../bridge-router'

// Headless CLI: `polotno render a.json [b.json …] -o out.png|dir/` and
// `polotno lint design.json [--json]`. Runs its own short-lived instance with
// an isolated userData (Chromium locks the profile, so it must not collide
// with a running GUI instance), a hidden editor window, and no MCP server.
//
// Exit codes: 0 ok, 1 render failure, 2 bad arguments, 3 invalid design JSON,
// 4 lint reported errors (lint command only).

interface CliOptions {
  command: 'render' | 'lint'
  inputs: string[]
  output: string | null
  page: number | null
  pixelRatio: number
  format: 'png' | 'jpeg' | 'pdf' | null
  json: boolean
}

class CliError extends Error {
  constructor(
    public exitCode: number,
    message: string
  ) {
    super(message)
  }
}

// app.exit does not stop execution, so failures throw and the top-level
// handler exits exactly once with the right code.
function fail(code: number, message: string): never {
  throw new CliError(code, message)
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    command: args[0] as CliOptions['command'],
    inputs: [],
    output: null,
    page: null,
    pixelRatio: 2,
    format: null,
    json: false
  }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-o' || arg === '--output') options.output = args[++i]
    else if (arg === '--page') options.page = Number(args[++i])
    else if (arg === '--pixel-ratio') options.pixelRatio = Number(args[++i])
    else if (arg === '--format') options.format = args[++i] as CliOptions['format']
    else if (arg === '--json') options.json = true
    else if (arg.startsWith('-')) fail(2, `Unknown option: ${arg}`)
    else options.inputs.push(arg)
  }
  if (options.inputs.length === 0) fail(2, `Usage: polotno ${options.command} <design.json…> [-o out]`)
  return options
}

async function waitForRenderer(timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  for (;;) {
    const result = await execAppCommand({ type: 'list_tabs' }, 2000)
    if (result.ok) return
    if (Date.now() - start > timeoutMs) fail(1, 'The renderer did not become ready')
    await new Promise((r) => setTimeout(r, 250))
  }
}

function outputFormat(options: CliOptions): 'png' | 'jpeg' | 'pdf' {
  if (options.format) return options.format
  const ext = options.output ? extname(options.output).toLowerCase() : ''
  if (ext === '.jpg' || ext === '.jpeg') return 'jpeg'
  if (ext === '.pdf') return 'pdf'
  return 'png'
}

async function loadDesignTab(filePath: string): Promise<string> {
  let json: unknown
  try {
    json = JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    fail(3, `${filePath}: not valid JSON (${String(error)})`)
  }
  const created = await execAppCommand({ type: 'create_tab', json, activate: false }, 60000)
  if (!created.ok) fail(3, `${filePath}: ${created.error.code}: ${created.error.message}`)
  return (created.value as { designId: string }).designId
}

async function runRender(options: CliOptions): Promise<number> {
  const format = outputFormat(options)
  const multi = options.inputs.length > 1
  const outIsDir = multi || (options.output ? !extname(options.output) : true)
  const outDir = outIsDir ? resolve(options.output ?? '.') : null
  if (outDir) await fs.mkdir(outDir, { recursive: true })

  for (const input of options.inputs) {
    const designId = await loadDesignTab(input)
    const pageArg =
      options.page !== null ? { pageIndex: options.page - 1 } : ({} as { pageIndex?: number })
    const info = await execCommand(designId, { type: 'get_info' }, 60000)
    if (!info.ok) fail(1, `${input}: ${info.error.message}`)
    const pages = (info.value as { pages: { id: string }[] }).pages
    let pageId: string | undefined
    if (pageArg.pageIndex !== undefined) {
      const page = pages[pageArg.pageIndex]
      if (!page) fail(2, `${input}: page ${options.page} does not exist (${pages.length} pages)`)
      pageId = page.id
    }

    const result = await execCommand(
      designId,
      { type: 'export', format, pixelRatio: options.pixelRatio, pageId },
      300000
    )
    if (!result.ok) fail(1, `${input}: ${result.error.code}: ${result.error.message}`)
    const { pages: rendered } = result.value as { pages: { dataUrl: string }[] }

    const stem = basename(input).replace(/\.(json|polotno)$/i, '')
    const ext = format === 'jpeg' ? 'jpg' : format
    for (const [index, page] of rendered.entries()) {
      const suffix = rendered.length > 1 ? `-${index + 1}` : ''
      const target = outDir
        ? join(outDir, `${stem}${suffix}.${ext}`)
        : rendered.length > 1
          ? options.output!.replace(/(\.[a-z]+)$/i, `${suffix}$1`)
          : options.output!
      await fs.writeFile(target, Buffer.from(page.dataUrl.split(',')[1], 'base64'))
      console.error(`rendered ${target}`)
    }
  }
  return 0
}

async function runLint(options: CliOptions): Promise<number> {
  let hasErrors = false
  const reports: { file: string; findings: unknown[] }[] = []
  for (const input of options.inputs) {
    const designId = await loadDesignTab(input)
    const result = await execCommand(designId, { type: 'lint' }, 120000)
    if (!result.ok) fail(1, `${input}: ${result.error.message}`)
    const findings = result.value as { severity: string; rule: string; message: string }[]
    reports.push({ file: input, findings })
    hasErrors ||= findings.some((f) => f.severity === 'error')
    if (!options.json) {
      console.error(`${input}: ${findings.length} finding(s)`)
      for (const f of findings) console.error(`  [${f.severity}] ${f.rule}: ${f.message}`)
    }
  }
  if (options.json) console.log(JSON.stringify(reports, null, 2))
  return hasErrors ? 4 : 0
}

export function runCli(args: string[]): void {
  let options: CliOptions
  try {
    options = parseArgs(args)
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message)
      app.exit(error.exitCode)
      return
    }
    throw error
  }
  // Isolated profile: Chromium locks userData, and the GUI app may be running.
  app.setPath('userData', join(tmpdir(), `polotno-cli-${process.pid}`))

  void app.whenReady().then(async () => {
    app.dock?.hide()
    registerIpcHandlers()
    initBridgeRouter()
    createEditorWindow({ hidden: true })
    try {
      await waitForRenderer()
      const code = options.command === 'render' ? await runRender(options) : await runLint(options)
      app.exit(code)
    } catch (error) {
      if (error instanceof CliError) {
        console.error(error.message)
        app.exit(error.exitCode)
      } else {
        console.error(String(error))
        app.exit(1)
      }
    }
  })
}
