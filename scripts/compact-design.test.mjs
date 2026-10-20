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

test('outlineDesign keeps chosen pages whole and outlines the rest in place', async () => {
  const { outlineDesign } = await import('../src/shared/compact-design.ts')
  const design = {
    width: 100,
    height: 100,
    pages: [
      {
        id: 'p1',
        background: 'red',
        children: [
          {
            id: 'a',
            type: 'text',
            text: '<b>Hello</b>   world',
            x: 1.4,
            y: 2,
            width: 50,
            height: 10,
            fill: 'blue'
          }
        ]
      },
      {
        id: 'p2',
        children: [
          { id: 'b', type: 'image', src: 'x', x: 0, y: 0, width: 10, height: 10 },
          { id: 'g', type: 'group', children: [{ id: 'c', type: 'svg' }] }
        ]
      }
    ]
  }
  const out = outlineDesign(design, (id) => id === 'p2')
  assert.deepEqual(out.pages[1], design.pages[1])
  assert.deepEqual(out.pages[0], {
    id: 'p1',
    background: 'red',
    outlined: true,
    outline: ['a text 1,2 50x10 "Hello world"']
  })
  const byIndex = outlineDesign(design, (_id, index) => index === 0)
  assert.deepEqual(byIndex.pages[1].outline, ['b image 0,0 10x10', 'g group 0,0 0x0 (1 elements)'])
  const brief = outlineDesign(design, () => false, { brief: true })
  assert.deepEqual(brief.pages[1], { id: 'p2', outlined: true, elementCount: 2 })
})
