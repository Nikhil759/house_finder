# Reddit Housing Finder

Search Reddit for rental listings — flats, PGs, flatmates — filtered by location, type, and budget.
No Reddit API credentials needed.

```
reddit-housing/
├── backend/
│   ├── app.py            Flask API (uses Reddit's public JSON — no auth)
│   ├── requirements.txt
│   └── Procfile          for Railway/Render deploy
└── frontend/
    ├── src/
    │   ├── main.jsx
    │   └── App.jsx
    ├── index.html
    ├── vite.config.js    proxies /api → Flask in dev
    └── package.json
```

---

## Run locally

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
# → http://localhost:5000
```

Test:
```
http://localhost:5000/api/health
http://localhost:5000/api/search?location=Bangalore&bhk=2BHK
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Vite proxies `/api` to Flask on port 5000. No CORS issues.

---

## Deploy

### Backend → Railway
1. Push repo to GitHub
2. railway.app → New Project → Deploy from GitHub → select `backend/` as root
3. No env vars needed — no credentials required
4. Procfile handles gunicorn automatically
5. Copy your deployed URL e.g. `https://your-app.railway.app`

### Frontend → Vercel
1. vercel.com → New Project → import repo
2. Set Root Directory to `frontend`
3. Add env var: `VITE_API_URL=https://your-app.railway.app`
4. Deploy

---

## API

### GET /api/search

| Param      | Required | Example               |
|------------|----------|-----------------------|
| `location` | ✓        | `Bangalore Whitefield`|
| `bhk`      |          | `2BHK`, `PG`          |
| `budget`   |          | `20000`               |
| `keywords` |          | `furnished parking`   |
| `limit`    |          | `30` (max 50)         |

**Response**
```json
{
  "posts": [
    {
      "id": "abc123",
      "title": "2BHK available in Indiranagar",
      "subreddit": "bangalore",
      "author": "username",
      "url": "https://reddit.com/r/bangalore/...",
      "selftext": "Looking for tenants...",
      "score": 12,
      "comments": 4,
      "created": 1735000000,
      "flair": "Housing"
    }
  ],
  "total": 18,
  "query": "Bangalore rent OR rental OR PG 2BHK",
  "subreddits": ["bangalore", "bengaluru", "indianrealestate"]
}
```

---

## Extending

- **More cities** → add to `CITY_SUBREDDITS` in `app.py`
- **Saved searches** → store in localStorage, re-run on load
- **Email alerts** → cron job that diffs new vs seen post IDs
- **Client-side filters** → filter by score, keyword in title, recency
