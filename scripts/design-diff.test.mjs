// Run: node --test scripts/design-diff.test.mjs
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffDesign } from '../src/shared/design-diff.ts'

const text = (id, extra = {}) => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  text: id,
  fill: 'black',
  ...extra
})
const design = (children, extra = {}) => ({
  width: 1080,
  height: 1080,
  fonts: [],
  pages: [{ id: 'p1', background: 'white', children }],
  ...extra
})

test('a color change is one set on that element, with the value the agent saw', () => {
  const before = design([text('a'), text('b')])
  const after = design([text('a', { fill: 'red' }), text('b')])
  assert.deepEqual(diffDesign(before, after), {
    changes: [
      { kind: 'set', target: 'element', id: 'a', props: { fill: 'red' }, base: { fill: 'black' } }
    ]
  })
})

test('nothing changed, nothing to do', () => {
  assert.deepEqual(diffDesign(design([text('a')]), design([text('a')])), { changes: [] })
})

test('a removed property is set to undefined', () => {
  const before = design([text('a', { shadowEnabled: true })])
  const after = design([text('a')])
  assert.deepEqual(diffDesign(before, after).changes, [
    {
      kind: 'set',
      target: 'element',
      id: 'a',
      props: { shadowEnabled: undefined },
      base: { shadowEnabled: true }
    }
  ])
})

test('added and removed elements, appended without a reorder', () => {
  const before = design([text('a'), text('b')])
  const after = design([text('a'), text('c')])
  assert.deepEqual(diffDesign(before, after).changes, [
    { kind: 'remove-element', id: 'b' },
    { kind: 'add-element', parentId: 'p1', element: text('c') }
  ])
})

test('an element inserted below the others needs an order change', () => {
  const before = design([text('a')])
  const after = design([text('bg'), text('a')])
  const { changes } = diffDesign(before, after)
  assert.deepEqual(changes.at(-1), { kind: 'order', parentId: 'p1', ids: ['bg', 'a'] })
})

test('reordering existing elements', () => {
  const before = design([text('a'), text('b'), text('c')])
  const after = design([text('c'), text('a'), text('b')])
  assert.deepEqual(diffDesign(before, after).changes, [
    { kind: 'order', parentId: 'p1', ids: ['c', 'a', 'b'] }
  ])
})

test('page background and size', () => {
  const before = design([text('a')])
  const after = { ...design([text('a')]), width: 1200 }
  after.pages[0].background = '#7D1824'
  assert.deepEqual(diffDesign(before, after).changes, [
    { kind: 'size', width: 1200, height: 1080, base: { width: 1080, height: 1080 } },
    {
      kind: 'set',
      target: 'page',
      id: 'p1',
      props: { background: '#7D1824' },
      base: { background: 'white' }
    }
  ])
})

test('added page arrives whole; removed page goes', () => {
  const before = design([text('a')])
  const after = { ...before, pages: [{ id: 'p2', background: 'white', children: [text('x')] }] }
  assert.deepEqual(diffDesign(before, after).changes, [
    { kind: 'remove-page', id: 'p1' },
    { kind: 'add-page', page: after.pages[0] }
  ])
})

test('a page added in front of the others gets its place', () => {
  const before = design([text('a')])
  const added = { id: 'p0', background: 'white', children: [] }
  const after = { ...before, pages: [added, ...before.pages] }
  assert.deepEqual(diffDesign(before, after).changes, [
    { kind: 'add-page', page: added },
    { kind: 'page-order', ids: ['p0', 'p1'] }
  ])
})

test('a page added at the end needs no reorder', () => {
  const before = design([text('a')])
  const added = { id: 'p2', background: 'white', children: [] }
  const after = { ...before, pages: [...before.pages, added] }
  assert.deepEqual(diffDesign(before, after).changes, [{ kind: 'add-page', page: added }])
})

test('elements inside groups are addressed by id', () => {
  const group = (children) => ({ id: 'g', type: 'group', children })
  const before = design([group([text('a'), text('b')])])
  const after = design([group([text('a', { fill: 'red' }), text('b')])])
  assert.deepEqual(diffDesign(before, after).changes, [
    { kind: 'set', target: 'element', id: 'a', props: { fill: 'red' }, base: { fill: 'black' } }
  ])
})

test('removing a group does not also remove its children one by one', () => {
  const before = design([{ id: 'g', type: 'group', children: [text('a')] }, text('b')])
  const after = design([text('b')])
  assert.deepEqual(diffDesign(before, after).changes, [{ kind: 'remove-element', id: 'g' }])
})

test('edits the store cannot express fall back to a full load', () => {
  const group = (children) => ({ id: 'g', type: 'group', children })
  assert.ok(
    'fallback' in diffDesign(design([group([text('a')])]), design([group([text('a'), text('n')])]))
  )
  assert.ok('fallback' in diffDesign(design([text('a'), group([])]), design([group([text('a')])])))
  assert.ok(
    'fallback' in diffDesign(design([text('a')]), design([{ ...text('a'), type: 'image' }]))
  )
  assert.ok('fallback' in diffDesign(design([]), design([], { unit: 'mm' })))
})
