/**
 * NPC Padel — Cloudflare Worker: live Reclub proxy
 * Endpoint: GET /upcoming  → future NPC meets + registered players (same JSON shape as data/upcoming.json)
 *
 * Deploy: Cloudflare dashboard → Workers → create → paste this file.
 * Secret:  Settings → Variables → add secret RECLUB_TOKEN (same token as GitHub secret).
 * The token never reaches the browser — the Worker calls Reclub server-side.
 */
const GROUP_ID = 20042;
const FUTURE_DAYS = 45;

const CORS = {
  "access-control-allow-origin": "*",
  "content-type": "application/json;charset=utf-8",
  "cache-control": "public, max-age=30" // cache 30s so spam-clicks don't hammer Reclub
};

function guessFormat(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("fixed")) return "fixed";
  if (t.includes("mexicano")) return "mexicano";
  if (t.includes("americano")) return "americano";
  return null;
}

function cleanTitle(name) {
  return (name || "").replace(/[^\w\s()\-&,+.!/]/gu, "").replace(/\s+/g, " ").trim().slice(0, 70) || "NPC Meet";
}

function wib(ts) {
  const d = new Date((ts + 7 * 3600) * 1000);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);

    /* POST /update — host-only trigger for the GitHub Actions data sync.
       Password is verified HERE (server-side), never embedded in the site.
       Needs Worker secrets: HOST_PASSWORD, GITHUB_PAT (fine-grained, Actions read+write
       on the repo only) and var GITHUB_REPO e.g. "aripisan/Padel-game-simulator". */
    if (url.pathname.endsWith("/update") && request.method === "POST") {
      const noCache = { ...CORS, "cache-control": "no-store" };
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!env.HOST_PASSWORD || body.password !== env.HOST_PASSWORD)
        return new Response(JSON.stringify({ error: "wrong password" }), { status: 401, headers: noCache });
      const gh = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/update-data.yml/dispatches`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.GITHUB_PAT}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "user-agent": "npc-padel-worker"
          },
          body: JSON.stringify({ ref: "main" })
        }
      );
      if (gh.status === 204)
        return new Response(JSON.stringify({ ok: true, message: "Update started" }), { headers: noCache });
      return new Response(JSON.stringify({ error: `GitHub said ${gh.status}` }), { status: 502, headers: noCache });
    }

    if (!url.pathname.endsWith("/upcoming"))
      return new Response(JSON.stringify({ error: "use /upcoming or POST /update" }), { status: 404, headers: CORS });

    const H = {
      authorization: `Bearer ${env.RECLUB_TOKEN}`,
      accept: "application/json",
      "x-version": "2.45.4",
      "x-output-casing": "camelCase",
      "user-agent": "okhttp/4.11.0"
    };
    const api = async (path, params) => {
      const u = new URL("https://api.reclub.co" + path);
      for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
      const r = await fetch(u.toString(), { headers: H });
      if (!r.ok) throw new Error(`${path} -> ${r.status}`);
      return r.json();
    };

    try {
      const now = Math.floor(Date.now() / 1000);
      const data = await api(`/groups/${GROUP_ID}/activities`, {
        access_token: "", skip: 0, limit: 50,
        min_start_datetime: now, max_start_datetime: now + FUTURE_DAYS * 86400,
        types: "MEETS,COMPETITIONS"
      });
      const meets = Array.isArray(data) ? data : (data.activities || data.data || []);

      // participants per meet (parallel)
      const details = await Promise.all(meets.map(async m => {
        try {
          const d = await api(`/meets/${m.id}`);
          const joined = (d.participants || []).filter(p => p.status === 1);
          return { m, uids: joined.map(p => p.referenceId).filter(Boolean) };
        } catch (e) { return { m, uids: [] }; }
      }));

      // player names (chunks of 50)
      const allUids = [...new Set(details.flatMap(d => d.uids))];
      const names = {};
      for (let i = 0; i < allUids.length; i += 50) {
        try {
          const d = await api("/players/userIds", {
            scopes: "BASIC_PROFILE",
            user_ids: allUids.slice(i, i + 50).join(",")
          });
          for (const p of (d.players || [])) names[p.userId] = p.name || p.username || `user_${p.userId}`;
        } catch (e) { /* skip */ }
      }

      const out = details.map(({ m, uids }) => {
        const t = wib(m.startDatetime || 0);
        return {
          id: `rm${m.id}`,
          name: cleanTitle(m.name),
          date: t.date,
          time: t.time,
          venue: (m.venue && m.venue.name) || "Nonstop Padel Club",
          format: guessFormat(m.name),
          players: uids.map(u => ({ id: `u${u}`, name: names[u] || `user_${u}` }))
        };
      }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

      return new Response(JSON.stringify(out), { headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: CORS });
    }
  }
};
