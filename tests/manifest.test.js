import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))

test('manifest: Manifest V3', () => {
  assert.equal(manifest.manifest_version, 3)
})

test('manifest: permisos EXACTOS (con «tabs» para mostrar títulos), sin hosts ni scripts de contenido', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'contextMenus', 'scripting', 'storage', 'tabGroups', 'tabs'])
  assert.equal(manifest.host_permissions, undefined)
  assert.equal(manifest.content_scripts, undefined)
})

test('manifest: atajo Alt+Shift+D para dormir el grupo actual', () => {
  assert.equal(manifest.commands['sleep-current-group'].suggested_key.default, 'Alt+Shift+D')
})

test('manifest: exige Chrome 150+ (contexto «tab» de los menús)', () => {
  assert.equal(manifest.minimum_chrome_version, '150')
})

test('manifest: bloqueo de red (connect-src none) y scripts solo propios', () => {
  const csp = manifest.content_security_policy?.extension_pages ?? ''
  assert.match(csp, /connect-src 'none'/)
  assert.match(csp, /script-src 'self'/)
  assert.match(csp, /default-src 'none'/)
  assert.match(csp, /form-action 'none'/)
  assert.match(csp, /frame-src 'none'/)
  assert.match(csp, /img-src 'self'/)
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|https?:/)
})

test('manifest: acceso a las webs SOLO opcional (http/https) y nunca obligatorio', () => {
  assert.equal(manifest.host_permissions, undefined)
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*'])
})

test('manifest: atajo Alt+Shift+S para dormir solo la pestaña actual', () => {
  assert.equal(manifest.commands['sleep-current-tab'].suggested_key.default, 'Alt+Shift+S')
})
