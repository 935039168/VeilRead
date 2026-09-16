# Permission Uses (English)

- `storage`: saves settings, reading progress, and online-book configuration; without it these values cannot be restored across pages.
- `unlimitedStorage`: stores larger TXT files and chapter indexes explicitly imported by the user; without it large books may exceed the default quota.
- `sidePanel`: provides the browser-native side panel reading mode; without it that mode is unavailable.
- `contextMenus`: provides the existing page context-menu entry; without it reading cannot be started from that menu.
- `scripting`: performs fallback injection after a user action when the content script is not yet present; without it some newly loaded pages cannot respond to an entry point.
- `http://*/*`: provides edge activation, page extraction, and user-triggered same-site chapter and catalog requests on ordinary HTTP pages.
- `https://*/*`: provides edge activation, page extraction, and user-triggered same-site chapter and catalog requests on ordinary HTTPS pages.

Page content is processed on-device only for the visible reading feature. See https://935039168.github.io/VeilRead/privacy/en/ and https://935039168.github.io/VeilRead/support/en/ .
