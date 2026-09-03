# Silk Road Trade Log

A personal reference tool for the Roblox game *Silk Road* — track which
cities and merchants buy/sell which goods, and find the best (or closest)
place to trade an item.

It's a plain static site (no build step) meant to be served by GitHub
Pages. There's no server and no database service — the data lives as a
single JSON file in this repo (`data/db.json`), edited through the app and
committed straight to GitHub from your browser.

## How it works

- **Reading data** requires nothing — the app fetches `data/db.json`
  straight from the deployed site.
- **Saving changes** requires a GitHub token so the app can commit the
  updated file back to this repo. Click **⚙️ Settings**, paste in a
  fine-grained personal access token scoped to just this repo with
  Contents: Read and write, and save. The token is stored only in your
  browser's `localStorage` — it is never committed to the repo.
- If you make edits before adding a token (or a save fails), changes are
  kept in this browser's IndexedDB cache and a banner reminds you they're
  local-only until you sync.
- The game data is also cached in IndexedDB so the app loads instantly and
  still shows your data if you're offline; it refreshes from GitHub in the
  background on load.

## Losing your token

GitHub only ever shows you a token's value once, at creation. If it gets
wiped from your browser, generate a new one (Settings → Developer settings
→ Fine-grained tokens) and paste it in again — there's no limit on how many
you can create, and the old dead one can simply be revoked.

## Local development

Serve the folder over HTTP (opening `index.html` directly as a `file://`
URL won't work, since the browser blocks the fetch of `data/db.json`):

```
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed URL.

## Third-party code

`js/vendor/fuse.mjs` is [Fuse.js](https://fusejs.io) v7.0.0 (Apache 2.0),
vendored locally rather than pulled from a CDN so search still works
offline and the app has no runtime dependency on an external host.

## Deployment

This repo is designed to be served by GitHub Pages directly from the
`main` branch (root). No workflow/build step is required — just point
Pages at `main` / `/ (root)` in the repo's Settings → Pages.
