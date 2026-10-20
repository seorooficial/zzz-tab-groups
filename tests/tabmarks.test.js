import test from 'node:test'
import assert from 'node:assert/strict'
import { addPrefix, removePrefix, WEB_ORIGINS } from '../lib/tabmarks.js'

// Las funciones se inyectan en la página tal cual: aquí se prueban con un `document` y un `location` de mentira.
const page = (title, hostname = 'mail.example.com') => {
  globalThis.document = { title }
  globalThis.location = { hostname }
  return globalThis.document
}

test('addPrefix pone el 💤 delante del título', () => {
  const doc = page('Gmail')
  addPrefix()
  assert.equal(doc.title, '💤 Gmail')
})

test('addPrefix no se duplica', () => {
  const doc = page('💤 Gmail')
  addPrefix()
  assert.equal(doc.title, '💤 Gmail')
})

test('addPrefix con una página sin título usa el nombre del sitio', () => {
  const doc = page('')
  addPrefix()
  assert.equal(doc.title, '💤 mail.example.com')
})

test('removePrefix quita el 💤 y devuelve el título original', () => {
  const doc = page('💤 Gmail')
  removePrefix()
  assert.equal(doc.title, 'Gmail')
})

test('removePrefix en una página que no tenía título lo deja vacío', () => {
  const doc = page('💤 mail.example.com')
  removePrefix()
  assert.equal(doc.title, '')
})

test('removePrefix no toca un título sin la marca', () => {
  const doc = page('ZFoo')
  removePrefix()
  assert.equal(doc.title, 'ZFoo')
})

test('WEB_ORIGINS: solo http y https', () => {
  assert.deepEqual(WEB_ORIGINS, ['http://*/*', 'https://*/*'])
})
