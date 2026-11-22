# Curio

Upload a research paper. Curio finds the questions worth asking and answers each one as an animated, clickable diagram. Click any part of a diagram to go deeper. The paper slides open beside it at the exact passage.

Built at Claude Opus Build Day, Bangalore, with Claude Opus 5.5.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `ACCESS_CODE` | Required to run live generation on your own paper |
