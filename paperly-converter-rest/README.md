# Paperly PDF Workspace — v2.1

Production: https://paperly-image-to-pdf.vercel.app

An independently designed PDF toolkit with 36 browser-based tools. This replaces the original image converter homepage, while preserving the dedicated image workspace at `/image-to-pdf/index.html`. The cinema application in the parent directory is untouched.

## Run locally

Run `npm start` from this directory, then open http://localhost:4178. No dependency installation or build is needed to serve the app. All deployable files are in `dist/`.

## Available tools

| Category | Tools |
| --- | --- |
| Organize | Merge, split, remove pages, extract pages, visual organizer, workflow |
| Optimize | Lossless or raster compression, repair, English OCR, grayscale |
| Convert | Images to PDF, scan to PDF, PDF to JPG/PNG, PDF to Word, PDF to PowerPoint, PDF to Excel, DOCX text to PDF, PPTX text handouts to PDF, XLSX/CSV values to PDF, HTML text to PDF, PDF to text, PDF to Markdown |
| Edit | Add text/images/shape outlines, rotate, numbers, watermarks, crop, resize, create/fill AcroForms, flatten forms |
| Security | AES-256 password protection, correct-password unlock, visual signatures, permanent raster redaction, text comparison, metadata |

The directory supports search, category filtering, favorites, and recent tools. File workspaces support drag/drop, file reordering, document previews, progress, cancellation, output previews, individual or ZIP downloads, and handing results to another tool. The visual organizer supports per-page reordering, duplication, rotation, and removal. The redaction rectangle can be drawn on the preview. The signature pad supports mouse and touch.

## No artificial usage quotas

The previous 50-image, 20 MB, and 40-megapixel input caps are removed. No daily task quota, file-count cap, mandatory watermark, or account is imposed. Browser memory, canvas dimensions, compute, and available storage remain real limits. This is not a promise of infinite file sizes or hosting capacity.

## Visual document editor

Open `/editor/index.html` or select **Edit document** in the toolkit. The original coordinate-based quick editor remains at `/#tool/edit` for existing workflows.

The studio opens PDFs, JPG, PNG, and WebP files, including card-sized documents. It supports click-to-replace horizontal PDF text, English OCR text detection for scans, new text, photo insertion and replacement, shape and cover layers, freehand drawing, exact position/size/rotation/opacity controls, layer ordering, duplication, undo/redo, and multi-page editing. You can start from A4, a blank 85.6 × 54 mm card, or a generic editable community-member-card sample.

Detected-text replacement places a background-color cover over the original region and adds editable replacement text. Fonts are approximated and the cover color is adjustable; patterned backgrounds and complex typography may not match. Existing embedded photos remain part of the background; cover the region and add a new image when needed.

Exports are flattened PDF pages or a PNG/JPG of the current page. All PDF pages are rendered as images, including replacements and covers, so the underlying original text is absent from the exported PDF. This removes selectable text, links, form fields, and existing digital signatures. Preserve the source if those features matter. Editor documents, passwords, layers, and undo histories are kept only in browser memory; export before closing the tab.

Documents and passwords stay in browser memory; only favorite/recent tool IDs are stored in localStorage. Files are not uploaded to a processing server. OCR downloads its worker, WASM engine, and English language model on first use, and may cache the model locally. Fonts load from Google Fonts. The other processing engines are vendored in `dist/assets/engines/`.

## Format and fidelity limits

These are disclosed before use in each relevant tool and in the site's support dialog:

- DOCX, PPTX, and HTML imports preserve text with reflowed layout. Images, original layout, advanced typography, charts, and print settings are not reproduced. Legacy DOC/PPT/XLS are not supported.
- XLSX/CSV import reads cell values, including cached formula values; it does not calculate formulas. PDF-to-Excel groups text items by page position and is not a table recognition engine.
- PDF-to-Word exports selectable text. PDF-to-PowerPoint produces image-based slides. Markdown exports selectable text with page headings rather than reconstructed semantic layout.
- The local PDF text font supports the standard WinAnsi character set. Text import containing unsupported characters fails with an explanation; DOCX/XLSX text exports retain Unicode.
- OCR is English, runs locally, and rebuilds pages with a searchable text layer. Accuracy varies. Some unsupported recognized glyphs may be omitted from the invisible text layer.
- Raster compression, grayscale, OCR, and redaction rebuild pages as images and remove existing links, forms, signatures, and selectable text (OCR adds a new text layer). Lossless compression may save little space; the UI reports when output is larger.
- Redaction rebuilds the result from rendered pages with the selected region covered, removing the underlying original text. Crop only changes the visible boundary and does not permanently delete content.
- Visual signatures are not certificate-based digital signatures or identity verification. Editing a signed PDF can invalidate an existing digital signature.
- Forms support standard AcroForms, not XFA or automatic field detection. Flattening applies to form fields, not all annotation types.
- Comparison is text-based and produces a two-column HTML report; it does not compare graphics or page layout. Repair is best effort, not guaranteed recovery.

## Features requiring additional infrastructure

This is not full iLovePDF feature parity. No processing server, conversion API, AI provider, or signing service was available. Certified PDF/A, full-fidelity Office/URL rendering, AI summaries/translations, multi-party signature requests, and certificate signing are not implemented or advertised as working tools. Their requirements are listed in the site's capabilities dialog. No fake conversion or success result is returned for them.

## Verification

With the server running, run `npm test` for the toolkit suite or `npm run test:images` for the original converter suite. Tests use Playwright with installed Google Chrome. For a standalone checkout, run `npm install` to install the test dependency first. Set `PAPERLY_BASE_URL` to the production URL to run against the live deployment. Set `SKIP_OCR=1` only when deliberately skipping the external OCR model download.

Run `npm run test:editor` for the visual document editor journey, including text replacement, scan OCR, photos, history, page navigation, card dimensions, real downloads, and mobile layout.

The toolkit tests parse generated PDFs and Office ZIP/XML files, check password enforcement and decryption, test irreversible redaction, recognize OCR text, exercise form creation/filling, verify real downloads and tool handoff, and check mobile overflow and browser errors. Reports and screenshots are in `artifacts/`.

## Deployment

Static Vercel project: `paperly-image-to-pdf` (`prj_jQ5L8At8nHbkA15ilKnRKVYGiowH`). The current deployment is recorded in `deployment.json`; exact uploaded file digests are in `deployment-manifest.json`. No server, credentials, or environment variables are needed by the app.

Third-party licenses and attribution are in `dist/THIRD-PARTY-NOTICES.txt` and the engine license files. Paperly is not affiliated with iLovePDF.
