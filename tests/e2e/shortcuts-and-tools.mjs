// Utilidades: atajos, «Barrer ahora» y «Dormir las demás ventanas».
// Uso: node tests/e2e/phase5.mjs   (Chromium aparte, perfil temporal, sin ventana)
import { runTests, makeGroup, makeTabs as mk, activate, tabsOf, openExtensionPage, waitFor, sleep, expect } from './util.mjs'

const needFn = async (b, name) => expect((await b.evalSW(`typeof zzz.${name}`)) === 'function', `zzz.${name} no existe todavía`)
const setSettings = (b, s) => b.evalSW(`zzz.saveSettings(${JSON.stringify(s)}).then(() => true)`)
const activeTabId = (b) => b.evalSW('chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((ts) => ts[0].id)')
const notice = (page) => page.eval('(document.querySelector("#notice") || { innerText: "" }).innerText')

const tests = [
  {
    name: 'command_sleep_current_tab',
    fn: async (b, site) => {
      await needFn(b, 'handleCommand')
      const ids = await mk(b, site, 3, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, ids[1])
      await b.evalSW("zzz.handleCommand('sleep-current-tab')")
      const ts = await tabsOf(b, gid)
      expect(ts.filter((t) => t.discarded).length === 1, `debía dormirse solo la pestaña actual: ${JSON.stringify(ts.map((t) => t.discarded))}`)
      const active = ts.find((t) => t.active)
      expect(active && !active.discarded, 'tras dormir la actual debía quedar activa una despierta')
    }
  },
  {
    name: 'command_sleep_current_group',
    fn: async (b, site) => {
      await needFn(b, 'handleCommand')
      const ids = await mk(b, site, 3, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gid = await makeGroup(b, ids, 'G')
      await activate(b, ids[0])
      await b.evalSW("zzz.handleCommand('sleep-current-group')")
      const ts = await tabsOf(b, gid)
      expect(ts.filter((t) => t.discarded).length === 2 && !ts.find((t) => t.active).discarded, `debían dormir las otras 2 y no la actual: ${JSON.stringify(ts.map((t) => t.discarded))}`)
      expect(!(await b.evalSW(`chrome.tabs.get(${o}).then((t) => t.discarded)`)), 'no debía tocar lo de fuera del grupo')
    }
  },
  {
    name: 'sweep_now_works_with_auto_off',
    fn: async (b, site) => {
      const idle = await mk(b, site, 2, 'plain')
      const locked = await mk(b, site, 1, 'plain')
      const [o] = await mk(b, site, 1, 'plain')
      const gIdle = await makeGroup(b, idle, 'Idle')
      const gLock = await makeGroup(b, locked, 'Lock', 'red')
      await activate(b, o)
      await setSettings(b, { autoEnabled: false, rules: { 't:Idle': { mode: 'minutes', minutes: 0.02 }, 't:Lock': { mode: 'never' } } })
      await sleep(2500) // más que 0,02 min = 1,2 s
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval('!!document.querySelector("#sweep-now")'), { what: 'el botón «Barrer ahora»' })
      await page.eval('document.querySelector("#sweep-now").click()')
      await waitFor(async () => (await tabsOf(b, gIdle)).every((t) => t.discarded), { what: 'que «Barrer ahora» duerma lo que cumple su regla aunque Auto esté apagado' })
      expect((await tabsOf(b, gLock)).every((t) => !t.discarded), 'un grupo con candado no debe dormirse')
      await waitFor(async () => /Barrido: 2/.test(await notice(page)), { what: 'el aviso «Barrido: 2 pestañas dormidas»' })
      page.close()
    }
  },
  {
    name: 'sweep_now_says_when_nothing_to_sleep',
    fn: async (b, site) => {
      await mk(b, site, 2, 'plain') // recién abiertas: con 15 min por defecto no toca nada
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval('!!document.querySelector("#sweep-now")'), { what: 'el botón «Barrer ahora»' })
      await page.eval('document.querySelector("#sweep-now").click()')
      await waitFor(async () => /Nada que dormir ahora/.test(await notice(page)), { what: 'el aviso «Nada que dormir ahora»' })
      page.close()
    }
  },
  {
    name: 'sleep_other_windows_function',
    fn: async (b, site) => {
      await needFn(b, 'sleepOtherWindows')
      const [mainTab] = await mk(b, site, 1, 'plain')
      const winA = await b.evalSW(`chrome.tabs.get(${mainTab}).then((t) => t.windowId)`)
      const urls = [site.url('plain', { t: 'b1' }), site.url('plain', { t: 'b2' }), site.url('plain', { t: 'b3' })]
      const winB = await b.evalSW(`chrome.windows.create({ url: ${JSON.stringify(urls)} }).then((w) => ({ id: w.id, tabs: w.tabs.map((t) => t.id) }))`)
      await sleep(800)
      const gB = await b.evalSW(`chrome.tabs.group({ tabIds: [${winB.tabs[1]}, ${winB.tabs[2]}] }).then((g) => chrome.tabGroups.update(g, { title: 'B', color: 'red' }).then(() => g))`)
      expect((await b.evalSW(`zzz.toggleLock(${gB})`)) === true, 'precondición: candado en el grupo de la otra ventana')
      const r1 = await b.evalSW(`zzz.sleepOtherWindows(${winA})`)
      expect((await tabsOf(b, gB)).every((t) => !t.discarded), `un grupo con candado de otra ventana no debía dormirse: ${JSON.stringify(r1)}`)
      await b.evalSW(`zzz.toggleLock(${gB})`) // quita el candado
      const r2 = await b.evalSW(`zzz.sleepOtherWindows(${winA})`)
      expect(r2.slept === 2, `debían dormir las 2 pestañas del grupo de la otra ventana (la activa no): ${JSON.stringify(r2)}`)
      expect(!(await b.evalSW(`chrome.tabs.get(${mainTab}).then((t) => t.discarded)`)), 'no debía tocar la ventana de origen')
    }
  },
  {
    name: 'popup_other_windows_button',
    fn: async (b, site) => {
      await needFn(b, 'sleepOtherWindows')
      const page = await openExtensionPage(b, 'popup/popup.html')
      await waitFor(() => page.eval('!!document.querySelector("#other-windows")'), { what: 'el botón «Dormir las demás ventanas»' })
      expect((await page.eval('document.querySelector("#other-windows").hidden')) === true, 'con una sola ventana el botón debía estar oculto')
      const urls = [site.url('plain', { t: 'b1' }), site.url('plain', { t: 'b2' })]
      await b.evalSW(`chrome.windows.create({ url: ${JSON.stringify(urls)} }).then(() => true)`)
      await waitFor(async () => (await page.eval('document.querySelector("#other-windows").hidden')) === false, { ms: 8000, what: 'que el botón aparezca al abrir otra ventana' })
      await page.eval(`(() => { window.__sent = []; const o = chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage = (m, ...r) => { window.__sent.push(m); return o(m, ...r) } })()`)
      await page.eval('document.querySelector("#other-windows").click()')
      await waitFor(async () => (await page.eval('window.__sent')).some((m) => m && m.zzz === 'sleep-other-windows'), { what: 'que el botón pida dormir las demás ventanas al service worker' })
      page.close()
    }
  }
]

await runTests('Atajos y utilidades', tests)
