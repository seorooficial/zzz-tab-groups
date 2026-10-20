# Zzz — design notes

These notes explain *why* Zzz works the way it does, and record the Chromium behaviours that cost time to discover.
Read them before changing anything non-trivial.

## Why it exists

Chromium's built-in Memory Saver unloads inactive tabs on its own schedule, with no per-group control and, in practice,
not enough of them: with ~70 tabs in a dozen groups the browser still held ~20 GB between RAM and swap. Zzz is a small
Manifest V3 extension that lets the user decide what sleeps and when. It is an extension and not a patched Chromium on
purpose: a patch would be overwritten by every browser update.

## Goals

1. Sleep a whole group, a single tab, "everything else" and "the other windows", by hand, from the popup, the right-click menu
   and keyboard shortcuts.
2. When a sleeping tab is clicked, only that tab wakes (native Chromium behaviour).
3. An automatic mode with a per-group time or a 🔒 "never", an on/off switch, and ungrouped tabs following the default.
4. Show what sleeps: a 💤 mark in the group chip, a tab list in the popup and, optionally, in each tab's title.
5. Memory really goes down (measured in the end-to-end tests).

## Non-goals

- A menu on the group chip (Chromium exposes no such context to extensions).
- Per-group memory figures (`chrome.processes` is not in stable Chrome).
- Touching Chromium's own Memory Saver settings (an extension cannot).
- Chrome Web Store publication, cross-device sync.

## Anti-goals (a failure even if it "works")

- Silently losing the user's work. Pinned tabs and tabs with half-typed forms *do* sleep (by design); the safety net is the
  🔒 on a group. The README says so loudly.
- Putting to sleep something that is playing sound, or the tab the user is on.
- Any code path that can send data out of the machine. Website access is optional and opt-in.

## Decisions

- **Rules are keyed by group title** (by colour when untitled), not by group id: ids do not survive a restart. A rule follows its
  group if it is renamed, but only once the title has been quiet for 5 s (see the editor note below).
- **Idle time is tracked by the extension**, not read from `tab.lastAccessed` (see below). State lives in `chrome.storage.session`
  (one key per tab/group, no read-modify-write), so a service-worker restart does not change behaviour.
- **The automatic sweep runs every minute** from a `chrome.alarms` alarm, because an MV3 service worker sleeps.
- **Everything the popup does is executed by the service worker** through messages: the popup dies as soon as the active tab
  changes, which would cut an action in half.
- **`default` rules are never stored** (they equal "no rule"), and removing a 🔒 deletes the rule.
- **Waking a group is staggered** (300 ms between tabs) so memory does not spike at once.
- **A discard that Chromium refuses is reported**, not swallowed (the popup shows a notice; the sweep keeps a failure counter).

## Chromium behaviours worth knowing

These were all verified in Chromium 154 with the end-to-end suites.

1. **`chrome.tabs.discard` changes the tab id.** The old id stops existing; the new tab comes back in the returned value. The
   group, the position and the group's title are preserved, and activating a discarded tab keeps its id. Never cache tab ids across
   a discard; re-query.
2. **`tab.lastAccessed` is "when the tab became active", not "when it was left".** A tab you worked on for 20 minutes and then
   switched away from looks idle for 20 minutes. Zzz keeps its own "last used" marks (`lib/activity.js`).
3. **`tab.audible` only lasts about 2 s.** A call that goes quiet for 3 s looks silent. Zzz remembers when a tab last made sound.
4. **`chrome.tabs.onUpdated` does not support event filters in Chrome** (Firefox does). Passing one throws at load time and the
   whole service worker fails to start.
5. **The `"tab"` context-menu context exists since Chrome 150**, but there is no context for the tab-group chip.
6. **The tab-group name editor writes the title on every keystroke** and overwrites what is being typed if the title is changed
   from outside. Anything that touches group titles must wait until the user stops typing.
7. **An extension popup closes when the active tab changes**, and its JavaScript dies with it.
8. **`chrome.scripting.executeScript` waits for the page to be idle**, and a hung page never answers: always race it against a
   timeout, or one stuck tab blocks everything queued behind it.
9. **A discarded tab keeps the last `document.title`**, so a prefix set just before discarding survives; reloading restores the
   page's own title. Chromium also records title changes made while a page is loading in the history, so tabs that are still
   loading are not marked.
10. **`chrome.permissions.request` needs a real user gesture.** In tests it is exercised with `Runtime.evaluate({ userGesture: true })`
    or with the Chrome call stubbed.
11. **A manifest CSP does not cover code injected into web pages.** `connect-src 'none'` closes the extension's own pages only; with
    website access granted, that guarantee depends on reading the injected code.
12. **The popup scrolls the document**, not `body`: the `overflow` of `body` is propagated to the viewport. Use
    `document.scrollingElement`, and `focus({ preventScroll: true })` when restoring focus after a repaint.
13. **In headless Chromium, `chrome.runtime.reload()` leaves the extension without a service worker**, so the restart test lets the
    worker idle out and be woken by the alarm instead.

## Architecture

| File | Responsibility |
| --- | --- |
| `lib/rules.js` | Pure logic (keys, limits, `shouldAutoSleep`, title marks). Unit-tested without a browser. |
| `lib/groups.js` | Thin wrapper over `chrome.tabs` / `chrome.tabGroups`: list, sleep, wake, lock. |
| `lib/sweep.js` | The automatic sweep. |
| `lib/activity.js`, `lib/titles.js`, `lib/groupkeys.js` | Per-tab/group marks in session storage: idle tracking, "is someone editing this title", rule follow-on-rename. |
| `lib/chips.js`, `lib/tabmarks.js` | 💤 in group titles and in tab titles. |
| `lib/menus.js`, `lib/settings.js` | Menu definitions; settings persistence. |
| `background.js` | Wires menus, shortcuts, the alarm and the popup's messages. |
| `popup/`, `options/` | The UI. |

## How it is tested

- `tests/*.test.js` — pure logic and the manifest, with `node:test`.
- `tests/e2e/*.mjs` — a **separate headless Chromium with a temporary profile**, driven over CDP with Node's built-in
  `WebSocket`. No mocks of Chrome APIs except where a real prompt would be needed (permissions). Fixture pages allocate memory so
  that "memory really goes down" is measured, and one plays audio so "what is playing is never slept" is real.
- A test is trusted only after being seen to **fail** first, and the important ones were checked by *mutation*: break the code on
  purpose and confirm that exactly the right test goes red.
- The optional website permission cannot be granted in headless mode, so tests that need it run against a temporary copy of the
  extension with `host_permissions` already granted.
