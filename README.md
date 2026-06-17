# Alpha Monitor

TG + X early-project monitoring dashboard.

Public dashboard files are in the repository root:

- `index.html`
- `app.js`
- `styles.css`
- `data.json`

Local data sources and generators:

- `snapshots/`
- `reports/`
- `telegram_project_counts.csv`
- `scripts/build-site.mjs`
- `scripts/serve-site.mjs`

Rebuild dashboard data:

```powershell
node scripts/build-site.mjs
```

Preview locally:

```powershell
node scripts/serve-site.mjs
```
