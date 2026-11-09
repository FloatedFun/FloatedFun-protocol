# FLOATED

Sinking is optional. A calmer path for faded charts, with every holder brought along.

[![Live site](https://img.shields.io/badge/live-floated.fun-5095fc?style=flat-square)](https://floated.fun)

**Chain:** Solana  
**Contract address:** `pending` (shown on the site the moment it is stated)

## Overview

FLOATED is a static site with a live Solana market board. It tracks the busiest tokens on the chain, pins the project's own token as row one once its contract is known, and keeps every outside fact in a single register so nothing unproven is ever shown as true.

## Features

- Live market board: top Solana tokens by 24 hour turnover, refreshed every minute, paused while the tab is hidden
- Price ticker built from the same feed, with skeleton loading and graceful failure handling
- Own-token row that switches on when the contract address is stated
- Click-to-copy contract slot, always visible at the top of the page
- Register-driven links: unstated records render inert, with no link and no value
- Reduced-motion support across every animation

## Links

- Site: https://floated.fun
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Develop

```bash
npm install
npm run build      # writes dist/
npm run gates      # runs every gate, exit 0 on pass
npm run measure    # five-breakpoint measurement
```

Edit `register.json` to state a contract address or a social link, then rebuild. Deploy the contents of `dist/`.

## License

MIT, see [LICENSE](LICENSE).
