# Edge Certification Notes (English)

1. Install in Edge 116+ and open an ordinary HTTPS page. Edge internal pages cannot be injected.
2. Use Read Current Page from the toolbar to check the floating reader and extracted page content.
3. Switch to the edge panel and verify automatic hiding and edge re-entry.
4. Open three ordinary pages A, B, and C. Open and minimize the floating reader only on A, then verify that the recovery bead appears on A, B, and C. Restore it on one page, then switch tabs: only the chosen tab may show a full reader, and the previous full reader must hide. Edge mode must never turn into the floating bead. Then navigate the owner tab, restart the service worker, and close one registered tab; the new document must stay hidden while healthy pages continue to synchronize.
5. Open the browser-native side panel and verify long-text scrolling.
6. In Settings, verify the cool-gray theme, typography, opacity, and display modes.
7. Test TXT and online reading in the library; online chapters permit same-site requests only.
8. Use Alt+X for emergency hide and Alt+V to restore.

No test account is required. Privacy: https://935039168.github.io/VeilRead/privacy/en/ . Support: https://935039168.github.io/VeilRead/support/en/ .
