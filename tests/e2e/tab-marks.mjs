// 💤 en el título de cada pestaña dormida y pulido (popup en vivo, vecina, avisos…).
// Uso: node tests/e2e/phase4.mjs   (Chromium aparte, perfil temporal, sin ventana)
// Los tests marcados `variant` usan una copia temporal de la extensión con el acceso a las webs ya concedido.
import { runTests, makeGroup, makeTabs as mk, activate, tabsOf, openExtensionPage, waitFor, sleep, expect } from './util.mjs'

const needFn = async (b, name) => expect((await b.evalSW(`typeof zzz.${name}`)) === 'function', `zzz.${name} no existe todavía`)
const setSettings = (b, s) => b.evalSW(`zzz.saveSettings(${JSON.stringify(s)}).then(() => true)`)
const getSettings = (b) => b.evalSW('zzz.loadSettings()')
const titles = (b) => b.evalSW('chrome.tabs.query({}).then((ts) => ts.map((t) => t.title))')
const activeTabId = (b) => b.evalSW('chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((ts) => ts[0].id)')

const tests = [
  // ---------------- A · 💤 en el título de la pestaña ----------------
  {
    name: 'tab_title_marked_when_slept', variant: true,
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      await setSettings(b, { markTabs: true })
      const [o] = await mk(b, site, 1, 'plain')
      const t = await b.newTab(site.url('plain', { t: 'Gmail-x' }))
      await activate(b, o)
      const r = await b.evalSW(`zzz.sleepTab(${t})`)
      expect(r.slept === 1, `debía dormirse: ${JSON.stringify(r)}`)
      const all = await titles(b)
      expect(all.includes('💤 Gmail-x'), `la pestaña dormida debía llamarse «💤 Gmail-x»: ${JSON.stringify(all)}`)
    }
  },
  {
    name: 'tab_title_marked_for_group_sleep', variant: true,
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      await setSettings(b, { markTabs: true })
      const ids = [await b.newTab(site.url('plain', { t: 'uno' })), await b.newTab(site.url('plain', { t: 'dos' }))]
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, o)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      const all = await titles(b)
      expect(all.includes('💤 uno') && all.includes('💤 dos'), `ambas del grupo debían llevar 💤: ${JSON.stringify(all)}`)
    }
  },
  {
    name: 'tab_title_restored_on_wake', variant: true,
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      await setSettings(b, { markTabs: true })
      const [o] = await mk(b, site, 1, 'plain')
      const t = await b.newTab(site.url('plain', { t: 'Gmail-x' }))
      await activate(b, o)
      await b.evalSW(`zzz.sleepTab(${t})`)
      const sleeping = (await b.evalSW('chrome.tabs.query({ discarded: true }).then((ts) => ts.map((x) => x.id))'))[0]
      await b.evalSW(`zzz.wakeTab(${sleeping})`)
      await waitFor(async () => { const all = await titles(b); return all.includes('Gmail-x') && !all.some((x) => x.startsWith('💤')) }, { what: 'que al despertar vuelva el título original sin 💤' })
    }
  },
  {
    name: 'tab_title_untouched_when_setting_off', variant: true,
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      await setSettings(b, { markTabs: false })
      const [o] = await mk(b, site, 1, 'plain')
      const t = await b.newTab(site.url('plain', { t: 'Gmail-x' }))
      await activate(b, o)
      await b.evalSW(`zzz.sleepTab(${t})`)
      const all = await titles(b)
      expect(all.includes('Gmail-x') && !all.some((x) => x.startsWith('💤')), `con el interruptor apagado no debía cambiar el título: ${JSON.stringify(all)}`)
    }
  },
  {
    name: 'group_sleep_leaves_tab_titles_alone_when_setting_off', variant: true,
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      await setSettings(b, { markTabs: false })
      const ids = [await b.newTab(site.url('plain', { t: 'uno' })), await b.newTab(site.url('plain', { t: 'dos' }))]
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, o)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      const all = await titles(b)
      expect(all.includes('uno') && all.includes('dos') && !all.some((x) => x.startsWith('💤')), `con el interruptor apagado dormir un grupo no debe tocar los títulos: ${JSON.stringify(all)}`)
    }
  },
  {
    name: 'internal_page_sleeps_without_error', variant: true,
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      await setSettings(b, { markTabs: true })
      const [o] = await mk(b, site, 1, 'plain')
      const internal = await b.newTab('chrome://version')
      await activate(b, o)
      const r = await b.evalSW(`zzz.sleepTab(${internal})`) // no debe lanzar aunque no se pueda escribir el título
      expect(typeof r.slept === 'number', `sleepTab debía devolver un resultado: ${JSON.stringify(r)}`)
      expect(!(await titles(b)).some((x) => x.startsWith('💤')), 'una página interna no puede llevar 💤 en el título')
    }
  },
  {
    name: 'options_mark_tabs_switch', variant: true,
    fn: async (b) => {
      const page = await openExtensionPage(b, 'options/options.html')
      await waitFor(() => page.eval('!!document.querySelector("#mark-tabs")'), { what: 'el interruptor «💤 en el título de cada pestaña»' })
      await page.eval('document.querySelector("#mark-tabs").click()', { gesture: true })
      await waitFor(async () => (await getSettings(b)).markTabs === true, { what: 'markTabs = true (con el permiso ya concedido no hay aviso)' })
      await page.eval('document.querySelector("#mark-tabs").click()', { gesture: true })
      await waitFor(async () => (await getSettings(b)).markTabs === false, { what: 'markTabs = false' })
      expect(page.errors.length === 0, `errores de consola en las opciones: ${page.errors.join(' | ')}`)
      page.close()
    }
  },
  {
    name: 'least_privilege_without_permission',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      expect((await b.evalSW("chrome.permissions.contains({ origins: ['http://*/*'] })")) === false, 'el manifest real NO debe traer acceso a las webs concedido')
      await setSettings(b, { markTabs: true }) // activado pero sin permiso
      await b.evalSW('(() => { globalThis.__injected = 0; const o = chrome.scripting.executeScript; chrome.scripting.executeScript = (...a) => { globalThis.__injected++; return o.apply(chrome.scripting, a) }; return true })()')
      const [o] = await mk(b, site, 1, 'plain')
      const t = await b.newTab(site.url('plain', { t: 'Gmail-x' }))
      await activate(b, o)
      const r = await b.evalSW(`zzz.sleepTab(${t})`)
      expect(r.slept === 1, `sin permiso debía dormirse igual: ${JSON.stringify(r)}`)
      const all = await titles(b)
      expect(all.includes('Gmail-x') && !all.some((x) => x.startsWith('💤')), `sin permiso no se puede tocar el título: ${JSON.stringify(all)}`)
      expect((await b.evalSW('globalThis.__injected')) === 0, 'sin permiso Zzz ni siquiera debe intentar inyectar nada')
    }
  },

  // ---------------- B · minors diferidos ----------------
  {
    name: 'wake_group_survives_closed_tab',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ids = await mk(b, site, 3, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, o)
      await b.evalSW(`zzz.sleepGroup(${gid})`)
      const ts = await tabsOf(b, gid)
      const wake = b.evalSW(`zzz.wakeGroup(${gid}, 400).then((n) => ({ n }), (e) => ({ error: String(e) }))`)
      await sleep(150)
      await b.evalSW(`chrome.tabs.remove(${ts[1].id}).then(() => true)`) // se cierra una a mitad del despertar
      const r = await wake
      expect(!r.error, `un fallo en una pestaña no debe cortar el despertar: ${r.error}`)
      expect(r.n === 2, `debían despertar las 2 que quedaban: ${JSON.stringify(r)}`)
      await waitFor(async () => (await tabsOf(b, gid)).every((t) => !t.discarded), { what: 'que las que quedan estén despiertas' })
    }
  },
  {
    name: 'sleep_failure_is_reported',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ids = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, o)
      await b.evalSW('(() => { chrome.tabs.discard = () => Promise.reject(new Error("boom")); return true })()')
      const r = await b.evalSW(`zzz.sleepGroup(${gid})`)
      expect(r.slept === 0 && r.failed === 2, `debía informar de 2 fallos: ${JSON.stringify(r)}`)
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval(`!!document.querySelector('[data-group-id="${gid}"] [data-action="sleep"]')`), { what: 'el grupo en el popup' })
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-action="sleep"]').click()`)
      await waitFor(async () => /No se pudo/.test(await page.eval('(document.querySelector("#notice") || { innerText: "" }).innerText')), { what: 'el aviso «No se pudo dormir…» en el popup' })
      page.close()
    }
  },
  {
    name: 'unlock_removes_the_rule',
    fn: async (b, site) => {
      const ids = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'Ads', 'red')
      expect((await b.evalSW(`zzz.toggleLock(${gid})`)) === true, 'candado puesto')
      expect((await b.evalSW(`zzz.toggleLock(${gid})`)) === false, 'candado quitado')
      const rules = (await getSettings(b)).rules
      expect(Object.keys(rules).length === 0, `quitar el candado no debe dejar reglas vacías: ${JSON.stringify(rules)}`)
    }
  },
  {
    name: 'options_rejects_minutes_below_one',
    fn: async (b, site) => {
      const ids = await mk(b, site, 1, 'plain')
      await makeGroup(b, ids, 'Ads', 'red')
      const page = await openExtensionPage(b, 'options/options.html')
      await waitFor(() => page.eval('!!document.querySelector(\'[data-rule-key="t:Ads"] .minutes\')'), { what: 'las opciones cargadas' })
      const renders = () => page.eval('Number(document.querySelector("#rules").dataset.renders)')
      let n = await renders()
      await page.eval(`(() => { const i = document.querySelector('#default-minutes'); i.value = '0.1'; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await waitFor(async () => (await renders()) > n, { what: 'que se repinte rechazando el valor' })
      expect((await getSettings(b)).defaultMinutes === 15, 'no debía aceptar 0,1 minutos')
      expect((await page.eval('document.querySelector("#default-minutes").value')) === '15', 'el campo debía volver a 15')
      n = await renders()
      await page.eval(`(() => { const i = document.querySelector('[data-rule-key="t:Ads"] .minutes'); i.value = '0.5'; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await waitFor(async () => (await renders()) > n, { what: 'que se repinte rechazando el valor del grupo' })
      expect((await getSettings(b)).rules['t:Ads'] === undefined, 'no debía guardar una regla de 0,5 minutos')
      page.close()
    }
  },
  {
    name: 'neighbor_prefers_same_group',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const [g1, g2] = await mk(b, site, 2, 'plain')
      const [h1] = await mk(b, site, 1, 'plain')
      await makeGroup(b, [g1, g2], 'G', 'red')
      await makeGroup(b, [h1], 'H', 'green')
      await activate(b, g2)
      await b.evalSW(`zzz.sleepTab(${g2})`)
      expect((await activeTabId(b)) === g1, 'al dormir la activa debía pasar a la vecina de SU grupo (g1), no a otro grupo')
    }
  },
  {
    name: 'neighbor_avoids_collapsed_group',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const [u1, g1] = await mk(b, site, 2, 'plain')
      const [h1] = await mk(b, site, 1, 'plain')
      await makeGroup(b, [g1], 'G', 'red')
      const gH = await makeGroup(b, [h1], 'H', 'green')
      await b.evalSW(`chrome.tabGroups.update(${gH}, { collapsed: true }).then(() => true)`)
      await activate(b, g1)
      await b.evalSW(`zzz.sleepTab(${g1})`)
      expect((await activeTabId(b)) === u1, 'no debía saltar a una pestaña de un grupo plegado (se desplegaría)')
    }
  },
  {
    name: 'popup_updates_live',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ids = await mk(b, site, 2, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval(`!!document.querySelector('[data-group-id="${gid}"]')`), { what: 'el popup con el grupo' })
      expect(/^0 de/.test(await page.eval('document.querySelector("#status").innerText')), 'precondición: 0 dormidas')
      await b.evalSW(`zzz.sleepTab(${ids[0]})`) // alguien duerme una pestaña con el popup abierto
      await waitFor(async () => /^1 de/.test(await page.eval('document.querySelector("#status").innerText')), { ms: 6000, what: 'que el popup se actualice solo' })
      page.close()
    }
  },
  {
    name: 'popup_keeps_keyboard_focus',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ids = await mk(b, site, 2, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval(`!!document.querySelector('[data-group-id="${gid}"] [data-action="lock"]')`), { what: 'el botón de candado' })
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-action="lock"]').focus()`)
      await b.evalSW(`zzz.sleepTab(${ids[0]})`) // fuerza un repintado con el foco en el candado
      await waitFor(async () => /^1 de/.test(await page.eval('document.querySelector("#status").innerText')), { ms: 6000, what: 'el repintado' })
      const focused = await page.eval(`(() => { const a = document.activeElement; const row = a && a.closest && a.closest('[data-group-id]'); return a ? a.dataset.action + '@' + (row ? row.dataset.groupId : '?') : 'nada' })()`)
      expect(focused === `lock@${gid}`, `el foco debía seguir en el candado del grupo tras repintar: ${focused}`)
      page.close()
    }
  }
  ,
  // -------- Regresiones --------
  {
    // #1 Important: una página colgada no puede bloquear el dormir de las demás.
    name: 'hung_page_does_not_block_sleeping', variant: true,
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      await setSettings(b, { markTabs: true })
      const ids = [await b.newTab(site.url('plain', { t: 'uno' })), await b.newTab(site.url('plain', { t: 'dos' }))]
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, o)
      await b.evalSW('(() => { chrome.scripting.executeScript = () => new Promise(() => {}); return true })()') // la inyección nunca responde
      const r = await Promise.race([b.evalSW(`zzz.sleepGroup(${gid})`), sleep(9000).then(() => 'TIMEOUT')])
      expect(r !== 'TIMEOUT', 'dormir el grupo se quedó colgado esperando a una página que no responde')
      expect(r.slept === 2, `debían dormirse las 2 aun sin poder marcarlas: ${JSON.stringify(r)}`)
    }
  },
  {
    // #6 Minor: una página sin título queda «💤 sitio», no «💤» a secas.
    name: 'tab_without_title_gets_hostname_mark', variant: true,
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      await setSettings(b, { markTabs: true })
      const [o] = await mk(b, site, 1, 'plain')
      const t = await b.newTab(site.url('notitle'))
      await activate(b, o)
      await b.evalSW(`zzz.sleepTab(${t})`)
      const all = await titles(b)
      expect(all.includes('💤 127.0.0.1'), `una página sin título debía quedar «💤 127.0.0.1»: ${JSON.stringify(all)}`)
    }
  },
  {
    // #5 Minor: no se marca una pestaña que aún está cargando (el historial y los grupos guardados copian el título).
    name: 'loading_tab_is_not_marked', variant: true,
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      await setSettings(b, { markTabs: true })
      const [o] = await mk(b, site, 1, 'plain')
      const id = await b.evalSW(`chrome.tabs.create({ url: ${JSON.stringify(site.url('slow', { t: 'lenta' }))}, active: false }).then((t) => t.id)`)
      await waitFor(() => b.evalSW(`chrome.tabs.get(${id}).then((t) => t.status === 'loading' && /^http/.test(t.url))`), { what: 'una pestaña con la página ya empezada pero aún cargando' })
      await activate(b, o)
      const t0 = Date.now()
      const r = await b.evalSW(`zzz.sleepTab(${id})`)
      const elapsed = Date.now() - t0
      expect(r.slept === 1, `debía dormirse: ${JSON.stringify(r)}`)
      expect(!(await titles(b)).some((x) => x.startsWith('💤')), 'una pestaña que aún carga no debe marcarse')
      // Sin la comprobación, la inyección esperaría a que termine de cargar y solo la cortaría el tiempo máximo (1 s).
      expect(elapsed < 800, `con la página cargando no debía esperarse a la inyección: tardó ${elapsed} ms`)
    }
  },
  {
    // #4 Minor: si el permiso desaparece, el interruptor se apaga solo.
    name: 'mark_tabs_follows_permission_revocation',
    fn: async (b) => {
      await needFn(b, 'syncMarkTabs')
      await setSettings(b, { markTabs: true }) // activado, pero el permiso real no está concedido
      await b.evalSW('zzz.syncMarkTabs().then(() => true)')
      expect((await getSettings(b)).markTabs === false, 'sin permiso concedido, markTabs debía apagarse')
    }
  },
  {
    // #9 Minor: el flujo de pedir/retirar el permiso se ejecuta de verdad (con las llamadas de Chrome sustituidas).
    name: 'options_request_and_remove_permission_flow',
    fn: async (b) => {
      const page = await openExtensionPage(b, 'options/options.html')
      await waitFor(() => page.eval('!!document.querySelector("#mark-tabs")'), { what: 'el interruptor' })
      await page.eval(`(() => { window.__asked = []; window.__removed = []; window.__grant = true
        chrome.permissions.request = (o) => { window.__asked.push(o); return Promise.resolve(window.__grant) }
        chrome.permissions.remove = (o) => { window.__removed.push(o); return Promise.resolve(true) } })()`)
      await page.eval('document.querySelector("#mark-tabs").click()', { gesture: true })
      await waitFor(async () => (await getSettings(b)).markTabs === true, { what: 'markTabs = true tras conceder el permiso' })
      const asked = await page.eval('window.__asked')
      expect(JSON.stringify(asked) === JSON.stringify([{ origins: ['http://*/*', 'https://*/*'] }]), `debía pedir solo http/https: ${JSON.stringify(asked)}`)
      await page.eval('document.querySelector("#mark-tabs").click()', { gesture: true })
      await waitFor(async () => (await getSettings(b)).markTabs === false, { what: 'markTabs = false' })
      expect((await page.eval('window.__removed')).length === 1, 'al apagarlo debía retirar el permiso')
      await page.eval('window.__grant = false')
      await page.eval('document.querySelector("#mark-tabs").click()', { gesture: true })
      await waitFor(() => page.eval('/Sin ese permiso/.test(document.querySelector("#mark-tabs-note").innerText)'), { what: 'el aviso de permiso rechazado' })
      expect((await getSettings(b)).markTabs === false, 'sin permiso no debía activarse')
      expect((await page.eval('document.querySelector("#mark-tabs").checked')) === false, 'el interruptor debía volver a apagado')
      page.close()
    }
  },
  {
    // #3 Minor: el texto dice exactamente qué concede el permiso.
    name: 'options_note_is_honest_about_the_permission',
    fn: async (b) => {
      const page = await openExtensionPage(b, 'options/options.html')
      await waitFor(() => page.eval('!!document.querySelector("#mark-tabs-note")'), { what: 'la nota' })
      const text = await page.eval('document.querySelector("#mark-tabs-note").innerText')
      expect(/todos tus datos/i.test(text) && /http/i.test(text) && /red/i.test(text), `la nota debía decir qué concede el permiso y que con él el bloqueo de red no se garantiza: ${text}`)
      page.close()
    }
  },
  {
    // #2 Important: no se repinta con el ratón pulsado (se perdía el clic).
    name: 'popup_does_not_repaint_while_pressed',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ids = await mk(b, site, 2, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval(`!!document.querySelector('[data-group-id="${gid}"]')`), { what: 'el popup' })
      await page.eval('document.querySelector("#groups").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))')
      await b.evalSW(`zzz.sleepTab(${ids[0]})`)
      await sleep(1200) // de sobra para el repintado en vivo
      expect(/^0 de/.test(await page.eval('document.querySelector("#status").innerText')), 'se repintó con el ratón pulsado')
      await page.eval('window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))')
      await waitFor(async () => /^1 de/.test(await page.eval('document.querySelector("#status").innerText')), { ms: 6000, what: 'que se repinte al soltar' })
      page.close()
    }
  },
  {
    // #2 Important: repintar no devuelve el scroll arriba.
    name: 'popup_refresh_does_not_scroll_back',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const loose = await mk(b, site, 24, 'plain')
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval('!!document.querySelector(\'[data-group-id="-1"] [data-action="toggle"]\')'), { what: 'la fila Sin grupo' })
      await page.eval('document.querySelector(\'[data-group-id="-1"] [data-action="toggle"]\').click()')
      await waitFor(async () => (await page.eval('document.querySelectorAll(\'[data-group-id="-1"] [data-tab-id]\').length')) >= 24, { what: 'la lista larga desplegada' })
      await page.eval('document.querySelector(\'[data-group-id="-1"] [data-action="toggle"]\').focus()')
      await page.eval('document.scrollingElement.scrollTop = 300')
      const before = await page.eval('document.scrollingElement.scrollTop')
      expect(before > 100, `precondición: la lista debía poder desplazarse (scrollTop=${before})`)
      await b.evalSW(`zzz.sleepTab(${loose[0]})`)
      await waitFor(async () => /^1 de/.test(await page.eval('document.querySelector("#status").innerText')), { ms: 6000, what: 'el repintado' })
      const after = await page.eval('document.scrollingElement.scrollTop')
      expect(Math.abs(after - before) < 6, `el repintado movió el scroll de ${before} a ${after}`)
      page.close()
    }
  },
  {
    // #7 Minor: «no pasó nada» se explica.
    name: 'popup_explains_when_nothing_could_sleep',
    fn: async (b, site) => {
      const ids = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'Sola')
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval(`!!document.querySelector('[data-group-id="${gid}"] [data-action="sleep"]')`), { what: 'el grupo' })
      await activate(b, ids[0]) // su única pestaña es la activa: no se puede dormir
      await page.eval(`document.querySelector('[data-group-id="${gid}"] [data-action="sleep"]').click()`)
      await waitFor(async () => /No había nada que dormir/.test(await page.eval('document.querySelector("#notice").innerText')), { what: 'la explicación de por qué no pasó nada' })
      page.close()
    }
  },
  {
    // #7 Minor: si el automático falla, el popup lo dice.
    name: 'auto_sleep_failure_is_visible_in_popup',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const ids = await mk(b, site, 2, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      await makeGroup(b, ids, 'G')
      await activate(b, o)
      await setSettings(b, { rules: { 't:G': { mode: 'minutes', minutes: 0.05 } } })
      await b.evalSW('(() => { chrome.tabs.discard = () => Promise.reject(new Error("boom")); return true })()')
      const r = await b.evalSW('zzz.sweep(Date.now() + 10000)')
      expect(r.slept === 0 && r.failed === 2, `el barrido debía informar de 2 fallos: ${JSON.stringify(r)}`)
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(async () => /automático/i.test(await page.eval('document.querySelector("#notice").innerText')), { what: 'el aviso del automático en el popup' })
      page.close()
    }
  },
  {
    // #8 Minor: para una pestaña suelta, la vecina preferida es la inmediata, no otra suelta lejana.
    name: 'neighbor_for_loose_tab_is_adjacent',
    fn: async (b, site) => {
      await needFn(b, 'sleepTab')
      const [g1, x] = await mk(b, site, 2, 'plain') // orden: about:blank (suelta, lejana), g1 (grupo), x (suelta, activa)
      await makeGroup(b, [g1], 'G', 'red')
      await activate(b, x)
      await b.evalSW(`zzz.sleepTab(${x})`)
      expect((await activeTabId(b)) === g1, 'debía pasar a la pestaña inmediata (g1), no a una suelta de la otra punta')
    }
  }
  ,
  {
    // Carrera hallada en la regresión: un repintado en vivo no debe cambiar lo que el usuario acaba de pulsar.
    name: 'popup_auto_switch_keeps_the_users_intent',
    fn: async (b) => {
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval('!!document.querySelector("#auto")'), { what: 'el interruptor Auto' })
      expect((await getSettings(b)).autoEnabled === true, 'precondición: Auto empieza ON')
      // El usuario lo apaga y, un instante después, un repintado en vivo lo vuelve a poner con el valor guardado (ON).
      await page.eval(`(() => {
        const el = document.querySelector('#auto')
        el.checked = false
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.checked = true
      })()`)
      await waitFor(async () => (await getSettings(b)).autoEnabled === false, { what: 'que se guarde lo que el usuario pulsó (OFF), no lo que puso el repintado' })
      page.close()
    }
  }
]

await runTests('💤 en la pestaña y pulido', tests)
