// PDF size limits, shared by the browser (which picks the upload path) and the server (which enforces them).
//
//   ≤ 4 MB  ──► POST /api/play/upload (one request; Vercel caps request bodies at ~4.5 MB)
//   ≤ 15 MB ──► start ──► PUT straight to Storage ──► finish (see app/api/play/upload/start)

/** Largest PDF sent through the one-request upload. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Largest PDF Curio reads at all: big uploads, arXiv downloads, and the Storage bucket's own limit. */
export const MAX_PDF_BYTES = 15 * 1024 * 1024;
