# AI Study Planner

A small full-stack app: add tasks with deadlines, generate an AI day-by-day
study schedule, and chat with a study assistant that has context on your
tasks and plan.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and paste in your own Gemini API key
npm start
```

Then open http://localhost:4000

## Notes

- Your API key lives only in `.env` (git-ignored) — it is never hardcoded
  in source. Get a key at https://aistudio.google.com/app/apikey
- Task, plan, and chat data are stored locally as JSON files under `data/`
  (also git-ignored) — swap in a real database for production use.
- If you previously shared a Gemini API key in a public repo or chat,
  revoke it in AI Studio and generate a new one before deploying this.
