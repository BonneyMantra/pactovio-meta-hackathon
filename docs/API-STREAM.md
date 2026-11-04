# Proposal run stream

`GET /api/proposals/:id/events` streams step telemetry for one proposal run as server-sent events. It is additive: `GET /api/proposals/:id` and its polling are unchanged.

- Auth: the customer session cookie (`EventSource` sends it same-origin). No session is a JSON 401.
- A malformed id is a JSON 400 `{ error, code: "validation" }`. An unknown id or another workspace's id is a JSON 404 `{ error, code: "not_found" }`. Both are returned before any stream opens.
- Response headers: `content-type: text/event-stream; charset=utf-8`, `cache-control: no-store`, `x-accel-buffering: no`.

| Frame | Data | When |
|---|---|---|
| `retry: 3000` | | first line |
| `event: snapshot` | `{ status, steps[] }` | once, immediately; steps have the `GET /:id` shape |
| `event: step` | `{ step }` | a new step, or one whose status, `finished_at` or `cost_usd` changed |
| `event: status` | `{ status }` | the proposal status changed |
| `event: done` | `{ status }` | status is `completed` or `failed`; the stream closes |
| `event: timeout` | `{ afterMs }` | 5 minutes elapsed; reconnect (a fresh `snapshot` follows) or fall back to polling |
| `event: fault` | `{ error, code }` | three consecutive poll failures, or the proposal vanished (`not_found`); the stream closes. Named `fault` so it never collides with `EventSource`'s own `error` event |
| `: ping` | | comment every 15 s |

Every `event:` frame carries an `id:` (a per-connection counter starting at 1). The server does not replay on reconnect: a new connection starts with a fresh `snapshot`, so clients should replace local state with it. Within one poll tick, `step` events come before `status`. The server polls D1 once per second (one status SELECT and one step listing) and stops when the client disconnects.

## Limits and client contract

- The server polls D1 every 1 s for the first minute, then every 2 s, and closes after 5 minutes. That is at most about 360 D1 queries per stream, well inside a Worker invocation's subrequest budget.
- Opening a stream is limited to 240 opens per workspace per hour (`takeLimit`). Past that limit the route returns `429`.
- On `done`, call `close()`. `EventSource` reconnects on its own after any close, and a reconnect to a finished run returns a snapshot and `done` again.
- On `timeout`, either reconnect or fall back to `GET /api/proposals/:id` polling. The Pactovio front end falls back to polling on any stream error.
