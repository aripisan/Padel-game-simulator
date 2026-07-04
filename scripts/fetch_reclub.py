"""
Auto-sync Reclub -> data/*.json  (runs in GitHub Actions, no manual steps)

- data/players.json  : everyone seen in NPC meets (merged, ids stable)
- data/upcoming.json : future meets incl. registered players (site: "Host a Meet" dropdown)
- data/meets.json    : NEVER touched here — match results are recorded by the website itself

Token comes from env RECLUB_TOKEN (GitHub secret). Never hardcode it: this repo is public.
"""
import json, os, re, sys, time
from datetime import datetime, timezone, timedelta
import requests

TOKEN = os.environ.get("RECLUB_TOKEN", "").strip()
if not TOKEN:
    sys.exit("RECLUB_TOKEN env var missing")

BASE_URL = "https://api.reclub.co"
GROUP_ID = 20042            # NPC (Nonstop Padel Club)
JOINED_STATUS = 1
PAST_DAYS, FUTURE_DAYS = 45, 45
WIB = timezone(timedelta(hours=7))
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

HEADERS = {
    "authorization": f"Bearer {TOKEN}",
    "accept": "application/json",
    "x-version": "2.45.4",
    "x-output-casing": "camelCase",
    "user-agent": "okhttp/4.11.0",
}

def api(path, params=None):
    r = requests.get(f"{BASE_URL}{path}", headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()

def fetch_meets(start_ts, end_ts):
    all_meets, skip, limit = [], 0, 50
    while True:
        data = api(f"/groups/{GROUP_ID}/activities", {
            "access_token": "", "skip": skip, "limit": limit,
            "min_start_datetime": start_ts, "max_start_datetime": end_ts,
            "types": "MEETS,COMPETITIONS",
        })
        batch = data if isinstance(data, list) else (data.get("activities") or data.get("data") or [])
        if not batch:
            break
        all_meets.extend(batch)
        if len(batch) < limit:
            break
        skip += limit
        time.sleep(0.2)
    return all_meets

def fetch_participants(meet_id):
    data = api(f"/meets/{meet_id}")
    return [p for p in (data.get("participants") or []) if p.get("status") == JOINED_STATUS]

def fetch_player_names(user_ids):
    names = {}
    ids = list(user_ids)
    for i in range(0, len(ids), 50):
        batch = ids[i:i+50]
        try:
            data = api("/players/userIds", {
                "scopes": "BASIC_PROFILE",
                "user_ids": ",".join(str(u) for u in batch),
            })
            for p in (data.get("players") or []):
                uid = p.get("userId")
                names[uid] = p.get("name") or p.get("username") or f"user_{uid}"
        except Exception as e:
            print(f"WARN player fetch: {e}")
        time.sleep(0.2)
    return names

def guess_format(title):
    t = (title or "").lower()
    if "fixed" in t: return "fixed"
    if "mexicano" in t: return "mexicano"
    if "americano" in t: return "americano"
    return None

def clean_title(name):
    name = re.sub(r"[^\w\s\(\)\-&,+.!/]", "", name or "", flags=re.UNICODE)
    return re.sub(r"\s+", " ", name).strip()[:70] or "NPC Meet"

def main():
    now = int(datetime.now(tz=timezone.utc).timestamp())
    start_ts = now - PAST_DAYS * 86400
    end_ts = now + FUTURE_DAYS * 86400

    meets = fetch_meets(start_ts, end_ts)
    print(f"{len(meets)} meets fetched")

    details, all_uids = [], set()
    for m in meets:
        try:
            joined = fetch_participants(m["id"])
        except Exception as e:
            print(f"WARN meet {m.get('id')}: {e}")
            joined = []
        uids = [p["referenceId"] for p in joined if p.get("referenceId")]
        all_uids.update(uids)
        details.append((m, uids))
        time.sleep(0.2)

    names = fetch_player_names(all_uids)

    os.makedirs(DATA_DIR, exist_ok=True)

    # --- players.json: merge with existing so ids/names stay stable ---
    players_path = os.path.join(DATA_DIR, "players.json")
    existing = {}
    if os.path.exists(players_path):
        for p in json.load(open(players_path, encoding="utf-8")):
            existing[p["id"]] = p["name"]
    for uid in all_uids:
        pid = f"u{uid}"
        existing[pid] = names.get(uid, existing.get(pid, f"user_{uid}"))
    players = [{"id": pid, "name": nm} for pid, nm in sorted(existing.items(), key=lambda x: x[1].lower())]
    json.dump(players, open(players_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"players.json: {len(players)} players")

    # --- upcoming.json: future meets with registered players ---
    upcoming = []
    for m, uids in details:
        ts = m.get("startDatetime", 0)
        if ts < now:
            continue
        dt = datetime.fromtimestamp(ts, tz=WIB)
        upcoming.append({
            "id": f"rm{m['id']}",
            "name": clean_title(m.get("name")),
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M"),
            "venue": (m.get("venue") or {}).get("name") or "Nonstop Padel Club",
            "format": guess_format(m.get("name")),
            "players": [{"id": f"u{u}", "name": names.get(u, f"user_{u}")} for u in uids],
        })
    upcoming.sort(key=lambda x: (x["date"], x["time"]))
    json.dump(upcoming, open(os.path.join(DATA_DIR, "upcoming.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"upcoming.json: {len(upcoming)} future meets")

    # --- meets.json: create empty if missing, never overwrite ---
    meets_path = os.path.join(DATA_DIR, "meets.json")
    if not os.path.exists(meets_path):
        json.dump([], open(meets_path, "w"))
        print("meets.json: created empty")

if __name__ == "__main__":
    main()
