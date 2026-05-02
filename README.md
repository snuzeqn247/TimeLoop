# TimeLoop

> Personal moments sealed, encrypted, and looped back to you on the anniversaries that matter — and the future dates you choose.

TimeLoop is a private memory vault built on the [Sia](https://sia.tech) decentralized storage network. It's an answer to a frustration: most of the apps that "remember things for us" — Facebook, Instagram, Timehop, Apple Photos — don't really remember on our behalf. They remember on theirs. They show you a memory when *they* decide to. They lose your data when *they* shut down.

TimeLoop tries something different. It lets you build your own memory timeline — backwards (anniversaries that resurface naturally) and forwards (time capsules you seal for a future date) — stored on Sia, encrypted client-side, and fully owned by you. Even if TimeLoop disappeared tomorrow, the memories would still be there.

Built for **The Block Reward**, the Sia Foundation's internal hackathon, April 29 – May 1, 2026.

**Demo video:**
https://www.loom.com/share/9127fe8868a947eb9510141520e1ec85

## What it does

TimeLoop runs as a single-page browser app. Drop in a photo, video, document, audio file, or note. Pick which direction in time it lives in:

**🟡 From the past** — Pick the date the moment actually happened. The file is encrypted and stored on Sia. On future anniversaries of that date, it resurfaces in an "On this day · From years past" section, telling you "3 years ago" and showing you the memory.

**🟣 Time capsule** — Pick a future date. The file is encrypted and stored on Sia, but its contents — title, filename, thumbnail, everything identifying — are hidden from view in your own vault until the unlock date arrives. Until then, all you see is a sealed envelope counting down. Once you're inside the final 24 hours, the countdown becomes a live `HH:MM:SS` timer that ticks every second.

When a capsule unlocks, a notification toast slides in: "🔓 A capsule just opened."

Everything else flows from those two ideas.

## Features

- **Real Sia uploads** via [`@siafoundation/sia-storage`](https://www.npmjs.com/package/@siafoundation/sia-storage) — files are erasure-coded, encrypted in the browser, and pinned across the Sia host network. Live shard-by-shard progress as you upload.
- **Anniversaries that surface themselves** — past memories whose anchor date matches today (in any prior year, with a 3-day fuzzy window) appear at the top of the page automatically.
- **Time capsules with adaptive countdowns** — long-form ("Opens in 1 year, 2 months, 14 days") for distant capsules, switching to a live monospace `01:23:45` timer in the final 24 hours.
- **Image previews via on-demand decryption** — image memories under 5 MB show a thumbnail by streaming the encrypted file from Sia, decrypting in the browser, and rendering as a blob URL. A green "Decrypting from Sia..." pulse appears while the bytes come down.
- **Native share sheet** — tap Share on a memory and TimeLoop tries the device's `navigator.share` API first (so you get the iOS / Android / Chrome share sheet with the actual file ready to send), falling back to a clean download if the browser doesn't support it.
- **Download** — pull any memory back as the original file with its original filename.
- **In-place editable titles** — click any memory's title to rename it; the change persists to Sia via metadata update.
- **Cancel capsule** — change your mind about a sealed capsule? Cancel it before it unlocks, with a confirmation dialog that's honest about what happens (the contents are deleted from Sia, permanently, before they ever open).
- **Delete** — same for normal memories, with the same honest dialog.
- **Persistence across sessions** — refresh the page, close the tab, come back tomorrow. Your memories load straight from Sia using `sdk.objectEvents`, no server backend in between.

## How the Sia integration works

TimeLoop is not "a Sia front-end with extra steps" — Sia is the load-bearing layer. There is no other database. There is no other server. The browser does all the encryption, talks directly to Sia, and reads memories back out the same way.

Concretely, in `src/components/upload/UploadZone.tsx`:

- **Upload:** `sdk.upload(new PinnedObject(), file.stream(), { maxInflight: 10, onShardUploaded })` streams the file through erasure coding and uploads its shards across the host network.
- **Pin & metadata:** `pinnedObject.updateMetadata(...)` tags each upload with a JSON blob (`{ name, type, size, title, mode, anchorDate, uploadedAt }`), then `sdk.pinObject` and `sdk.updateObjectMetadata` persist the metadata on Sia. That metadata is what makes anniversaries and capsules possible — there is no other store.
- **Load on mount:** `sdk.objectEvents(undefined, 100)` lists every existing object for the user; TimeLoop reads each one's metadata, parses the JSON, and rebuilds the timeline.
- **Decrypt on demand:** `sdk.download(pinnedObject, { maxInflight: 10 })` returns a stream that's read into a `Blob`, then handed to either an `<img>` for preview, a download `<a>` for save-to-disk, or `navigator.share` for native sharing.
- **Update title:** changing a memory's title rewrites its metadata via the same `updateMetadata` + `updateObjectMetadata` pair — round-trips persist on Sia.
- **Delete / cancel capsule:** `sdk.deleteObject(pinnedObject.id())` removes the encrypted shards from the network.

## A note on the soft-lock

TimeLoop's time capsules are honest about what they are: they're a UI lock, not a cryptographic time-lock. The encrypted bytes exist on Sia from the moment you upload. The capsule's "sealed" state is enforced by the app itself, which hides the contents in its own UI until the unlock date passes.

A determined developer with this repo could read a sealed capsule's contents before its unlock date — the goal here was to build a personal memory tool, not a vault for secrets. If a future version of TimeLoop wanted true cryptographic time-locking, it could derive the encryption key from a verifiable delay function or external time-oracle. That's a worthy follow-up. For this hackathon: the soft-lock is the lock. (And it works on the only person it needs to: future-you.)

## Tech

- **React 19** + **TypeScript** + **Vite**
- **Tailwind CSS 4** for styling
- **Zustand** for auth state
- **`@siafoundation/sia-storage`** — the official browser-native Sia SDK, announced May 1, 2026

The whole app is one auth flow plus one main component. There is no backend.

## Running it locally

You'll need [Bun](https://bun.sh) (or Node + npm — adapt accordingly).

```bash
bun install
bun dev
```

Then open `http://localhost:5173`. On first run you'll be walked through:

1. **Connect** — confirm the indexer URL (default `https://sia.storage`)
2. **Approve** — register this app with the indexer using the app key in `src/lib/constants.ts`
3. **Recovery** — generate or restore a recovery phrase
4. **Vault** — start dropping memories

## Project structure

```
src/
├── App.tsx                          Auth-gated shell
├── lib/constants.ts                 App key, app metadata, erasure coding settings
├── stores/auth.ts                   Zustand auth state machine; holds the active SDK
├── components/auth/                 Connect → Approve → Recovery → Connected
└── components/upload/UploadZone.tsx Everything TimeLoop-specific (upload, anniversaries, capsules, countdowns, share, etc.)
```

## Built by

Dani — Head of Organizational Development at The Sia Foundation, building her first real app.

This started as a brainstorm in a Slack DM and ended as a working memory vault built on a SDK. Vibe coded, shipped on time(ish).

## Built for

**The Block Reward** — Sia Foundation internal hackathon, April 29 – May 1, 2026.
