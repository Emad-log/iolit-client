# Iolit Client

Turn your AI coding sessions into income. You own your data, you approve what's sold.

## The promise

**Audit the one call.**

This client has exactly **one** way to reach the internet: `src/send.ts`.
A CI check (`npm run check:single-send`) fails the build if a second
network call ever appears. There is nothing else to audit.

## Install

```sh
curl -fsSL iolit.dev/install | sh
iolit
```

Or from source:

```sh
git clone https://github.com/Emad-log/iolit-client
cd iolit-client
npm install
npm run build
node dist/cli.js
```

## How it works

1. `iolit` reads local Claude, Cursor, and Codex history
2. It shows three share tiers and an estimate for each
3. You pick pulse, trace, or raw, then approve. Only then is it sent
4. `iolit history` shows every batch you've sent

## Share tiers

- **pulse**: loop stats only. No prompts, no tool args, no paths.
- **trace**: pulse plus redacted tool args/results. Paths scrubbed, secrets stripped.
- **raw**: also includes prompt, reply, and thinking previews. Type `YES` to confirm.

The schema is `src/types.ts`. Higher tiers pay more (4x / 12x the pulse estimate). Estimates are unverified.

## Build & test

```sh
npm install
npm run build       # tsc, strict
npm test            # payload schema tests
npm run check:single-send  # proves 1 network call
```


MIT
