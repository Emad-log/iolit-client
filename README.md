# Iolit Client

[![CI](https://github.com/Emad-log/iolit-client/actions/workflows/ci.yml/badge.svg)](https://github.com/Emad-log/iolit-client/actions/workflows/ci.yml)

Turn your AI coding sessions into income. You own your data, you approve what's sold.

## The promise

**Audit the one call.**

This client has exactly **one** way to reach the internet: `src/send.ts`.
A CI check (`npm run check:single-send`, run on every push and pull
request) fails the build if a second network call ever appears. There is nothing else to audit.

## Install

```sh
curl -fsSL iolit.dev/install.sh | sh
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

## Provenance

Every session with git activity is bound to the commits made during its
window. The client runs `git log` locally and attaches up to 20 commit
SHAs to the batch. Only SHAs leave the machine: no paths, remotes,
branch names, or messages. The API rejects malformed SHAs and flags
SHAs that appear in other sellers' batches, so buyers can tell real
work from farmed sessions. Included at all tiers; it is verification
metadata, not session content.

## Build & test

Node 22.13 or newer (the client uses `node:sqlite`). No runtime dependencies.

```sh
npm install
npm run build              # tsc, strict
npm test                   # unit tests, run against dist/
npm run check:single-send  # proves 1 network call
npm run check              # all three, as CI runs them
```

## Layout

```
src/
  cli.ts             entry point: detect, estimate, ask, send
  detect*.ts         read local Claude, Cursor, Codex and Hermes history
  meta.ts, tiers.ts  build session metadata for each share tier
  redact.ts          strip secrets and paths before anything is shown or sent
  provenance.ts      bind a session to local commit SHAs
  payload.ts         assemble the batch; types.ts is the wire schema
  send.ts            the only network call
  history.ts         local log of every batch sent
  prompt.ts          terminal prompts
  test/              unit tests
scripts/check-network.js   fails if a second network call site appears
install.sh                 the installer served at iolit.dev/install.sh
```

## Status

Shelved. Iolit was a waitlist for an idea that did not take off. The code
stays here, building and tested, for anyone who wants to read it.

## License

[MIT](LICENSE)
