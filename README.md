# BehaviorDiff

BehaviorDiff compares two **real local HTTP/JSON processes**. It replays the same
stateful scenario against an old cart fixture and a candidate cart fixture,
compares response status and JSON semantics, and can shrink a noisy failing
scenario through verified actual replays.

The checked-in candidate intentionally contains a business regression: it ignores
`quantity` when calculating `lineTotal`, `subtotal`, and `total`.

## Requirements

- Node.js `22.23.3` (pinned in `.nvmrc`)
- npm 10 or newer
- No external network, database, or service
