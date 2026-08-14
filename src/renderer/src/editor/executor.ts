import type { DesignCommand } from '../../../shared/commands'
import type { DesignStore } from './store'

export class CommandError extends Error {
  constructor(
    public code: 'invalid_command' | 'invalid_json' | 'element_not_found' | 'page_not_found',
    message: string
  ) {
    super(message)
  }
}

type PageModel = DesignStore['pages'][number]
type ElementModel = ReturnType<DesignStore['getElementById']>

function pageOf(store: DesignStore, pageId?: string): PageModel {
  if (!pageId) {
    const page = store.activePage ?? store.pages[0]
    if (!page) throw new CommandError('page_not_found', 'The design has no pages')
    return page
  }
  const page = store.pages.find((p) => p.id === pageId)
  if (!page) throw new CommandError('page_not_found', `No page ${pageId}`)
  return page
}

function elementOf(store: DesignStore, elementId: string): NonNullable<ElementModel> {
  const element = store.getElementById(elementId)
  if (!element) throw new CommandError('element_not_found', `No element ${elementId}`)
  return element
}

// The ONE implementation of the DesignCommand vocabulary, executed against a
// live store. Every MCP tool maps here; agent edits land on the shared undo
// stack because they go through normal store APIs.
export async function executeCommand(store: DesignStore, command: DesignCommand): Promise<unknown> {
  switch (command.type) {
    case 'ping':
      return 'pong'

    case 'get_json':
      return store.toJSON()

    case 'get_info':
      return {
        width: store.width,
        height: store.height,
        unit: store.unit,
        dpi: store.dpi,
        pageCount: store.pages.length,
        pages: store.pages.map((page) => ({
          id: page.id,
          elementCount: page.children.length
        }))
      }

    case 'load_json': {
      try {
        store.loadJSON(command.json)
      } catch (error) {
        throw new CommandError('invalid_json', String(error))
      }
      await store.waitLoading()
      return null
    }

    case 'set_size':
      store.setSize(command.width, command.height, command.magicResize ?? false)
      return null

    case 'add_page': {
      const page = store.addPage()
      if (command.background) page.set({ background: command.background })
      if (command.duration !== undefined) page.set({ duration: command.duration })
      return { pageId: page.id }
    }

    case 'remove_page': {
      pageOf(store, command.pageId)
      store.deletePages([command.pageId])
      return null
    }

    case 'move_page': {
      const page = pageOf(store, command.pageId)
      page.setZIndex(command.toIndex)
      return null
    }

    case 'set_page': {
      const page = pageOf(store, command.pageId)
      page.set(command.props)
      return null
    }

    case 'add_element': {
      const page = pageOf(store, command.pageId)
      const element = page.addElement(command.element as Parameters<PageModel['addElement']>[0])
      if (command.atIndex !== undefined) element.setZIndex(command.atIndex)
      await store.waitLoading()
      return { elementId: element.id }
    }

    case 'update_element': {
      const element = elementOf(store, command.elementId)
      element.set(command.props)
      await store.waitLoading()
      return null
    }

    case 'remove_elements': {
      for (const id of command.elementIds) elementOf(store, id)
      store.deleteElements(command.elementIds)
      return null
    }

    case 'move_element': {
      const element = elementOf(store, command.elementId)
      if (command.toIndex !== undefined) element.setZIndex(command.toIndex)
      else if (command.direction === 'up') element.moveUp()
      else if (command.direction === 'down') element.moveDown()
      else if (command.direction === 'front') element.moveTop()
      else if (command.direction === 'back') element.moveBottom()
      else throw new CommandError('invalid_command', 'move_element needs direction or toIndex')
      return null
    }

    case 'render': {
      await store.waitLoading()
      await document.fonts.ready
      const page = pageOf(store, command.pageId)
      const maxSide = command.maxSide ?? 1024
      const fromMax = maxSide / Math.max(store.width, store.height)
      const pixelRatio = command.pixelRatio ?? Math.min(1, fromMax)
      const dataUrl = await store.toDataURL({
        pageId: page.id,
        pixelRatio,
        mimeType: command.mimeType ?? 'image/png'
      })
      return { dataUrl, width: Math.round(store.width * pixelRatio), height: Math.round(store.height * pixelRatio) }
    }

    case 'lint': {
      const { lintDesign } = await import('./lint')
      await store.waitLoading()
      return lintDesign(store, command.pageId)
    }

    case 'export': {
      await store.waitLoading()
      await document.fonts.ready
      if (command.format === 'pdf') {
        const { jsonToPDFBlob } = await import('@polotno/pdf-export/browser')
        const json = store.toJSON() as unknown as Parameters<typeof jsonToPDFBlob>[0]
        const blob = await jsonToPDFBlob(json, {})
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        return { pages: [{ dataUrl }] }
      }
      const pageIds = command.pageId
        ? [pageOf(store, command.pageId).id]
        : store.pages.map((page) => page.id)
      const pages: { pageId: string; dataUrl: string }[] = []
      for (const pageId of pageIds) {
        const dataUrl = await store.toDataURL({
          pageId,
          pixelRatio: command.pixelRatio ?? 2,
          mimeType: `image/${command.format}`
        })
        pages.push({ pageId, dataUrl })
      }
      return { pages }
    }

    default:
      throw new CommandError(
        'invalid_command',
        `Unknown command: ${(command as { type: string }).type}`
      )
  }
}
