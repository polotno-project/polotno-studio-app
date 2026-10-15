// Run: node --test scripts/compact-design.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import jsonPatch from 'fast-json-patch'
import { compactDesign } from '../src/shared/compact-design.ts'

const defaults = {
  page: { id: 'x', children: [], background: 'white', bleed: 0, width: 'auto', height: 'auto' },
  elements: {
    text: {
      id: 'x',
      type: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      opacity: 1,
      fill: 'black',
      name: '',
      text: '',
      filters: {}
    },
    group: { id: 'x', type: 'group', x: 0, y: 0, opacity: 1, children: [] },
    figure: {
      id: 'x',
      type: 'figure',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 1,
      fill: 'rgb(0,161,255)',
      dash: []
    }
  }
}

const full = {
  width: 1080,
  height: 1080,
  fonts: [],
  pages: [
    {
      id: 'p1',
      background: 'white',
      bleed: 0,
      width: 'auto',
      height: 'auto',
      duration: 5000,
      children: [
        {
          id: 't1',
          type: 'text',
          x: 0,
          y: 0,
          width: 100,
          height: 52.78125,
          opacity: 1,
          fill: '#123',
          name: '',
          text: '',
          filters: {}
        },
        {
          id: 'g1',
          type: 'group',
          x: 0,
          y: 0,
          opacity: 0.5,
          children: [
            {
              id: 'f1',
              type: 'figure',
              x: 10,
              y: 10,
              width: 100,
              height: 100,
              opacity: 1,
              fill: 'rgb(0,161,255)',
              dash: []
            }
          ]
        }
      ]
    }
  ]
}

test('drops default values, keeps identity, box and changed values', () => {
  const compact = compactDesign(full, defaults)
  assert.deepEqual(compact.pages[0], {
    id: 'p1',
    duration: 5000,
    children: [
      { id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 52.78, fill: '#123', text: '' },
      {
        id: 'g1',
        type: 'group',
        x: 0,
        y: 0,
        opacity: 0.5,
        children: [{ id: 'f1', type: 'figure', x: 10, y: 10, width: 100, height: 100 }]
      }
    ]
  })
  assert.equal(compact.width, 1080)
})

test('a patch written against the compact copy applies to the full one', () => {
  const compact = compactDesign(full, defaults)
  // The agent sees no opacity on the figure and sets it with either op.
  assert.equal(compact.pages[0].children[1].children[0].opacity, undefined)
  for (const op of ['add', 'replace']) {
    const patch = [{ op, path: '/pages/0/children/1/children/0/opacity', value: 0.3 }]
    const patched = jsonPatch.applyPatch(structuredClone(full), patch, true, false).newDocument
    assert.equal(patched.pages[0].children[1].children[0].opacity, 0.3)
  }
})

test('unknown element types and non-design values pass through', () => {
  const odd = { pages: [{ id: 'p', children: [{ id: 'z', type: 'mystery', foo: 1 }] }] }
  assert.deepEqual(compactDesign(odd, defaults), odd)
  assert.equal(compactDesign('x', defaults), 'x')
})
