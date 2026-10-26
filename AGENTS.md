# OWEditor contributor instructions

- This is a standalone browser editing library. Do not add business application code, server credentials or real user data.
- Read `docs/specs/initial-release/SPEC.md` before changing release scope.
- The editing engine and UI are original. DOMPurify is a sanitizer; preserve its license notices.
- Use Node 24 and the committed npm lockfile. Run `npm test`, `npm run build -- --check` and `npm run test:browser` for relevant code changes.
- Keep `docs/` usable under a GitHub Pages project subpath. No external fonts or telemetry in the samples.
- Change the version before replacing an already published versioned distribution. Clearly distinguish preview features and unsupported behavior.
- Sample save/export must not transmit content or files. Actual upload/save callbacks belong to the integrating application.
