---
name: move-mouse
description: >-
  OS-level human-like mouse via mousecrack move()/CLI (robotjs). Prefer
  browser-ops + steps()→Playwright for web forms. Use only for desktop/OS
  pointer experiments outside the browser.
---

# move-mouse (mousecrack OS)

Upstream: [puffinsoft/mousecrack](https://github.com/puffinsoft/mousecrack).

## Prefer browser-ops for web

For **job-board signup / reverse links / Playwright**:

- Use skill **`browser-ops`**
- Use `import { steps } from 'mousecrack'` and replay via `page.mouse`
- See `tools/browser-ops/src/human-mouse.ts`

**Do not** call `move(x, y)` to drive Cursor IDE browser tabs — that moves the macOS system cursor (needs Accessibility) and is the wrong layer.

## OS move (when explicitly needed)

```bash
npm i -g mousecrack
mousecrack move 200 400
mousecrack steps 100 200 200 400
```

```js
import { move, steps } from 'mousecrack';
await move(200, 400); // robotjs — OS pointer
const traj = await steps({ x: 100, y: 200 }, { x: 200, y: 400 });
```

macOS: grant **Accessibility** to the terminal / Node only if using `move()`.
