Open http://localhost:5173. You'll be prompted for a Sia indexer URL (default
`https://sia.storage`), then walked through approval and recovery-phrase setup
before reaching the upload page.

## Project Structure

- `src/lib/constants.ts` — App key, app metadata, erasure coding settings
- `src/stores/auth.ts` — Zustand auth state machine, holds the active `Sdk`
- `src/components/auth/` — Connect, Approve, Recovery flow
- `src/components/upload/UploadZone.tsx` — Real Sia uploads with shard progress
- `src/App.tsx` — Auth-gated app shell

## Built For

The Block Reward — Sia Foundation internal hackathon, April 29 – May 1, 2026.

## Built By

Dani — HR/Operations, vibe-coding her first real app.