// Ayudas compartidas por los scripts de prueba e2e.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { launch, cdp, sleep } from './harness.mjs'
import { serve } from './fixtures.mjs'

export const EXTENSION_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Copia temporal de la extensión con el acceso a las webs YA concedido (host_permissions), porque el aviso
// real del permiso opcional necesita una ventana. Sirve para probar el 💤 en el título de la pestaña.
export function prepareVariant () {
  const dir = mkdtempSync(join(tmpdir(), 'zzz-variant-'))
  for (const item of ['manifest.json', 'background.js', 'lib', 'popup', 'options', 'icons']) cpSync(join(EXTENSION_DIR, item), join(dir, item), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  manifest.host_permissions = ['http://*/*', 'https://*/*']
  delete manifest.optional_host_permissions
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return dir
}
export { sleep }

// Espera hasta que `fn()` devuelva algo truthy (o lanza al agotar el tiempo).
export async function waitFor (fn, { ms = 8000, step = 100, what = 'condición' } = {}) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`Tiempo agotado esperando: ${what}`)
    await sleep(step)
  }
}

// Agrupa pestañas con título/color. Devuelve el id del grupo.
export function makeGroup (b, tabIds, title, color = 'blue') {
  return b.evalSW(`chrome.tabs.group({ tabIds: ${JSON.stringify(tabIds)} })
    .then((id) => chrome.tabGroups.update(id, { title: ${JSON.stringify(title)}, color: ${JSON.stringify(color)} }).then(() => id))`)
}

// Abre `n` pestañas de la página de pruebas `name` (en segundo plano) y devuelve sus ids.
export async function makeTabs (b, site, n, name, params = {}) {
  const ids = []
  for (let i = 0; i < n; i++) ids.push(await b.newTab(site.url(name, { t: `${name}${i}`, ...params })))
  return ids
}

export const activate = (b, id) => b.evalSW(`chrome.tabs.update(${id}, { active: true }).then(() => true)`)
export const tabsOf = (b, groupId) => b.evalSW(`chrome.tabs.query({ groupId: ${groupId} })
  .then((ts) => ts.map((t) => ({ id: t.id, index: t.index, discarded: t.discarded, active: t.active, audible: !!t.audible, groupId: t.groupId })))`)

// Abre una página de la extensión en una pestaña y devuelve un controlador CDP con sus errores de consola.
export async function openExtensionPage (b, path) {
  const base = b.swUrl.replace(/\/[^/]*$/, '/')
  const url = base + path
  const tabId = await b.newTab(url)
  const target = await waitFor(async () => (await b.targets()).find((t) => t.type === 'page' && t.url === url), { what: `página ${path}` })
  const page = cdp(target.webSocketDebuggerUrl)
  await page.ready
  const errors = []
  page.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
  })
  await page.send('Runtime.enable')
  // gesture: true lo ejecuta como si fuera un gesto real del usuario (hace falta para chrome.permissions.request).
  const evalPage = async (code, { gesture = false } = {}) => {
    const r = await page.send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true, userGesture: gesture })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  return { tabId, eval: evalPage, errors, close: () => page.close() }
}

// Ejecuta una lista de { name, fn(b, site) }: un Chromium limpio por test. Imprime OK/FALLA.
export async function runTests (title, allTests, { launchOpts = {} } = {}) {
  // ONLY=texto ejecuta solo los tests cuyo nombre lo contenga (para depurar uno).
  const tests = process.env.ONLY ? allTests.filter((t) => t.name.includes(process.env.ONLY)) : allTests
  const variantDir = tests.some((t) => t.variant) ? prepareVariant() : null
  const site = await serve()
  let failed = 0
  console.log(title)
  try {
    for (const t of tests) {
      let b
      try {
        b = await launch({ extensionDir: t.variant ? variantDir : EXTENSION_DIR, readyExpr: 'typeof zzz !== "undefined"', ...launchOpts })
        await t.fn(b, site)
        console.log(`OK     ${t.name}`)
      } catch (e) {
        failed++
        console.log(`FALLA  ${t.name} — ${e.message.split('\n')[0]}`)
        if (process.env.DEBUG) console.log(e.stack)
      } finally {
        if (b) await b.close()
      }
    }
  } finally {
    await site.close()
    if (variantDir && variantDir.includes('zzz-variant-')) rmSync(variantDir, { recursive: true, force: true })
  }
  console.log(`\n${failed === 0 ? `${tests.length}/${tests.length} OK` : `${failed} FALLA(S) de ${tests.length}`}`)
  process.exit(failed === 0 ? 0 : 1)
}

export function expect (cond, msg) {
  if (!cond) throw new Error(msg)
}
