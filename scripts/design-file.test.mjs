// Run: node --test scripts/design-file.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from 'polotno/model/store'
import { parseProjectText } from '../src/renderer/src/editor/import-design.ts'

// A design file is exactly store.toJSON(): it opens through parseProjectText
// and store.loadJSON, and saves as JSON.stringify(store.toJSON())
// (designSnapshot in tabs-model.ts). Agents write template variables,
// bindings, image fit and links through the MCP tools; Polotno before 4.22
// dropped them on the next save.
const design = {
  width: 1080,
  height: 1080,
  variables: [
    { name: 'first_name', label: 'First name', required: true, value: 'Anna' },
    { name: 'show_badge', default: true }
  ],
  pages: [
    {
      id: 'p1',
      children: [
        {
          id: 'title',
          type: 'text',
          text: '<p>Hi {{first_name}}, <a href="https://polotno.com">see more</a></p>',
          width: 800
        },
        {
          id: 'photo',
          type: 'image',
          src: 'https://example.com/sample.jpg',
          width: 400,
          height: 300,
          bindings: { src: 'photo' },
          fit: 'cover',
          focus: { x: 0.5, y: 0.2 }
        },
        {
          id: 'badge',
          type: 'figure',
          subType: 'rect',
          width: 100,
          height: 100,
          href: 'https://polotno.com/pricing',
          bindings: { fill: 'accent', visible: 'show_badge' }
        }
      ]
    }
  ]
}

test('template variables, bindings, image fit and links survive open and save', () => {
  const store = createStore({ key: '', showCredit: false })
  store.loadJSON(parseProjectText(JSON.stringify(design)))
  const saved = parseProjectText(JSON.stringify(store.toJSON()))

  assert.deepEqual(saved.variables, design.variables)
  const [title, photo, badge] = saved.pages[0].children
  assert.equal(title.text, design.pages[0].children[0].text)
  assert.deepEqual(
    { bindings: photo.bindings, fit: photo.fit, focus: photo.focus },
    { bindings: { src: 'photo' }, fit: 'cover', focus: { x: 0.5, y: 0.2 } }
  )
  assert.deepEqual(
    { href: badge.href, bindings: badge.bindings },
    { href: 'https://polotno.com/pricing', bindings: { fill: 'accent', visible: 'show_badge' } }
  )
})
