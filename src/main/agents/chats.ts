import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import type { AgentEntry, AgentEvent, ChatRef, ChatSummary } from '../../shared/agent'
import type { DocId } from '../../shared/types'
import { readLocalImage, type LocalImage } from '../../mcp-server/local-image'
import { documents } from '../documents'

// The AI panel's chats, per design: each one the feed the user saw (prompts,
// replies, tool steps). Kept by the app in its own data folder, one file per
// design file, never in the agents' own history: continuing an old chat (after
// a restart, a switch to another chat or another agent) starts a fresh agent
// conversation that reads this transcript first. The design itself is the
// source of truth the agent re-reads anyway.

export type Chat = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  entries: AgentEntry[]
}

type Book = {
  // The design file the chats belong to; null until the design is saved.
  filePath: string | null
  chats: Chat[]
  // The chat the next message goes to; null: a new one.
  activeId: string | null
}

const books = new Map<DocId, Book>()
const pendingSaves = new Map<DocId, NodeJS.Timeout>()
let listener: ((docId: DocId) => void) | null = null

const dir = (): string => join(app.getPath('userData'), 'chats')
const fileFor = (filePath: string): string =>
  join(dir(), `${createHash('sha1').update(filePath).digest('hex')}.json`)

// Generated images are copied next to the chats, one file per feed entry, so
// "Add to design" still works in a chat reopened after a restart (the agent's
// own copy lives in its memory or a folder it may clear).
const imagesDir = (): string => join(dir(), 'images')
const imageBase = (entryId: string): string =>
  createHash('sha1').update(entryId).digest('hex').slice(0, 32)

export async function keepChatImage(entryId: string, path: string): Promise<void> {
  await fs.mkdir(imagesDir(), { recursive: true })
  await fs.copyFile(path, join(imagesDir(), imageBase(entryId) + extname(path).toLowerCase()))
}

async function imageFile(entryId: string): Promise<string | null> {
  const base = imageBase(entryId)
  const names = await fs.readdir(imagesDir()).catch(() => [] as string[])
  const name = names.find((item) => item.startsWith(base + '.'))
  return name ? join(imagesDir(), name) : null
}

export async function chatImage(entryId: string): Promise<LocalImage | null> {
  const file = await imageFile(entryId)
  return file ? readLocalImage(file) : null
}

async function dropImages(chats: Chat[]): Promise<void> {
  const bases = new Set(
    chats.flatMap((chat) =>
      chat.entries.filter((entry) => entry.kind === 'image').map((entry) => imageBase(entry.id))
    )
  )
  if (!bases.size) return
  const names = await fs.readdir(imagesDir()).catch(() => [] as string[])
  await Promise.all(
    names
      .filter((name) => bases.has(name.split('.')[0]))
      .map((name) => fs.rm(join(imagesDir(), name), { force: true }))
  )
}

// Told whenever a design's list of chats (or which one is open) changes.
export function onChatsChanged(callback: (docId: DocId) => void): void {
  listener = callback
}

const loading = new Map<DocId, Promise<Book>>()

// Loaded once per open design; concurrent callers share the read.
function load(docId: DocId): Promise<Book> {
  const known = books.get(docId)
  if (known) return Promise.resolve(known)
  let pending = loading.get(docId)
  if (!pending) {
    pending = read(documents.get(docId)?.filePath ?? null).then((chats) => {
      loading.delete(docId)
      // Reopened: the most recent chat is the one on screen.
      const book: Book = {
        filePath: documents.get(docId)?.filePath ?? null,
        chats,
        activeId: latest(chats)?.id ?? null
      }
      books.set(docId, book)
      return book
    })
    loading.set(docId, pending)
  }
  return pending
}

async function read(filePath: string | null): Promise<Chat[]> {
  if (!filePath) return []
  try {
    return JSON.parse(await fs.readFile(fileFor(filePath), 'utf8')).chats ?? []
  } catch {
    // No chats yet.
    return []
  }
}

function latest(chats: Chat[]): Chat | undefined {
  return chats.reduce<Chat | undefined>(
    (best, chat) => (!best || chat.updatedAt > best.updatedAt ? chat : best),
    undefined
  )
}

async function save(docId: DocId): Promise<void> {
  const book = books.get(docId)
  if (!book?.filePath) return
  await fs.mkdir(dir(), { recursive: true })
  const chats = book.chats.filter((chat) => chat.entries.length)
  await fs.writeFile(fileFor(book.filePath), JSON.stringify({ filePath: book.filePath, chats }))
}

// Streaming updates arrive many times a second: written at most once a second.
function scheduleSave(docId: DocId): void {
  if (pendingSaves.has(docId)) return
  pendingSaves.set(
    docId,
    setTimeout(() => {
      pendingSaves.delete(docId)
      void save(docId).catch((error) => console.error('Saving chats failed:', error))
    }, 1000)
  )
}

async function flush(docId: DocId): Promise<void> {
  clearTimeout(pendingSaves.get(docId))
  pendingSaves.delete(docId)
  await save(docId)
}

const summary = (chat: Chat): ChatSummary => ({
  id: chat.id,
  title: chat.title,
  updatedAt: chat.updatedAt
})

export async function listChats(
  docId: DocId
): Promise<{ chats: ChatSummary[]; activeId: string | null; entries: AgentEntry[] }> {
  const book = await load(docId)
  const active = book.chats.find((chat) => chat.id === book.activeId)
  return {
    chats: [...book.chats].sort((a, b) => b.updatedAt - a.updatedAt).map(summary),
    activeId: book.activeId,
    entries: active?.entries ?? []
  }
}

// Every feed entry the panel shows lands in its chat; updates of a known entry
// replace it. A chat deleted while its agent still worked takes nothing more.
export async function recordEntry(event: AgentEvent): Promise<void> {
  if (event.type !== 'entry') return
  const { docId, chatId, entry } = event
  const book = await load(docId)
  const chat = book.chats.find((item) => item.id === chatId)
  if (!chat) return
  const index = chat.entries.findIndex((item) => item.id === entry.id)
  if (index >= 0) chat.entries[index] = { ...chat.entries[index], ...entry } as AgentEntry
  else chat.entries.push(entry)
  chat.updatedAt = Date.now()
  scheduleSave(docId)
}

// The chat a message goes to: the open one, or a new one named after the
// message when none is open.
export async function openChatFor(docId: DocId, prompt: string): Promise<string> {
  const book = await load(docId)
  const open = book.chats.find((item) => item.id === book.activeId)
  if (open) return open.id
  const now = Date.now()
  const chat: Chat = {
    id: crypto.randomUUID(),
    title: prompt.slice(0, 80),
    createdAt: now,
    updatedAt: now,
    entries: []
  }
  book.chats.push(chat)
  book.activeId = chat.id
  listener?.(docId)
  return chat.id
}

// The next message starts a new chat; the open one stays in the list.
export async function startNewChat(docId: DocId): Promise<void> {
  const book = await load(docId)
  book.activeId = null
  listener?.(docId)
}

export async function selectChat(docId: DocId, chatId: string): Promise<AgentEntry[]> {
  const book = await load(docId)
  const chat = book.chats.find((item) => item.id === chatId)
  if (!chat) throw new Error('This chat no longer exists.')
  book.activeId = chat.id
  listener?.(docId)
  return chat.entries
}

export async function deleteChat(docId: DocId, chatId: string): Promise<void> {
  const book = await load(docId)
  await dropImages(book.chats.filter((chat) => chat.id === chatId))
  book.chats = book.chats.filter((chat) => chat.id !== chatId)
  if (book.activeId === chatId) book.activeId = null
  listener?.(docId)
  await flush(docId)
}

const TRANSCRIPT_LIMIT = 8000

// What a fresh agent conversation is given with its instructions when it
// continues an earlier chat: the words exchanged, newest kept when long.
export async function chatContext({ docId, chatId }: ChatRef): Promise<string | undefined> {
  const book = await load(docId)
  const chat = book.chats.find((item) => item.id === chatId)
  const lines: string[] = []
  for (const entry of chat?.entries ?? []) {
    if (entry.kind === 'prompt') lines.push(`User: ${entry.text}`)
    else if (entry.kind === 'message' && entry.text) lines.push(`You: ${entry.text}`)
    else if (entry.kind === 'image' && entry.status === 'done')
      lines.push(`(You generated an image${entry.prompt ? `: ${entry.prompt}` : ''}.)`)
  }
  if (!lines.length) return undefined
  let transcript = lines.join('\n\n')
  if (transcript.length > TRANSCRIPT_LIMIT) {
    transcript = `…${transcript.slice(-TRANSCRIPT_LIMIT)}`
  }
  return `This conversation continues a chat you already had with the user about this design, in this app. Here it is, oldest first ("You" is you). Treat it as your own memory of the chat and carry on from it; the design may have changed since, so read it again before editing.\n\n<chat_so_far>\n${transcript}\n</chat_so_far>`
}

// The design was saved under a (new) file: its chats move with it.
export async function moveChats(docId: DocId, filePath: string): Promise<void> {
  const book = books.get(docId)
  if (!book || book.filePath === filePath) return
  const previous = book.filePath
  book.filePath = filePath
  await flush(docId)
  if (previous) await fs.rm(fileFor(previous), { force: true })
}

// The tab closed: written out and dropped from memory.
export async function closeChats(docId: DocId): Promise<void> {
  if (!books.has(docId)) return
  await flush(docId)
  books.delete(docId)
}

// The design file was deleted.
export async function deleteChatsOf(filePath: string): Promise<void> {
  await dropImages(await read(filePath))
  await fs.rm(fileFor(filePath), { force: true })
}

// The design file was renamed in the library (open or not).
export async function renameChatsOf(from: string, to: string): Promise<void> {
  try {
    const data = JSON.parse(await fs.readFile(fileFor(from), 'utf8'))
    await fs.writeFile(fileFor(to), JSON.stringify({ ...data, filePath: to }))
    await fs.rm(fileFor(from), { force: true })
  } catch {
    // No chats.
  }
}
