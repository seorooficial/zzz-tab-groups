// Prueba de humo de la API de Chromium: ¿se sostienen las suposiciones técnicas en las que se apoya Zzz?
// Uso: node tests/e2e/phase0.mjs   (Chromium aparte, perfil temporal, sin ventana)
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { withBrowser, sleep } from './harness.mjs'
import { serve } from './fixtures.mjs'

const probeDir = join(dirname(fileURLToPath(import.meta.url)), 'probe')
const lines = []
let failed = 0
const report = (status, label, detail = '') => {
  if (status === 'FALLA') failed++
  const line = `${status.padEnd(6)} ${label}${detail ? ' — ' + detail : ''}`
  lines.push(line)
  console.log(line)
}

const info = (b, id) => b.evalSW(
  `chrome.tabs.get(${id}).then(t => ({ id: t.id, discarded: t.discarded, active: t.active, status: t.status, lastAccessed: t.lastAccessed ?? null, audible: !!t.audible }), () => ({ gone: true }))`
)
const discard = (b, id) => b.evalSW(`chrome.tabs.discard(${id}).then(t => t ? { id: t.id, discarded: t.discarded } : null)`)

const site = await serve()
try {
  // ---- Q1 · contexto "tab" en contextMenus ----
  await withBrowser({ extensionDir: probeDir }, async (b) => {
    console.log(`Chromium de pruebas: ${b.browser}\n`)
    const err = await b.evalSW(`new Promise((res) => chrome.contextMenus.create(
      { id: 'q1', title: 'x', contexts: ['tab', 'page'] },
      () => res(chrome.runtime.lastError ? chrome.runtime.lastError.message : null)))`)
    if (err === null) report('OK', 'P1 contextMenus acepta el contexto «tab»', 'la aparición visual del menú hay que comprobarla a mano en un Chromium real')
    else report('FALLA', 'P1 contextMenus acepta el contexto «tab»', err)

    // ---- Q2 · dormir, ids, despertar solo lo que se toca ----
    const ids = []
    for (let i = 0; i < 3; i++) ids.push(await b.newTab(site.url('mem', { t: 'm' + i })))
    const cur = [...ids]
    for (let i = 0; i < 3; i++) { const d = await discard(b, cur[i]); cur[i] = d ? d.id : cur[i] }
    const afterDiscard = await Promise.all(cur.map((id) => info(b, id)))
    const allSleep = afterDiscard.every((t) => t.discarded)
    report(allSleep ? 'OK' : 'FALLA', 'P2a tabs.discard duerme pestañas en segundo plano', JSON.stringify(afterDiscard.map((t) => t.discarded)))
    const oldGone = await Promise.all(ids.map((id) => info(b, id)))
    const changed = ids.map((id, i) => id !== cur[i])
    report('INFO', 'P2b tabs.discard cambia el id de la pestaña', `ids cambiados: ${JSON.stringify(changed)}; ids antiguos ya inexistentes: ${JSON.stringify(oldGone.map((t) => !!t.gone))}`)

    // Despertar tocando UNA: la activamos.
    await b.evalSW(`chrome.tabs.update(${cur[1]}, { active: true })`)
    await sleep(1500)
    const afterWake = await Promise.all(cur.map((id) => info(b, id)))
    const wakeIdSame = !afterWake[1].gone
    const only = wakeIdSame && !afterWake[1].discarded && afterWake[0].discarded && afterWake[2].discarded
    report(only ? 'OK' : 'FALLA', 'P2c activar una pestaña dormida despierta SOLO esa', JSON.stringify(afterWake.map((t) => (t.gone ? 'id perdido' : t.discarded))))
    report('INFO', 'P2c2 el id se mantiene al despertar activando', String(wakeIdSame))

    // reload sobre una dormida, sin activarla
    await b.evalSW(`chrome.tabs.update(${cur[2]}, { active: false }); chrome.tabs.reload(${cur[2]})`)
    await sleep(2000)
    const r = await info(b, cur[2])
    report(!r.gone && !r.discarded && !r.active ? 'OK' : 'FALLA', 'P2d tabs.reload despierta una dormida sin activarla', JSON.stringify(r))

    // ---- P7 · la pestaña dormida sigue en su grupo y en su sitio ----
    const g = []
    for (let i = 0; i < 3; i++) g.push(await b.newTab(site.url('plain', { t: 'g' + i })))
    const gid = await b.evalSW(`chrome.tabs.group({ tabIds: ${JSON.stringify(g)} })
      .then((id) => chrome.tabGroups.update(id, { title: 'Prueba', color: 'red' }).then(() => id))`)
    const members = (id) => b.evalSW(`chrome.tabs.query({ groupId: ${id} })
      .then((ts) => ts.map((t) => ({ id: t.id, index: t.index, discarded: t.discarded })).sort((a, z) => a.index - z.index))`)
    const gBefore = await members(gid)
    const dg = await discard(b, g[1])
    const gAfter = await members(gid)
    const grp = await b.evalSW(`chrome.tabGroups.get(${gid}).then((x) => ({ title: x.title, color: x.color }))`)
    const sameSlots = JSON.stringify(gBefore.map((t) => t.index)) === JSON.stringify(gAfter.map((t) => t.index))
    const stays = gAfter.length === 3 && gAfter.some((t) => dg && t.id === dg.id && t.discarded) && sameSlots && grp.title === 'Prueba'
    report(stays ? 'OK' : 'FALLA', 'P7 la pestaña dormida sigue en su grupo, en su posición, y el grupo conserva título/color',
      JSON.stringify({ antes: gBefore.map((t) => t.index), despues: gAfter.map((t) => t.index), durmiendo: gAfter.filter((t) => t.discarded).length, grupo: grp }))

    // ---- Q3 · lastAccessed ----
    const fresh = await b.newTab(site.url('plain', { t: 'la' }))
    const never = await info(b, fresh)
    await b.evalSW(`chrome.tabs.update(${fresh}, { active: true })`)
    await sleep(300)
    const a1 = (await info(b, fresh)).lastAccessed
    await sleep(1200)
    await b.evalSW(`chrome.tabs.update(${cur[1]}, { active: true })`)
    await sleep(300)
    await b.evalSW(`chrome.tabs.update(${fresh}, { active: true })`)
    await sleep(300)
    const a2 = (await info(b, fresh)).lastAccessed
    const numeric = typeof a1 === 'number' && typeof a2 === 'number'
    report(numeric && a2 - a1 >= 1000 ? 'OK' : 'FALLA', 'P3 lastAccessed es fiable y avanza al reactivar', `1ª ${a1}, 2ª ${a2}, diferencia ${numeric ? a2 - a1 : '?'} ms`)
    report('INFO', 'P3b lastAccessed de una pestaña abierta en segundo plano y nunca activada', String(never.lastAccessed))

    // ---- Q4 · la RAM baja de verdad ----
    const mem = []
    for (let i = 0; i < 3; i++) mem.push(await b.newTab(site.url('mem', { mb: 60, t: 'ram' + i })))
    await sleep(1000)
    const before = b.rendererRssMB()
    for (const id of mem) await discard(b, id)
    await sleep(2000)
    const after = b.rendererRssMB()
    report(before - after >= 100 ? 'OK' : 'FALLA', 'P4 dormir 3 pestañas de 60 MB libera ≥ 100 MB', `antes ${before} MB, después ${after} MB, baja ${before - after} MB`)

    // ---- Q6 · ¿se detecta el audio en headless? ----
    const aud = await b.newTab(site.url('audio', { t: 'sonido' }))
    await sleep(3000)
    const ai = await info(b, aud)
    report('INFO', 'P6 audible en Chromium sin ventana con un oscilador sonando', String(ai.audible))
  })

  // ---- Q5 · con el Ahorro de memoria nativo activado (valores copiados de su perfil) ----
  await withBrowser({
    extensionDir: probeDir,
    localState: { performance_tuning: { high_efficiency_mode: { aggressiveness: 2, state: 2 } } }
  }, async (b) => {
    const ids = []
    for (let i = 0; i < 2; i++) ids.push(await b.newTab(site.url('mem', { t: 'n' + i })))
    const cur = []
    for (const id of ids) { const d = await discard(b, id); cur.push(d ? d.id : id) }
    await b.evalSW(`chrome.tabs.update(${cur[0]}, { active: true })`)
    await sleep(1500)
    const t = await Promise.all(cur.map((id) => info(b, id)))
    const ok = !t[0].gone && !t[0].discarded && !t[1].gone && t[1].discarded
    report(ok ? 'PARCIAL' : 'FALLA', 'P5 con el Ahorro de memoria nativo activado, dormir y despertar funcionan igual',
      'solo se probó la convivencia inmediata; el choque a largo plazo con los temporizadores nativos se comprueba en el uso real')
  })
} finally {
  await site.close()
}

console.log(`\n${failed === 0 ? 'Prueba de humo sin FALLAS' : failed + ' FALLA(S)'}`)
process.exit(failed === 0 ? 0 : 1)
