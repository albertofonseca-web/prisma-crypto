# Architecture Notes

## Principle

The web UI is a presentation surface, not a second trading engine.

- PRISMA Swing is a deliberate port of the existing browser-side swing logic.
- TAC/HTF/options decisions originate in the Independent Source Fork and are only transported by the publisher.
- Market ticks go exchange → browser and are not persisted by Cloudflare.

## Free-tier boundaries

Dynamic Worker traffic is limited to API calls. Static files are served as Workers Static Assets without invoking the Worker script. The Durable Object uses SQLite storage and Hibernatable WebSockets.

## Fail closed

If tactical state is absent/stale, the UI defaults to `WAIT` and displays missing/stale health. A missing options/funding/liquidation source is rendered as `NO_DATA`, never inferred.

## No execution

No private exchange endpoints, API keys, order routes, or broker adapters are present in this package.
