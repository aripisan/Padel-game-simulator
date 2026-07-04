# NPC Padel — Nonstop Padel Club site

A prototype website like Alfred for Padel, but for regular meets (not tournaments) at Nonstop Padel Club on Reclub.

## Run it

Just open `index.html` in a browser. No install, no server needed. It ships with sample data so every screen works immediately.

## What it does

- **Players** — card per player with rating (Elo, computed from all match history), matches, win rate, point diff, and last-5 form. Click a player for partner stats and full match history.
- **Leaderboard** — club-wide ranking by rating.
- **Meets** — every past meet with per-meet standings and point-by-point match results.
- **Host a Meet** — the host picks players (plus guests), a format, courts, and rounds; the site generates the game sequence:
  - **Americano** — rotating partners, minimizes repeated partners/opponents, handles sit-outs fairly when players > 4 × courts.
  - **Mexicano** — round 1 seeded by rating; each next round is generated from the live standings (winners meet winners), one round at a time like Alfred.
  - **Fixed pairs** — round robin between set teams (circle method).
  - **Balanced shuffle** — pairs strongest with weakest by rating, then round robin.

  Scores are entered live; standings update instantly. "Finish & save" stores the meet (browser localStorage) and it immediately counts toward everyone's overall stats and rating.

## Connecting your Reclub extractor agent

The site reads live data when `CONFIG.apiBaseUrl` is set (top of the `core` script in `index.html`):

```js
const CONFIG = {
  apiBaseUrl: "http://localhost:8000/api",  // your agent's base URL
  ...
};
```

Your agent must serve two JSON endpoints (CORS enabled if on a different origin):

### `GET {apiBaseUrl}/players`

```json
[
  { "id": "reclub-user-123", "name": "Ary" }
]
```

### `GET {apiBaseUrl}/meets`

```json
[
  {
    "id": "reclub-meet-456",
    "name": "Saturday Social",
    "date": "2026-06-20",
    "venue": "Nonstop Padel Club",
    "format": "americano",
    "matches": [
      {
        "round": 1,
        "court": 1,
        "teamA": ["reclub-user-123", "reclub-user-124"],
        "teamB": ["reclub-user-125", "reclub-user-126"],
        "scoreA": 14,
        "scoreB": 10
      }
    ]
  }
]
```

### `GET {apiBaseUrl}/upcoming`

Future meets at the club on Reclub, with the players who joined. The host picks one of these (day & time) in "Host a Meet" and the registered players are auto-selected.

```json
[
  {
    "id": "reclub-meet-789",
    "name": "Mabar Jumat Malam",
    "date": "2026-07-10",
    "time": "20:00",
    "venue": "Nonstop Padel Club",
    "format": "fixed",
    "players": [
      { "id": "reclub-user-123", "name": "Ary" },
      { "id": "reclub-user-124", "name": "Kevin" }
    ],
    "teams": [["reclub-user-123", "reclub-user-124"]]
  }
]
```

`format` (`americano` | `mexicano` | `fixed`) locks the format dropdown — the game follows what was set on Reclub; the host only picks the point rules. `teams` (optional, for `fixed`) carries the partner pairs as registered on Reclub.

Players in `/upcoming` that aren't in `/players` yet (new club members) are added to the roster automatically with a starting rating.

Notes:
- `teamA`/`teamB` are arrays of two player ids matching `/players`.
- Unplayed matches: `scoreA`/`scoreB` = `null` (they're ignored in stats).
- Ratings, win rates, partner stats, and forms are all **derived** on the client from meets — the agent only needs raw results.
- If the API is unreachable the site falls back to sample data (badge in the header shows which source is active).

## Next steps (when prototype is validated)

1. Deploy as a static site (Vercel/Netlify — it's one HTML file).
2. Move meets storage from localStorage to a shared database (e.g. Supabase) so saved meets are visible to everyone, not just the host's browser.
3. Have the Reclub agent push extracted meets into that same database on a schedule.
