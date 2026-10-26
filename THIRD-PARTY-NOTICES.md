# Third-party notices

OWEditor's editing engine and UI do not use CKEditor, Tiptap or ProseMirror.

The distribution bundles **DOMPurify 3.4.17** for HTML sanitization. DOMPurify is
provided under its own Apache-2.0 OR MPL-2.0 license terms. Its complete upstream
license is copied to `docs/releases/0.1.0/DOMPurify-LICENSE.txt` and `dist/` during
the build. Preserve that file and the extracted JavaScript license notices when
redistributing the compiled files.

Node build and test dependencies are recorded in `package-lock.json`; their
upstream licenses remain applicable. They are not browser editing engines and
are not all bundled into the runtime.
