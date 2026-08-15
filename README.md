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

1. `iolit` reads session metadata from your local Claude, Cursor, and Codex history
2. It shows you the batch: sessions, models, size, estimate, before anything leaves
3. You approve. Only then is it sent to the marketplace
4. `iolit history` shows every batch you've sent

## What leaves your machine

Metadata only. The full schema is `src/types.ts`:

```
tool, model, modelsUsed, startedAt, endedAt, durationSec, hourOfDay, dayOfWeek,
cliVersion, userTurns, assistantTurns, tokensIn, tokensOut,
cacheCreationTokens, cacheReadTokens, cacheHitRatio,
webSearchRequests, webFetchRequests, serviceTier, speed,
taskType, success, lastStopReason, apiErrorCount,
toolErrorCount, toolCallCount, toolsUsed, toolCalls, toolSequence,
thinkingBlocks, thinkingChars, textCharsOut, userCharsIn,
isSubagent, cwdHash, hasGit, branchClass, langHints,
permissionMode, stopReasons
```

No prompts. No code. No file paths. Paths are hashed. Nothing else exists in the payload, and
the schema test enforces it.

## Build & test

```sh
npm install
npm run build       # tsc, strict
npm test            # payload schema tests
npm run check:single-send  # proves 1 network call
```


MIT
