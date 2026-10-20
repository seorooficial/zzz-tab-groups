// Automático y reglas: barrido, candado, interruptor, reinicio del service worker, opciones y popup.
// Uso: node tests/e2e/phase2.mjs   (Chromium aparte, perfil temporal, sin ventana)
import { runTests, makeGroup, makeTabs as mk, activate, tabsOf, openExtensionPage, waitFor, sleep, expect } from './util.mjs'

const setSettings = (b, s) => b.evalSW(`zzz.saveSettings(${JSON.stringify(s)}).then(() => true)`)
const getSettings = (b) => b.evalSW('zzz.loadSettings()')
// Barre como si hubieran pasado 10 s (las reglas de prueba son de 0,05 min = 3 s).
const sweepLater = (b) => b.evalSW('zzz.sweep(Date.now() + 10000)')
const needSweep = async (b) => expect((await b.evalSW('typeof zzz.sweep')) === 'function', 'zzz.sweep no existe todavía')

const tests = [
  {
    name: 'sweep_sleeps_idle_only',
    fn: async (b, site) => {
      await needSweep(b)
      const a = await b.newTab(site.url('plain', { t: 'activa' }))
      const au = await b.newTab(site.url('audio', { t: 'suena' }))
      const p = await b.newTab(site.url('plain', { t: 'ocioso' }))
      const u = await b.newTab(site.url('plain', { t: 'suelto' }))
      const gid = await makeGroup(b, [a, au, p], 'Idle')
      await activate(b, a)
      await waitFor(async () => (await tabsOf(b, gid)).find((t) => t.id === au).audible, { what: 'que suene el audio' })
      await setSettings(b, { rules: { 't:Idle': { mode: 'minutes', minutes: 0.05 } } })
      const r = await sweepLater(b)
      expect(r.slept === 1, `debía dormir solo la ociosa: ${JSON.stringify(r)}`)
      const ts = await tabsOf(b, gid)
      expect(ts.filter((t) => t.discarded).length === 1, 'solo una del grupo debía dormir')
      expect(ts.find((t) => t.audible) && !ts.find((t) => t.audible).discarded, 'la que suena se durmió')
      expect(ts.find((t) => t.active) && !ts.find((t) => t.active).discarded, 'la activa se durmió')
      expect(!(await b.evalSW(`chrome.tabs.get(${u}).then((t) => t.discarded)`)), 'la suelta (regla por defecto 15 min) no debía dormir')
    }
  },
  {
    name: 'never_group_survives_sweep',
    fn: async (b, site) => {
      await needSweep(b)
      const ads = await mk(b, site, 2, 'plain')
      const park = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gAds = await makeGroup(b, ads, 'Ads', 'red')
      const gPark = await makeGroup(b, park, 'Park', 'grey')
      await activate(b, o)
      // Defecto de 3 s: si el candado no funcionara, Ads también se dormiría (así el test distingue «nunca» de «defecto»).
      await setSettings(b, { defaultMinutes: 0.05, rules: { 't:Ads': { mode: 'never' }, 't:Park': { mode: 'minutes', minutes: 0.05 } } })
      await sweepLater(b)
      expect((await tabsOf(b, gAds)).every((t) => !t.discarded), 'el grupo con candado se durmió')
      expect((await tabsOf(b, gPark)).every((t) => t.discarded), 'el grupo con regla de minutos debía dormir entero')
    }
  },
  {
    name: 'auto_off_does_nothing',
    fn: async (b, site) => {
      await needSweep(b)
      const park = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gPark = await makeGroup(b, park, 'Park')
      await activate(b, o)
      await setSettings(b, { autoEnabled: false, rules: { 't:Park': { mode: 'minutes', minutes: 0.05 } } })
      const r = await sweepLater(b)
      expect(r.slept === 0, `con Auto OFF no debía dormir nada: ${JSON.stringify(r)}`)
      expect((await tabsOf(b, gPark)).every((t) => !t.discarded), 'con Auto OFF se durmió algo')
    }
  },
  {
    name: 'ungrouped_follow_default',
    fn: async (b, site) => {
      await needSweep(b)
      await mk(b, site, 2, 'plain')
      const g = await mk(b, site, 1, 'plain')
      await makeGroup(b, g, 'G')
      await activate(b, g[0])
      await setSettings(b, { defaultMinutes: 0.05 })
      await sweepLater(b)
      const ungrouped = await tabsOf(b, -1)
      expect(ungrouped.length >= 2 && ungrouped.every((t) => t.discarded), `las sueltas debían seguir el tiempo por defecto: ${JSON.stringify(ungrouped.map((t) => t.discarded))}`)
    }
  },
  {
    name: 'sweep_survives_worker_restart',
    fn: async (b, site) => {
      await needSweep(b)
      const [a, p] = await mk(b, site, 2, 'plain')
      const gid = await makeGroup(b, [a, p], 'Idle')
      await activate(b, a)
      await setSettings(b, { rules: { 't:Idle': { mode: 'minutes', minutes: 0.02 } } })
      // Sin depurador conectado, Chromium apaga el service worker por inactividad…
      b.detachSW()
      await waitFor(async () => !(await b.swAlive()), { ms: 70000, step: 1000, what: 'que el service worker se apague por inactividad' })
      // …y la alarma lo despierta de cero: el barrido debe dormir la ociosa con los ajustes guardados.
      await waitFor(() => b.swAlive(), { ms: 90000, step: 1000, what: 'que la alarma despierte el service worker' })
      await b.reattachSW()
      await waitFor(async () => (await tabsOf(b, gid)).some((t) => t.discarded), { ms: 15000, what: 'que el barrido tras el reinicio duerma la pestaña ociosa' })
      const alarm = await b.evalSW("chrome.alarms.get('sweep')")
      expect(alarm && alarm.periodInMinutes === 1, `la alarma «sweep» debía seguir cada 1 min: ${JSON.stringify(alarm)}`)
    }
  },
  {
    name: 'alarm_triggers_sweep_by_itself',
    fn: async (b, site) => {
      await needSweep(b)
      const [a, p] = await mk(b, site, 2, 'plain')
      const gid = await makeGroup(b, [a, p], 'Idle')
      await activate(b, a)
      await setSettings(b, { rules: { 't:Idle': { mode: 'minutes', minutes: 0.02 } } })
      // Sin llamar a sweep(): la alarma de 1 min debe dormirla sola.
      await waitFor(async () => (await tabsOf(b, gid)).some((t) => t.discarded), { ms: 100000, step: 1000, what: 'que la alarma duerma la pestaña ociosa' })
    }
  },
  {
    name: 'options_roundtrip',
    fn: async (b, site) => {
      const [a] = await mk(b, site, 1, 'plain')
      await makeGroup(b, [a], 'Ads', 'red')
      const page = await openExtensionPage(b, 'options/options.html')
      await waitFor(() => page.eval('!!document.querySelector(\'[data-rule-key="t:Ads"]\')'), { what: 'la fila del grupo Ads' })
      expect((await page.eval('document.querySelectorAll("select").length')) === 0, 'las opciones no deben usar <select>')
      expect((await page.eval('!!document.querySelector(\'[data-rule-key="__sin_grupo__"]\')')), 'falta la fila «Sin grupo»')

      await page.eval(`(() => { const i = document.querySelector('#default-minutes'); i.value = '20'; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await waitFor(async () => (await getSettings(b)).defaultMinutes === 20, { what: 'defaultMinutes = 20' })

      // Cada cambio guarda y la página se repinta: se espera al repintado antes del siguiente gesto.
      const renders = () => page.eval('Number(document.querySelector("#rules").dataset.renders)')
      const settled = async (before) => waitFor(async () => (await renders()) > before, { what: 'que la página se repinte' })

      let n = await renders()
      await page.eval(`document.querySelector('[data-rule-key="t:Ads"] input[value="never"]').click()`)
      await waitFor(async () => (await getSettings(b)).rules['t:Ads']?.mode === 'never', { what: 'regla never en Ads' })
      await settled(n)

      n = await renders()
      await page.eval(`document.querySelector('[data-rule-key="t:Ads"] input[value="minutes"]').click()`)
      await waitFor(async () => (await getSettings(b)).rules['t:Ads']?.mode === 'minutes', { what: 'modo minutos en Ads' })
      await settled(n)

      n = await renders()
      await page.eval(`(() => { const i = document.querySelector('[data-rule-key="t:Ads"] .minutes'); i.value = '7'; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await waitFor(async () => { const r = (await getSettings(b)).rules['t:Ads']; return r?.mode === 'minutes' && r.minutes === 7 }, { what: 'regla 7 minutos en Ads' })
      await settled(n)

      n = await renders()
      await page.eval(`document.querySelector('[data-rule-key="t:Ads"] input[value="default"]').click()`)
      await waitFor(async () => (await getSettings(b)).rules['t:Ads'] === undefined, { what: 'regla Ads borrada al volver a «Defecto»' })
      await settled(n)
      expect(page.errors.length === 0, `errores de consola en las opciones: ${page.errors.join(' | ')}`)
      page.close()
    }
  },
  {
    name: 'popup_auto_switch',
    fn: async (b, site) => {
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval('!!document.querySelector("#auto")'), { what: 'el interruptor Auto' })
      expect((await page.eval('document.querySelector("#auto").checked')) === true, 'Auto debía empezar ON')
      await page.eval('document.querySelector("#auto").click()')
      await waitFor(async () => (await getSettings(b)).autoEnabled === false, { what: 'autoEnabled = false' })
      await page.eval('document.querySelector("#auto").click()')
      await waitFor(async () => (await getSettings(b)).autoEnabled === true, { what: 'autoEnabled = true otra vez' })
      expect(page.errors.length === 0, `errores de consola en el popup: ${page.errors.join(' | ')}`)
      page.close()
    }
  }
  ,
  {
    // Hallazgo #1 de la revisión: lastAccessed es «cuándo se hizo activa», no «cuándo se dejó».
    name: 'left_tab_not_slept_right_after_leaving',
    fn: async (b, site) => {
      await needSweep(b)
      const a = await b.newTab(site.url('plain', { t: 'A' }))
      const o = await b.newTab(site.url('plain', { t: 'B' }))
      const gA = await makeGroup(b, [a], 'A')
      const gB = await makeGroup(b, [o], 'B', 'green')
      await setSettings(b, { rules: { 't:A': { mode: 'minutes', minutes: 0.05 }, 't:B': { mode: 'minutes', minutes: 0.05 } } })
      await activate(b, a)
      await sleep(5000) // trabajas en A más que el límite (3 s)…
      await activate(b, o) // …y cambias a B
      await sleep(400)
      const r = await b.evalSW('zzz.sweep(Date.now() + 1000)') // 1 s después de dejarla
      expect(r.slept === 0, `acabas de dejar A (hace 1 s) y no debía dormirse: ${JSON.stringify(r)}`)
      expect((await tabsOf(b, gA)).every((t) => !t.discarded), 'la pestaña recién abandonada se durmió')
      await b.evalSW('zzz.sweep(Date.now() + 10000)') // 10 s después sí es ociosa
      expect((await tabsOf(b, gA)).every((t) => t.discarded), 'pasado el límite SÍ debía dormirse')
      expect((await tabsOf(b, gB)).every((t) => !t.discarded), 'la activa no se duerme')
    }
  },
  {
    // Hallazgo #2: despertar a propósito un grupo no debe deshacerse en el siguiente barrido.
    name: 'woken_group_not_reslept_by_sweep',
    fn: async (b, site) => {
      await needSweep(b)
      const ids = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'W')
      await activate(b, o)
      await setSettings(b, { rules: { 't:W': { mode: 'minutes', minutes: 0.05 } } })
      await sleep(4000) // su marca de tiempo queda vieja (> 3 s)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      expect((await tabsOf(b, gid)).every((t) => t.discarded), 'precondición: el grupo debía estar dormido')
      await b.evalSW(`zzz.wakeGroup(${gid}, 50)`)
      await sleep(300)
      const r = await b.evalSW('zzz.sweep(Date.now() + 1000)')
      expect(r.slept === 0, `acabas de despertar el grupo a propósito y el barrido lo volvió a dormir: ${JSON.stringify(r)}`)
      expect((await tabsOf(b, gid)).every((t) => !t.discarded), 'el grupo despertado a propósito se volvió a dormir')
    }
  },
  {
    // Hallazgo #3a: el sonido cuenta como uso (el `audible` nativo solo dura 2 s).
    name: 'audible_event_is_recorded',
    fn: async (b, site) => {
      const au = await b.newTab(site.url('audio', { t: 'suena' }))
      await waitFor(async () => (await b.evalSW('chrome.storage.session.get(null).then((o) => Object.keys(o))')).includes(`audible:${au}`), { what: 'que se anote el sonido de la pestaña' })
    }
  },
  {
    // Hallazgo #3b: «dormir los demás» no corta una llamada que calló unos segundos.
    name: 'sleep_others_spares_recently_audible',
    fn: async (b, site) => {
      const a = await b.newTab(site.url('plain', { t: 'trabajo' }))
      const au = await b.newTab(site.url('audio', { t: 'llamada' }))
      const gA = await makeGroup(b, [a], 'A')
      const gB = await makeGroup(b, [au], 'B', 'red')
      await activate(b, a)
      await waitFor(async () => (await tabsOf(b, gB))[0].audible, { what: 'que suene la llamada' })
      // La llamada calla: la pestaña pasa a una página sin sonido.
      await b.evalSW(`chrome.tabs.update(${au}, { url: ${JSON.stringify(site.url('plain', { t: 'en-silencio' }))} })`)
      await waitFor(async () => { const t = (await tabsOf(b, gB))[0]; return t && !t.audible }, { what: 'que la pestaña deje de sonar' })
      await b.evalSW(`zzz.sleepOthers(${gA})`)
      expect((await tabsOf(b, gB)).every((t) => !t.discarded), 'se durmió una pestaña que sonó hace menos de 60 s')
    }
  },
  {
    // Hallazgo #4: el radio invisible tapaba el campo de minutos de cada grupo.
    name: 'options_minutes_field_is_clickable',
    fn: async (b, site) => {
      const [a] = await mk(b, site, 1, 'plain')
      await makeGroup(b, [a], 'Ads', 'red')
      const page = await openExtensionPage(b, 'options/options.html')
      await waitFor(() => page.eval('!!document.querySelector(\'[data-rule-key="t:Ads"] .minutes\')'), { what: 'el campo de minutos de Ads' })
      const hit = await page.eval(`(() => {
        const el = document.querySelector('[data-rule-key="t:Ads"] .minutes')
        el.scrollIntoView({ block: 'center' }) // a la vista: elementFromPoint solo ve lo que está en pantalla
        const r = el.getBoundingClientRect()
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el
      })()`)
      expect(hit === true, 'en el centro del campo de minutos hay otro elemento encima (no se puede pulsar con ratón)')
      page.close()
    }
  },
  {
    // Hallazgo #5: renombrar un grupo con candado no debe quitarle la protección.
    name: 'renamed_group_keeps_lock',
    fn: async (b, site) => {
      const [a] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, [a], 'Ads', 'red')
      expect((await b.evalSW(`zzz.toggleLock(${gid})`)) === true, 'precondición: candado puesto')
      await b.evalSW(`chrome.tabGroups.update(${gid}, { title: 'Ads cliente' }).then(() => true)`)
      await waitFor(async () => (await getSettings(b)).rules['t:Ads cliente']?.mode === 'never', { ms: 20000, what: 'que el candado siga al grupo renombrado (tras quedar quieto el título)' })
      expect((await getSettings(b)).rules['t:Ads'] === undefined, 'la regla vieja debía desaparecer')
    }
  }
]

await runTests('Automático y reglas', tests)
