# Iolit Client

Turn your AI coding sessions into income. You own your data, you approve what's sold.

## The promise

**Audit the one call.**

This client has exactly **one** way to reach the internet: `src/send.ts`.
A CI check (`npm run check:single-send`) fails the build if a second
network call ever appears. There is nothing else to audit.

## How it works

1. `iolit` reads session metadata from your local Claude/Cursor history
2. It shows you the batch: sessions, models, size, before anything leaves
3. You approve. Only then is it sent to the marketplace
4. You get paid monthly

## What leaves your machine

Metadata only. The full schema is `src/types.ts`:

```
tool, model, startedAt, durationSec, tokensIn, tokensOut,
taskType, success, toolsUsed, hourOfDay
```

No prompts. No code. No file paths. Nothing else exists in the payload, and
the schema test enforces it.

## Build & test

```sh
npm install
npm run build       # tsc, strict
npm test            # payload schema tests
npm run check:single-send  # proves 1 network call
```

## Roadmap

- [ ] Cursor session detection
- [ ] PII/screen for secrets (API keys, tokens)
- [ ] Marketplace API + payout ledger
- [ ] Paid web dashboard

## License

MIT
