// GET/PUT /api/local-storage/<bucket>/<path> — the local stand-in for Supabase Storage's signed URLs
// (lib/localDb.ts). The reading panel GETs paper PDFs here; big uploads PUT here before ./finish.
import fs from "node:fs";
import path from "node:path";
import { storageFile } from "@/lib/localDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fileFor(params: Promise<{ path: string[] }>): Promise<string | null> {
  const [bucket, ...rest] = (await params).path.map(decodeURIComponent);
  if (!bucket || !rest.length) return null;
  try {
    return storageFile(bucket, rest.join("/"));
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const file = await fileFor(params);
  if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "content-type": "application/pdf", "cache-control": "private, max-age=600" },
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const file = await fileFor(params);
  // Only staged uploads may be written from the browser.
  if (!file || !file.includes(`${path.sep}incoming${path.sep}`)) return new Response("Forbidden", { status: 403 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await req.arrayBuffer()));
  return new Response(null, { status: 200 });
}
