// Dormir una sola pestaña, 💤 en el chip del grupo, lista de pestañas en el popup y bloqueo de red.
// Uso: node tests/e2e/phase3.mjs   (Chromium aparte, perfil temporal, sin ventana)
import { runTests, makeGroup, makeTabs as mk, activate, tabsOf, openExtensionPage, waitFor, sleep, expect } from './util.mjs'

const needFn = async (b, name) => expect((await b.evalSW(`typeof zzz.${name}`)) === 'function', `zzz.${name} no existe todavía`)
const groupTitle = (b, gid) => b.evalSW(`chrome.tabGroups.get(${gid}).then((g) => g.title)`)
const setSettings = (b, s) => b.evalSW(`zzz.saveSettings(${JSON.stringify(s)}).then(() => true)`)
const getSettings = (b) => b.evalSW('zzz.loadSettings()')
const asleepCount = async (b, gid) => (await tabsOf(b, gid)).filter((t) => t.discarded).length

const tests = [
  {
    name: 'sleep_single_tab_only',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ids = await mk(b, site, 3, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, o)
      const r = await b.evalSW(`zzz.sleepTab(${ids[1]})`)
      expect(r.slept === 1, `debía dormir 1: ${JSON.stringify(r)}`)
      const ts = await tabsOf(b, gid)
      expect(ts.length === 3 && ts.filter((t) => t.discarded).length === 1, 'solo una pestaña del grupo debía dormirse')
      expect(ts.find((t) => t.discarded).index === (await b.evalSW(`chrome.tabs.get(${ids[0]}).then((t) => t.index)`)) + 1, 'se durmió otra pestaña distinta a la pedida')
    }
  },
  {
    name: 'sleep_active_tab_moves_to_neighbor',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ids = await mk(b, site, 3, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, ids[1])
      const r = await b.evalSW(`zzz.sleepTab(${ids[1]})`)
      expect(r.slept === 1, `la activa debía dormirse tras pasar a la vecina: ${JSON.stringify(r)}`)
      const ts = await tabsOf(b, gid)
      expect(ts.filter((t) => t.discarded).length === 1, 'debía quedar una dormida')
      const active = ts.find((t) => t.active)
      expect(active && !active.discarded, 'la pestaña activa ahora debía ser una despierta')
    }
  },
  {
    name: 'sleep_single_ungrouped_via_menu',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const u = await mk(b, site, 3, 'plain')
      const g = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, g, 'Con grupo')
      await activate(b, g[0])
      await b.evalSW(`chrome.tabs.get(${u[0]}).then((tab) => zzz.handleMenu('sleep-tab', tab))`)
      const ungrouped = await tabsOf(b, -1)
      expect(ungrouped.filter((t) => t.discarded).length === 1, `solo la pulsada debía dormirse (sueltas dormidas: ${ungrouped.filter((t) => t.discarded).length})`)
      expect((await tabsOf(b, gid)).every((t) => !t.discarded), 'no debía tocar el grupo')
    }
  },
  {
    name: 'chip_marks_follow_sleep_and_wake',
    fn: async (b, site) => {
      await needFn(b, 'refreshChips')
      const ids = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'Ads', 'red')
      await activate(b, o)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      await waitFor(async () => (await groupTitle(b, gid)) === '💤 Ads', { what: 'el chip «💤 Ads» al dormir el grupo entero' })
      // El usuario pulsa una pestaña dormida: se despierta por sí sola y el chip pasa a «a medias».
      const ts = await tabsOf(b, gid)
      await activate(b, ts[0].id)
      await waitFor(async () => (await groupTitle(b, gid)) === 'Ads 💤1/2', { what: 'el chip «Ads 💤1/2» tras despertar una' })
      await b.evalSW(`zzz.wakeGroup(${gid}, 50)`)
      await waitFor(async () => (await groupTitle(b, gid)) === 'Ads', { what: 'el chip vuelve a «Ads» con todo despierto' })
    }
  },
  {
    name: 'chip_marks_do_not_change_the_rule',
    fn: async (b, site) => {
      await needFn(b, 'refreshChips')
      const ids = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'Ads', 'red')
      await activate(b, o)
      expect((await b.evalSW(`zzz.toggleLock(${gid})`)) === true, 'precondición: candado puesto')
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      await waitFor(async () => (await groupTitle(b, gid)) === '💤 Ads', { what: 'el chip «💤 Ads»' })
      await sleep(800) // margen para que un renombrado erróneo moviera la regla
      const rules = (await getSettings(b)).rules
      expect(rules['t:Ads']?.mode === 'never', `el candado debía seguir en t:Ads: ${JSON.stringify(rules)}`)
      expect(Object.keys(rules).length === 1, `no debían aparecer claves nuevas: ${JSON.stringify(Object.keys(rules))}`)
    }
  },
  {
    name: 'mark_toggle_off_cleans_titles',
    fn: async (b, site) => {
      await needFn(b, 'refreshChips')
      const ids = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'Ads', 'red')
      await activate(b, o)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      await waitFor(async () => (await groupTitle(b, gid)) === '💤 Ads', { what: 'el chip «💤 Ads»' })
      await setSettings(b, { markGroups: false })
      await waitFor(async () => (await groupTitle(b, gid)) === 'Ads', { what: 'que apagar el interruptor limpie el título' })
      await b.evalSW(`zzz.wakeGroup(${gid}, 50)`)
      await sleep(300)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      await sleep(1200)
      expect((await groupTitle(b, gid)) === 'Ads', 'con el interruptor apagado no debía volver a marcar')
    }
  },
  {
    name: 'popup_lists_tabs_with_sleep_state',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ads = [await b.newTab(site.url('plain', { t: 'ads-uno' })), await b.newTab(site.url('plain', { t: 'ads-dos' }))]
      const gid = await makeGroup(b, ads, 'Ads', 'red')
      await b.newTab(site.url('plain', { t: 'suelta-uno' }))
      await b.evalSW(`zzz.sleepTab(${ads[0]})`)
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval(`!!document.querySelector('[data-group-id="${gid}"] [data-action="toggle"]')`), { what: 'el botón de desplegar el grupo' })
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-action="toggle"]').click()`)
      await waitFor(async () => (await page.eval(`document.querySelectorAll('[data-group-id="${gid}"] [data-tab-id]').length`)) === 2, { what: 'las 2 pestañas del grupo' })
      const text = await page.eval(`document.querySelector('[data-group-id="${gid}"]').innerText`)
      expect(text.includes('ads-uno') && text.includes('ads-dos'), `faltan títulos en la lista: ${text.slice(0, 160)}`)
      expect((await page.eval(`document.querySelectorAll('[data-group-id="${gid}"] [data-tab-id][data-asleep="true"]').length`)) === 1, 'exactamente una pestaña del grupo debía figurar como dormida')
      await page.eval('document.querySelector(\'[data-group-id="-1"] [data-action="toggle"]\').click()')
      await waitFor(async () => (await page.eval('document.querySelector(\'[data-group-id="-1"]\').innerText')).includes('suelta-uno'), { what: 'la pestaña suelta en «Sin grupo»' })
      expect(page.errors.length === 0, `errores de consola en el popup: ${page.errors.join(' | ')}`)
      page.close()
    }
  },
  {
    name: 'popup_tab_buttons_work',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ads = await mk(b, site, 2, 'plain')
      const gid = await makeGroup(b, ads, 'Ads', 'red')
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval(`!!document.querySelector('[data-group-id="${gid}"] [data-action="toggle"]')`), { what: 'el grupo en el popup' })
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-action="toggle"]').click()`)
      await waitFor(async () => (await page.eval(`document.querySelectorAll('[data-group-id="${gid}"] [data-tab-id]').length`)) === 2, { what: 'la lista desplegada' })
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-tab-id] [data-action="sleep-tab"]').click()`)
      await waitFor(async () => (await asleepCount(b, gid)) === 1, { what: 'que el botón 💤 de la fila duerma solo esa pestaña' })
      await waitFor(() => page.eval(`!!document.querySelector('[data-group-id="${gid}"] [data-tab-id][data-asleep="true"] [data-action="wake-tab"]')`), { what: 'el botón ☀️ en la fila dormida' })
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-tab-id][data-asleep="true"] [data-action="wake-tab"]').click()`)
      await waitFor(async () => (await asleepCount(b, gid)) === 0, { what: 'que el botón ☀️ despierte esa pestaña' })
      page.close()
    }
  },
  {
    name: 'network_is_blocked_by_manifest_csp',
    fn: async (b, site) => {
      const url = site.url('plain', { t: 'fuera' })
      const sw = await b.evalSW(`fetch(${JSON.stringify(url)}).then(() => 'abierta', () => 'bloqueada')`)
      expect(sw === 'bloqueada', 'el service worker pudo hacer una petición de red (debía bloquearla el manifest)')
      const page = await openExtensionPage(b, 'popup/popup.html')
      const pg = await page.eval(`fetch(${JSON.stringify(url)}).then(() => 'abierta', () => 'bloqueada')`)
      expect(pg === 'bloqueada', 'el popup pudo hacer una petición de red (debía bloquearla el manifest)')
      page.close()
    }
  }
  ,
  {
    name: 'popup_shows_auto_rule_per_row',
    fn: async (b, site) => {
      const ads = await mk(b, site, 1, 'plain')
      const lock = await mk(b, site, 1, 'plain')
      const gAds = await makeGroup(b, ads, 'Ads', 'red')
      const gLock = await makeGroup(b, lock, 'Correo', 'green')
      await setSettings(b, { rules: { 't:Ads': { mode: 'minutes', minutes: 7 }, 't:Correo': { mode: 'never' } } })
      const page = await openExtensionPage(b, 'popup/popup.html')
      const rowText = (id) => page.eval(`(document.querySelector('[data-group-id="${id}"]') || { innerText: '' }).innerText`)
      await waitFor(async () => (await rowText(gAds)).includes('7 min'), { what: '«auto 7 min» en la fila de Ads' })
      expect((await rowText(gLock)).includes('nunca'), `la fila de Correo debía decir «nunca»: ${await rowText(gLock)}`)
      expect((await rowText(-1)).includes('15 min'), `«Sin grupo» debía mostrar «auto 15 min»: ${await rowText(-1)}`)
      await setSettings(b, { autoEnabled: false })
      page.close()
      const page2 = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(async () => (await page2.eval('(document.querySelector(\'[data-group-id="-1"]\') || { innerText: "" }).innerText')).includes('auto apagado'), { what: '«auto apagado» con el interruptor general en OFF' })
      page2.close()
    }
  },
  {
    name: 'options_explains_loose_tabs',
    fn: async (b, site) => {
      const page = await openExtensionPage(b, 'options/options.html')
      await waitFor(() => page.eval('!!document.querySelector(\'[data-rule-key="__sin_grupo__"]\')'), { what: 'la fila «Sin grupo»' })
      const text = await page.eval('document.querySelector(\'[data-rule-key="__sin_grupo__"]\').innerText')
      expect(/sueltas/i.test(text) && /autom/i.test(text), `la fila «Sin grupo» debía explicar que el automático también duerme las sueltas: ${text.slice(0, 160)}`)
      expect((await page.eval('!!document.querySelector("#mark-groups")')) === true, 'falta el interruptor «Mostrar 💤 en el nombre del grupo»')
      page.close()
    }
  }
  ,
  {
    // Regresión: Zzz no debe reescribir el título mientras el usuario lo está tecleando.
    name: 'chip_waits_while_user_types',
    fn: async (b, site) => {
      await needFn(b, 'refreshChips')
      const ids = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'Parking', 'grey')
      await activate(b, o)
      await b.evalSW(`zzz.sleepTab(${ids[0]})`)
      await waitFor(async () => (await groupTitle(b, gid)) === 'Parking 💤1/2', { ms: 15000, what: 'el chip «Parking 💤1/2»' })
      // El usuario empieza a teclear un nombre nuevo…
      await b.evalSW(`chrome.tabGroups.update(${gid}, { title: 'Co' }).then(() => true)`)
      await sleep(1000) // …y hace una pausa más larga que el margen de 400 ms de Zzz
      expect((await groupTitle(b, gid)) === 'Co', `Zzz reescribió el título mientras se tecleaba: ${JSON.stringify(await groupTitle(b, gid))}`)
      await b.evalSW(`chrome.tabGroups.update(${gid}, { title: 'Cochesx' }).then(() => true)`)
      // Cuando el usuario termina (5 s quieto), Zzz vuelve a poner su marca, una sola vez.
      await waitFor(async () => (await groupTitle(b, gid)) === 'Cochesx 💤1/2', { ms: 20000, what: 'que Zzz marque el título una vez terminada la edición' })
    }
  },
  {
    // Regresión: con el interruptor apagado Zzz no toca los títulos del usuario (ni para recortarlos).
    name: 'marks_off_never_rewrites_user_titles',
    fn: async (b, site) => {
      await needFn(b, 'refreshChips')
      const ids = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'Google ', 'blue') // espacio final a propósito
      await setSettings(b, { markGroups: false })
      await activate(b, o)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      await sleep(7500) // más que el margen de edición: aquí sí habría reescrito
      expect((await groupTitle(b, gid)) === 'Google ', `con el interruptor apagado el título debía quedar tal cual: ${JSON.stringify(await groupTitle(b, gid))}`)
    }
  },
  {
    // Regresión: renombrar tecleando no debe mover/robar reglas por el camino.
    name: 'rename_while_typing_does_not_steal_rules',
    fn: async (b, site) => {
      const a1 = await mk(b, site, 1, 'plain')
      const a2 = await mk(b, site, 1, 'plain')
      const gAds = await makeGroup(b, a1, 'Ads', 'red')
      const gCli = await makeGroup(b, a2, 'Ads cliente', 'green')
      await b.evalSW(`zzz.toggleLock(${gCli})`) // candado en «Ads cliente»
      await setSettings(b, { rules: { 't:Ads cliente': { mode: 'never' }, 't:Ads': { mode: 'minutes', minutes: 9 } } })
      // Borra y reescribe el nombre pasando por «Ads », «Ads», vacío…
      for (const t of ['Ads ', 'Ads', '', 'N', 'Nuevo']) {
        await b.evalSW(`chrome.tabGroups.update(${gCli}, { title: ${JSON.stringify(t)} }).then(() => true)`)
        await b.evalSW('zzz.settleRenames().then(() => true)') // como si la alarma de cada minuto saltara a mitad de teclear
        await sleep(250)
      }
      await waitFor(async () => (await getSettings(b)).rules['t:Nuevo']?.mode === 'never', { ms: 20000, what: 'que el candado llegue a «Nuevo»' })
      const rules = (await getSettings(b)).rules
      expect(rules['t:Ads']?.mode === 'minutes' && rules['t:Ads'].minutes === 9, `la regla del grupo «Ads» debía quedar intacta: ${JSON.stringify(rules)}`)
      expect(rules['t:Ads cliente'] === undefined, `la clave vieja debía desaparecer: ${JSON.stringify(Object.keys(rules))}`)
      expect(await groupTitle(b, gAds) === 'Ads', 'el otro grupo no se toca')
    }
  },
  {
    // Regresión: las acciones del popup las ejecuta el service worker (el popup muere al cambiar de pestaña).
    name: 'popup_actions_go_through_service_worker',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ads = await mk(b, site, 2, 'plain')
      const gid = await makeGroup(b, ads, 'Ads', 'red')
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval(`!!document.querySelector('[data-group-id="${gid}"] [data-action="toggle"]')`), { what: 'el grupo en el popup' })
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-action="toggle"]').click()`)
      await waitFor(async () => (await page.eval(`document.querySelectorAll('[data-group-id="${gid}"] [data-tab-id]').length`)) === 2, { what: 'la lista desplegada' })
      await page.eval(`(() => { window.__sent = []; const o = chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage = (m, ...r) => { window.__sent.push(m); return o(m, ...r) } })()`)
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-tab-id] [data-action="sleep-tab"]').click()`)
      await waitFor(async () => (await asleepCount(b, gid)) === 1, { what: 'que la pestaña se duerma' })
      const sent = await page.eval('window.__sent')
      expect(sent.some((m) => m && m.zzz === 'sleep-tab'), `el popup debía pedírselo al service worker por mensaje: ${JSON.stringify(sent)}`)
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-action="sleep"]').click()`)
      await waitFor(async () => (await page.eval('window.__sent')).some((m) => m && m.zzz === 'sleep-group'), { what: 'que dormir el grupo también vaya por mensaje' })
      page.close()
    }
  },
  {
    // Regresión: el CSP cierra también imágenes, formularios e iframes, no solo fetch.
    name: 'csp_blocks_images_forms_and_frames',
    fn: async (b, site) => {
      const url = site.url('plain', { t: 'fuera' })
      const page = await openExtensionPage(b, 'popup/popup.html')
      const violated = await page.eval(`new Promise((resolve) => {
        const seen = new Set()
        document.addEventListener('securitypolicyviolation', (e) => seen.add(e.effectiveDirective))
        const img = new Image(); img.src = ${JSON.stringify(url)}
        const frame = document.createElement('iframe'); frame.src = ${JSON.stringify(url)}; document.body.append(frame)
        const form = document.createElement('form'); form.action = ${JSON.stringify(url)}; form.method = 'post'
        document.body.append(form)
        try { form.submit() } catch (_) {}
        setTimeout(() => resolve([...seen]), 1200)
      })`)
      expect(violated.includes('img-src'), `las imágenes externas debían bloquearse: ${JSON.stringify(violated)}`)
      expect(violated.includes('frame-src') || violated.includes('child-src'), `los iframes externos debían bloquearse: ${JSON.stringify(violated)}`)
      expect(violated.includes('form-action'), `los formularios debían bloquearse: ${JSON.stringify(violated)}`)
      page.close()
    }
  }
]

await runTests('Pestaña suelta, chips y lista', tests)
