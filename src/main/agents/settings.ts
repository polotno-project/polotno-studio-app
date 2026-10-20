import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// Small per-app choices (which agent, which model) kept across launches, one
// JSON file each in the app's data folder.

const file = (name: string): string => join(app.getPath('userData'), `${name}.json`)

export async function readSetting<T>(name: string): Promise<Partial<T>> {
  try {
    return JSON.parse(await fs.readFile(file(name), 'utf8'))
  } catch {
    return {}
  }
}

export async function writeSetting<T>(name: string, value: T): Promise<void> {
  await fs.writeFile(file(name), JSON.stringify(value), 'utf8')
}
