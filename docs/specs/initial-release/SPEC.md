# OWEditor initial public preview

## Objective

Publish the reusable editor, working samples and a Japanese feature introduction in the same GitHub repository: `owjapan/ow-editor`. The owner requested a public repository and GitHub Pages initially, with the ability to make the repository private later.

## Scope

- Extract only the generic editing engine, UI, scoped styles, translations and generic tests into a standalone Node project.
- Provide versioned UMD/ES module/CSS builds, SHA-384 integrity metadata and third-party license notices.
- Include a Japanese feature page, an interactive single-editor sample with a bundled sample image, and a multi-editor ES module sample.
- Samples preserve draft state in the current tab; saving downloads HTML or updates the visible result. No article, image or draft is uploaded by a sample.
- GitHub Pages serves the same repository's `docs/` tree. All sample resources are local/versioned; no font or analytics CDN is used.
- Test the standalone project and the browser samples before uploading.

## Non-Goals

No application deployment, existing repository modification, production/staging operations, account secrets, database export, real user data, npm publication, third-party editor engine, AI/collaboration/Word/PDF parity, new external service accounts or changes to unrelated services.

## Technical Approach

The source has an original document model, editing commands, selection handling, IME composition handling, history and UI. Browser contenteditable/Selection/Range are used. DOMPurify handles HTML sanitization and is bundled with its existing license. Ruby/Rails are not needed to build or consume this repository.

`npm test` runs the generic engine/lifecycle/safety tests. `npm run build` generates the distribution and copies the current preview to `docs/releases/<version>/`. `npm run build -- --check` verifies that a checked-in distribution matches source. `npm run test:browser` uses a local browser and loopback HTTP server to validate the feature page, both samples, image preview/save/source workflows, mobile overflow and resource failures.

## User Experience

The feature page links directly to usable demos and integration instructions. The sample explicitly distinguishes an HTML download from server-side saving. The sample adds a bundled landscape image and preserves its public URL in downloaded HTML; no files are uploaded. The reusable library's upload callback remains configurable for an integrating application.

## Success Criteria

- A public GitHub repository contains source, lockfile, instructions, generic tests, versioned builds and all page sources.
- Feature and sample pages work at a project subpath as well as a loopback server.
- The sample can type, format, add and edit the bundled image, export HTML, cancel/apply HTML source editing, and independently edit multiple fields.
- No library code or distribution depends on a specific business application, database, host, API key or Rails.
- Public-facing copy accurately lists initial limitations and the actual sanitizer dependency.
- No existing application's settings or Git history is uploaded or changed.

## Test Plan

Reuse the generic JavaScript tests, build without editing-engine dependencies, run browser tests on synthetic text/images, check desktop/mobile screenshots, inspect included files for unexpected secrets or local paths, and verify the GitHub upload and published Pages endpoint.

## Open Questions

- Public preview licensing has not been changed to an open-source license; no license key or usage meter is implemented.
- Safari, macOS native IME and Android require additional device acceptance checks.
- Making a repository private does not retract previously downloaded copies or public forks. Pages hosting and consumers must be reviewed separately when visibility changes.

## Verification — 2026-10-26

- Standalone clean install: `npm ci --ignore-scripts` succeeded using only this repository's lockfile (195 installed packages).
- Generic JavaScript tests: 33 passed, no failures.
- UMD/ES module/CSS build: succeeded. All three assets include SHA-384 metadata; no business-application adapter is bundled.
- Chromium sample tests: 5 passed, no script errors, missing resources or non-GET network requests.
- Screenshots inspected for the feature page and editor demo on desktop and 390px mobile viewport.
- Browser tests ran in a no-egress container under a simulated `/ow-editor/` project path. No database or application server was required.
- A regression test reproduces and verifies the fix for image property controls being detached on selection changes.
- Public-file scan found no private key blocks, known API-key patterns, local home paths or business application endpoints in runtime assets.
- Safari, macOS native IME and Android remain unverified.
