// pdf.js ships types only for its main entry. The app imports the legacy build (it runs in
// older Android WebViews) and wraps it in lib/research/pdfText.ts, which declares the small
// part of the API it uses.
declare module 'pdfjs-dist/legacy/build/pdf.mjs';
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
