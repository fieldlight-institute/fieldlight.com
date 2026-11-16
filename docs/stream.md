# Fieldlight stream

`/stream/` is Anni McHenry's chronological public stream. **Everything** includes short posts and photographs alongside existing essays, research, and fiction. **Publications** excludes short posts. The separate static `/stream/publications/` page makes both views usable without JavaScript; the small enhancement script switches between them in place.

Existing reading surfaces and canonical author-owned source records retain their URLs. The stream uses their existing public titles and descriptions. Private notebooks and Reader Continuity's source-context records are not publication inputs.

## Publishing desk

`/post/` is Fieldlight's own text-and-photo composer, served by the existing GitHub Pages site. Drafts and original photo selections are saved only in this browser's IndexedDB until Publish is selected. They do not sync between devices; clearing browser data removes them. The desk can be added to a phone's Home Screen.

Connect once with an **annimch04** fine-grained GitHub key restricted to **public-writing**, with **Contents: read and write**. The key is held in memory. Choosing **Remember this device** stores only an encrypted copy in IndexedDB, protected by a separate unlock password of at least 12 characters. Sign out locks a remembered connection; **Forget this device** removes it. The unlock password is not stored.

Publish writes the canonical post and cleaned photographs to `public-writing` through GitHub's API. It uses the existing website Actions schedule, normally about ten minutes plus build/deployment time. **Saved. Publishing…** confirms the source write; **Published** appears only when the public feed contains that exact content hash. Pending checks and drafts recover after a reload. No separate publishing server is required.

**Your posts** edits records created by this composer and checks their original content hash before saving changes. Earlier issue-created posts are read-only in the desk: edit their original GitHub issue. The [GitHub issue form](https://github.com/annimch04/public-writing/issues/new?template=stream-post.yml) remains a fallback; submitted issues and their original attachments are public.

## Build

The generator requires Python 3.9 or later and the Python standard library. Run from this website checkout:

```sh
python3 scripts/build-stream.py --source /path/to/public-writing
python3 scripts/build-stream.py --source /path/to/public-writing --check
python3 -m unittest discover -s tests -p 'test_stream.py'
```

`--check` compares every generated file and reports stale files without modifying the website. An empty `stream/posts/` directory in the canonical checkout is valid. A missing directory is an error, so an incorrect checkout cannot silently remove existing posts.

For publication automation, `--manifest /outside/website/generated.json` writes:

```json
{"version":1,"generated_paths":["feed.json","feed.xml","stream/index.html"],"removed_paths":[]}
```

The full manifest lists every generated file, including post permalinks and copied photographs. It contains repository-relative paths only. The manifest itself must be outside the website checkout. Stage the listed generated and removed paths rather than unrelated working-tree changes.

## Canonical post record

The only short-post inputs are explicitly published records in `annimch04/public-writing`, under `stream/posts/*.json`:

```json
{
  "id": "post-123",
  "published_at": "2026-11-16T15:30:00Z",
  "updated_at": "2026-11-16T15:30:00Z",
  "title": "Optional title",
  "body": "The author's text.",
  "images": [{"path":"stream/media/post-123/photo.jpg","alt":"Description of the photograph"}],
  "source_url": "https://github.com/annimch04/public-writing/blob/main/stream/posts/post-123.json",
  "issue_url": "https://github.com/annimch04/public-writing/issues/123"
}
```

This is a schema example, not a published post. No sample posts are included in generated public output.

The source processor removes inline Markdown image syntax and supplies image records in order. The site renders escaped plain-text paragraphs and line breaks, safe HTTP(S) links, and the supplied photographs. Raw HTML is displayed as text. Formatting beyond paragraphs and links is intentionally minimal. Photos require descriptive alternative text and a path inside that post's canonical media folder. The generator copies only referenced media, never the entire canonical archive.

For composer records, the JSON Feed extension `_fieldlight_content_hash` is independently recomputed from the actual title, body, and ordered image records. Photo bytes must match their content-addressed filenames. Historical issue-origin hashes remain preserved for compatibility with the issue workflow. Extra record fields are otherwise ignored. The **Source record** link points to canonical JSON; the originating GitHub issue is not the canonical publication.

Each post receives a stable public URL at `/stream/posts/post-123/`. Editing the record keeps its URL and `published_at`; `updated_at` records the revision. Removing an authorized record removes its generated post page and referenced media during the next build. The generator owns `stream/posts/` and `stream/media/`; do not place hand-maintained files there.

## Publications and dates

`stream/publications.json` is the preserved pre-stream feed baseline, including its original RSS GUID values, attributes, and publication-date strings. **Do not overwrite it from generated feeds.** Root `feed.json` and `feed.xml` are outputs, never generator inputs.

The publication catalog is the union of that baseline, public publication URLs in `continuity/data.json`, and reading links in `writing/index.html`. Existing metadata is read from those pages. Reader Continuity's private/context sections are not read. A publication's existing feed summary takes precedence over page metadata; new catalog entries use the page's existing description.

The baseline preserves exact IDs and publication times. Explicit `datePublished` or `article:published_time` can date additional existing publications. A date-only source is serialized at midnight UTC for JSON Feed compatibility and displayed as a calendar date. Modification dates, image filenames, migration dates, and today's date are never substituted for a missing publication date. Undated works appear in **Earlier publications** and omit feed publication timestamps.

## Feeds and subscriptions

- `/feed.xml` and `/feed.json`: Publications; existing subscriber URLs and GUIDs remain stable.
- `/stream/feed.xml` and `/stream/feed.json`: Everything, with complete short-post text and photographs. RSS includes `content:encoded`; JSON Feed includes `content_html` and `content_text`.

Adding a short post does not send a Buttondown email. The email link keeps the existing new-work-and-substantial-updates subscription promise. The two RSS feeds let readers choose their own frequency.

## Maintained files

- `scripts/build-stream.py`: deterministic catalog, rendering, feeds, and media copying.
- `scripts/templates/stream.html`: stream and Publications page template.
- `scripts/templates/stream-post.html`: post permalink template.
- `stream/stream.css` and `stream/stream.js`: responsive presentation and optional filter enhancement.
- `stream/publications.json`: original feed metadata and identity baseline.
- `tests/test_stream.py`: publication identity/date preservation, source boundary, escaping, photos, and view separation.
- `post/`: composer, publishing adapter, encrypted connection storage, and narrowly cached offline editor shell.
- `tests/test_composer.mjs`, `tests/test_publisher.mjs`, and `tests/test_connection.mjs`: draft/photo recovery, publication identity and confirmation, repository writes, and remembered-key protection. Run with `node --test tests/test_composer.mjs tests/test_publisher.mjs tests/test_connection.mjs`.

Run the site's existing `scripts/check-reader-continuity.py` after generation. Regenerate `sitemap.xml` with the site's sitemap script when publishing new permalink pages. Keep the author doorway and private authoring tools excluded from the public sitemap as appropriate. Every generated public page includes the existing Cloudflare analytics beacon.

## GitHub Pages publication

The website publishes independently through `.github/workflows/publish.yml`, using only its own short-lived `GITHUB_TOKEN`. The canonical author repository remains separate. The website workflow reads public `annimch04/public-writing` over HTTPS and has no write access to it. The deployment workflow requires no deploy key, personal access token, or extra account credential; the author's browser connection is separate.

**Setup:** In the website repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source (`build_type: workflow`). Keep the existing custom domain. The deployment job uses the `github-pages` environment and the official upload/deploy actions. GitHub documents this setup in [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The workflow runs on website pushes to `main`, a manual **Run workflow**, and a schedule at minutes 7, 17, 27, 37, 47, and 57 of each hour. A new canonical post is normally picked up at the next scheduled run, approximately ten minutes or less before build/deployment time. This is not an immediate-delivery guarantee: GitHub may delay scheduled runs or drop queued runs under heavy load. GitHub also disables a public repository's schedule after 60 days without repository activity; after a genuinely inactive period, re-enable the workflow and run it manually. See [GitHub's schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The build job has `contents: write` only within the website repository. It validates generated files, then commits only the generator's manifest paths and `sitemap.xml` when they change. These real content updates keep the website's source record current as posts arrive. GitHub does not trigger another push workflow from a commit made with that same repository's `GITHUB_TOKEN`, so the current workflow proceeds to deployment itself. See [Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

The separate deploy job has `contents: read`, `pages: write`, and `id-token: write`. Whole-workflow concurrency allows the active publication to finish and ensures queued runs check out current `main`. If an owner changes website `main` during a build, the publisher aborts rather than rebasing already-generated files onto a different source revision; a subsequent run regenerates from the current checkout.

A successful artifact includes `stream/deployment.json` with the website and canonical-source commit IDs. When both IDs are already live, later scheduled runs skip generation and deployment. A failed deployment leaves the old live marker, so the next run retries. Manual dispatch always permits a fresh deployment.

`scripts/prepare-pages.py` packages only tracked public HTML, styles, scripts, reader data, and media into a new directory under `RUNNER_TEMP`, then adds `.nojekyll`. It excludes repository metadata, workflow files, Markdown, tests, implementation scripts, documentation, templates, and the preserved feed baseline. The canonical source checkout is a sibling directory and is never packaged. Symbolic links are rejected; files are copied as regular files.

The public-feed content hash remains the confirmation of a particular post revision. A saved canonical record, a website commit, a successful Pages deployment, and a verified public post are separate states.
