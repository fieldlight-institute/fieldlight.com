# Fieldlight Institute / fieldlight.com

Source for [fieldlight.com](https://fieldlight.com), the public website and publication surface of Fieldlight Institute.

Fieldlight Institute develops public research, working systems, and institutional methods for human-owned AI infrastructure. The Institute is founded and led by writer and systems builder Anni McHenry.

## Public architecture

- `index.html` is the institutional front door.
- `writing/index.html` is the complete catalog of 50 public writing entries by Anni McHenry.
- `writing/*/index.html` contains the individual Fieldlight reading surfaces.
- `continuity/` maps evidence-backed connections across 54 registered reading surfaces, records an explicit public baseline, and provides device-local reader state.
- `writing/on/` publishes the five-part literary collage *On…*, preserving its source order, migrating refrain, and marginal rabbit motion.
- `institute/index.html` is the full six-part Fieldlight Institute surface.
- `institute/participant-charter/` publishes the Participant Charter.
- `institute/the-right-not-to-be-processed/` publishes the companion constitutional note for Charter 0.4, Right 20.
- `institute/governed-archive-acquisition/` publishes the working method for compensated, identity-blind, no-human-read archive research.
- `systems/index.html` is the public register of working Fieldlight systems.
- `story-worlds/` contains explicitly authored creative work and story-worlds.
- `engage/` gives institutions, teams, funders, and collaborators four concrete routes from public work to consequence.
- `feed.xml` and `feed.json` expose current publications.
- `llms.txt` provides a machine-readable institutional and publication index.
- `sitemap.xml` lists indexable HTML pages.

Reader Continuity distinguishes publications from public source context. Private notebook material is never exposed by the continuity layer; only creator-authorized public source records may appear there.

Canonical Markdown for Anni McHenry's public writing remains in [`annimch04/public-writing`](https://github.com/annimch04/public-writing). Fieldlight Institute is the publisher of selected reading surfaces; it does not replace the author-owned source record.

## Measurement

Fieldlight uses Cloudflare Web Analytics for privacy-preserving aggregate site traffic and Google Search Console for Google Search visibility. Google Analytics is not installed.

See [`docs/measurement.md`](docs/measurement.md) for configuration and maintenance details.
