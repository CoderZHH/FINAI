Alpha Arena (mock)

Quick start

- Install deps: `npm install`
- Dev server: `npm run dev` then open http://localhost:3000
- Production build: `npm run build && npm start`

Structure

- `app/page.js` main layout with Header, Ticker, Chart, and Feed
- `components/*` UI blocks (chart via Recharts)
- `app/api/*` static JSON endpoints (replace with real backend later)
- `lib/mockData.js` single source of mock data

Notes

- Tailwind v4 via `@import "tailwindcss"` in `app/globals.css`, no config required.
- Data flows through small SWR fetchers so swapping to real APIs is trivial.

