# Playoff Tracking — Cito Gaston's spray chart

iPhone web app for charting where each opposing batter hits during a Markham 4-Pitch playoff game.

**Open it:** https://mattarnot-hub.github.io/Playoff-Tracking/ in Safari → Share → **Add to Home Screen**.
Works offline once added. All games are stored on the phone only (use Settings → Export all data to back up).

## Using it
- **Game setup:** pick opponent, date, field → Next.
- **Batting order:** tap names in order (or Start game with no names for a numbered lineup; allocate names later via ⋯).
- **Spray chart:** quick tap = out · hold 1.5 s = hit (circled) · K = strikeout · Undo · End inning.
  Long-press a mark to change, move, reassign or delete it.

## Field map
`public/field.svg` — keep `viewBox="0 0 1000 1000"` and home plate at (500, 950). Marks are stored as 0–1 fractions, so a new drawing keeps them in place.

## Develop
```bash
npm install
npm run dev
```
Pushing to `main` rebuilds and redeploys GitHub Pages automatically.
