# Zzz — put Chromium tabs to sleep, by group or one by one

🇪🇸 [Léeme en español](README.es.md)

Chromium's built-in *Memory Saver* decides by itself which tabs to unload, and gives you no say. **Zzz gives you
control:** put a whole tab group to sleep, a single tab, everything else, or the other windows — by hand or
automatically, with a time (or a 🔒 "never") per group. A sleeping tab frees the memory of its renderer process and
reloads when you click it.

> **Status:** a personal project, built and tested on **Chromium 154 on Linux (Arch)**. It needs Chrome/Chromium
> **150 or newer** (it uses the tab context-menu API added in 150). It is **not** on the Chrome Web Store: you load it
> unpacked. The interface and the code comments are in **Spanish**; translations are welcome.

## What it does

- **Popup (the Z button):** every tab group of every window plus an "ungrouped tabs" row. Each row shows how many tabs
  are asleep and what the automatic mode will do with it (`auto 15 min`, `🔒 nunca`, `auto apagado`). Expand a row (▾) to see
  its tabs with a 💤 on the sleeping ones and a button to sleep or wake **just that tab**.
- **Right-click** on a tab in the tab strip, or anywhere on a page (links, selections, images… too):
  sleep only this tab · sleep this group · sleep all the other groups · toggle 🔒 "never sleep" · wake this group.
- **Shortcuts:** `Alt+Shift+D` sleeps the current tab's group, `Alt+Shift+S` sleeps only the current tab and moves you to a
  neighbouring awake one (change them in `chrome://extensions/shortcuts`).
- **Automatic mode:** every minute, a tab idle for longer than its group's time is put to sleep (default 15 min; each group, and
  the ungrouped tabs, can have their own time or 🔒). "Idle" counts from when you **left** the tab; playing sound or waking a tab
  on purpose counts as use. A "Sweep now" button applies the rules immediately, even with the automatic mode off.
- **Group chips:** the group title shows `💤 Ads` when the whole group sleeps, `Parking 💤3/5` when partly, and goes back to
  `Parking` when awake. It waits until you stop typing a group name before touching it. Switchable.
- **Optional — 💤 in each sleeping tab's title** (`💤 Gmail`). Chromium cannot draw anything on a tab, so this changes the page
  title right before sleeping it. It needs optional access to websites; see *Security* below.
- **Other windows:** a "sleep the other windows" button (only with more than one window).

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. **Load unpacked** and choose the repository folder.
4. (Optional) pin the **Z** icon to the toolbar.

## What is never put to sleep

- The active tab of each window, and a tab that is playing sound. (A recently silent one is spared by "sleep the others".)
- A 🔒 group is spared by the automatic mode, "sleep all the others" and "sleep the other windows". The explicit "sleep this
  group" does sleep it.
- **Pinned tabs and tabs with unsaved forms DO sleep**, and what you typed can be lost. Lock the groups where you edit things
  (an ads dashboard, a draft email…).

## Security — read this

- **By default Zzz has no access to any website.** Website access (http/https) is an **optional** permission requested only
  when you turn on "Poner 💤 en el título de cada pestaña dormida" in the options page. It is removed when you turn it off (or if
  you revoke it from `chrome://extensions`, in which case the switch turns itself off).
- **Without that permission** the extension's own pages cannot send data anywhere: the manifest CSP blocks
  fetch/XHR/WebSocket (`connect-src 'none'`) and external images, forms and iframes.
- **With that permission**, Chromium describes it as "read and change all your data" on those sites (there is no narrower
  permission to change just the title). Zzz only injects two tiny functions that touch `document.title` and read nothing from the
  page (`lib/tabmarks.js`), but the manifest's network block **does not cover code running inside web pages**: that guarantee
  then depends on you reading the code, which is short. If you don't want that risk, leave the switch off — everything else
  works the same.
- Required permissions: `tabGroups`, `contextMenus`, `storage`, `alarms`, `tabs` (to show tab titles in the list), `scripting`.

## Known limitations

- No context menu on the group chip itself: Chromium offers extensions no such context (right-click any tab of the group instead).
- No per-group memory figures (the API for that is not available in stable Chrome).
- Chromium always keeps one awake tab per window (it will not discard the active one).
- Tabs that Chromium itself discards (its own Memory Saver) get no 💤 in their title; they just look dimmed.
- Group titles are modified by Zzz (`💤 …`). **Turn the chip marks off in the options before uninstalling**, or they stay in the names.
- Tested only on one machine (Chromium 154, Linux). Long-term coexistence with Chromium's own Memory Saver is not verified.

## Development and tests

No dependencies, no build step. Node 22 or newer (developed with Node 26) and a `chromium` binary in your `PATH`.

```
npm test          # pure-logic unit tests and manifest checks (node:test)
npm run test:e2e  # end-to-end suites, about 20 minutes (some tests wait for real alarms)
```

The end-to-end suites launch a **separate headless Chromium with a temporary profile** and drive it over the DevTools
protocol; they never touch your browser. `ONLY=text` runs just the tests whose name contains the text, and `DEBUG=1` prints full
stack traces. The design notes and the Chromium behaviours discovered while building it are in
[`docs/DESIGN.md`](docs/DESIGN.md).

## License

[MIT](LICENSE)
