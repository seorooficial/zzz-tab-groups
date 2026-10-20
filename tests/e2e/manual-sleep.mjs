// Dormir y despertar a mano: grupos (API interna, menús y popup).
// Uso: node tests/e2e/phase1.mjs   (Chromium aparte, perfil temporal, sin ventana)
import { runTests, makeGroup, makeTabs as mk, activate, tabsOf, openExtensionPage, waitFor, sleep, expect } from './util.mjs'

const tests = [
  {
    name: 'sleep_group_discards_inactive_tabs',
    fn: async (b, site) => {
      const ids = await mk(b, site, 5, 'mem', { mb: 60 })
      const gid = await makeGroup(b, ids, 'Prueba')
      await activate(b, ids[0])
      await sleep(800)
      const before = b.rendererRssMB()
      const r = await b.evalSW(`zzz.sleepGroup(${gid})`)
      expect(r.slept === 4 && r.skipped === 1, `esperaba {slept:4, skipped:1}, salió ${JSON.stringify(r)}`)
      await sleep(1500)
      const drop = before - b.rendererRssMB()
      expect(drop >= 150, `la RAM debía bajar ≥ 150 MB y bajó ${drop} MB`)
      const ts = await tabsOf(b, gid)
      expect(ts.length === 5 && ts.filter((t) => t.discarded).length === 4, 'debían quedar 5 pestañas, 4 dormidas')
      expect(!ts.find((t) => t.active).discarded, 'la pestaña activa no se debe dormir')
    }
  },
  {
    name: 'only_active_tab_group',
    fn: async (b, site) => {
      const [id] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, [id], 'Sola')
      await activate(b, id)
      const r = await b.evalSW(`zzz.sleepGroup(${gid})`)
      expect(r.slept === 0 && r.skipped === 1, `esperaba {slept:0, skipped:1}, salió ${JSON.stringify(r)}`)
    }
  },
  {
    name: 'audible_tab_survives_sleep_others',
    fn: async (b, site) => {
      const a = await mk(b, site, 2, 'plain')
      const bb = [await b.newTab(site.url('audio', { t: 'sonido' })), await b.newTab(site.url('plain', { t: 'calla' }))]
      const gA = await makeGroup(b, a, 'A')
      const gB = await makeGroup(b, bb, 'B', 'red')
      await activate(b, a[0])
      await waitFor(async () => (await tabsOf(b, gB)).find((t) => t.id === bb[0]).audible, { what: 'que la pestaña de audio suene' })
      await b.evalSW(`zzz.sleepOthers(${gA})`)
      const ts = await tabsOf(b, gB)
      const sonando = ts.find((t) => t.audible)
      expect(sonando && !sonando.discarded, 'la pestaña que suena se durmió (ya no queda ninguna con audio)')
      expect(ts.filter((t) => t.discarded).length === 1, 'la otra pestaña del grupo B debía dormirse')
    }
  },
  {
    name: 'locked_group_respected_by_others_not_by_manual',
    fn: async (b, site) => {
      const l = await mk(b, site, 2, 'plain')
      const x = await mk(b, site, 2, 'plain')
      const gL = await makeGroup(b, l, 'L')
      const gX = await makeGroup(b, x, 'X', 'green')
      await activate(b, x[0])
      expect((await b.evalSW(`zzz.toggleLock(${gL})`)) === true, 'toggleLock debía devolver true (candado puesto)')
      await b.evalSW(`zzz.sleepOthers(${gX})`)
      expect((await tabsOf(b, gL)).every((t) => !t.discarded), 'sleepOthers durmió un grupo con candado')
      const r = await b.evalSW(`zzz.sleepGroup(${gL})`)
      expect(r.slept === 2, `sleepGroup manual debía ignorar el candado: ${JSON.stringify(r)}`)
      expect((await b.evalSW(`zzz.toggleLock(${gL})`)) === false, 'segundo toggleLock debía quitar el candado')
    }
  },
  {
    name: 'wake_one_tab_only',
    fn: async (b, site) => {
      const ids = await mk(b, site, 3, 'plain')
      const [other] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, other)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      const ts = await tabsOf(b, gid)
      expect(ts.every((t) => t.discarded), 'las 3 debían estar dormidas')
      await activate(b, ts[1].id)
      const awake = await waitFor(async () => {
        const cur = await tabsOf(b, gid)
        return cur.filter((t) => !t.discarded).length === 1 ? cur : null
      }, { what: 'que despierte solo una' })
      expect(awake.find((t) => !t.discarded).id === ts[1].id, 'despertó otra pestaña distinta a la pulsada')
    }
  },
  {
    name: 'wake_group_staggers',
    fn: async (b, site) => {
      const ids = await mk(b, site, 5, 'plain')
      const [other] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, other)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      const t0 = Date.now()
      const n = await b.evalSW(`zzz.wakeGroup(${gid})`)
      const elapsed = Date.now() - t0
      expect(n === 5, `debía despertar 5 y despertó ${n}`)
      expect(elapsed >= 1200, `entre 5 pestañas debía haber ≥ 4 × 300 ms y fueron ${elapsed} ms`)
      await waitFor(async () => (await tabsOf(b, gid)).every((t) => !t.discarded), { what: 'que las 5 estén despiertas' })
    }
  },
  {
    name: 'ungrouped_targets_sin_grupo',
    fn: async (b, site) => {
      const u = await mk(b, site, 3, 'plain')
      const g = await mk(b, site, 2, 'plain')
      const gid = await makeGroup(b, g, 'Con grupo')
      await activate(b, g[0])
      // Como si se hiciera clic derecho en una pestaña sin grupo.
      await b.evalSW(`chrome.tabs.get(${u[0]}).then((tab) => zzz.handleMenu('sleep-group', tab))`)
      const ungrouped = await tabsOf(b, -1)
      expect(ungrouped.filter((t) => t.discarded).length >= 3, 'las pestañas sin grupo debían dormirse')
      expect((await tabsOf(b, gid)).every((t) => !t.discarded), 'no debía tocar las pestañas con grupo')
    }
  },
  {
    name: 'popup_renders_rows_and_buttons_work',
    fn: async (b, site) => {
      const a = await mk(b, site, 2, 'plain')
      const c = await mk(b, site, 2, 'plain')
      const gA = await makeGroup(b, a, 'Alfa')
      const gC = await makeGroup(b, c, 'Beta', 'red')
      await activate(b, a[0])
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(async () => (await page.eval('document.querySelectorAll("[data-group-id]").length')) === 3, { what: '3 filas (2 grupos + Sin grupo)' })
      const text = await page.eval('document.body.innerText')
      expect(text.includes('Alfa') && text.includes('Beta') && text.includes('Sin grupo'), `faltan nombres en el popup: ${text.slice(0, 120)}`)
      await page.eval(`document.querySelector('[data-group-id="${gC}"] [data-action="sleep"]').click()`)
      await waitFor(async () => (await tabsOf(b, gC)).every((t) => t.discarded), { what: 'que el botón 💤 duerma el grupo Beta' })
      expect((await tabsOf(b, gA)).every((t) => !t.discarded), 'el botón de Beta no debía dormir Alfa')
      expect(page.errors.length === 0, `errores en la consola del popup: ${page.errors.join(' | ')}`)
      page.close()
    }
  }
]

await runTests('Dormir y despertar a mano', tests)
