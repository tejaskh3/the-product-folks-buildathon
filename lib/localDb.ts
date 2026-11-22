// Server-only: a small local stand-in for Supabase, so Curio runs with no database service.
// It implements just the slice of supabase-js that Curio uses (tables, a few rpc functions,
// and a "papers" storage bucket) on top of a JSON file and a folder of PDFs.
//
//   data dir: CURIO_DATA_DIR, else /tmp/curio-data on Vercel, else ./.curio-data
//     db.json           every table, reloaded when another process (e.g. a script) changes it
//     storage/<bucket>/  stored files; served by /api/local-storage/<bucket>/<path>
//
// Good for local demos. On Vercel, uploads live only as long as the server instance does.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Result = { data: unknown; error: { message: string } | null; count?: number | null };

const DATA_DIR = process.env.CURIO_DATA_DIR || (process.env.VERCEL ? "/tmp/curio-data" : path.join(process.cwd(), ".curio-data"));
const DB_FILE = path.join(DATA_DIR, "db.json");
const STORAGE_DIR = path.join(DATA_DIR, "storage");

/** Base for "signed" URLs. Must be absolute (routes redirect to it). */
const baseUrl = () =>
  process.env.LOCAL_STORAGE_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT || 3000}`);

// ---- the table file ---------------------------------------------------------------------------

const g = globalThis as unknown as { __curioDb?: { tables: Tables; mtime: number } };

function load(): Tables {
  let mtime = 0;
  try {
    mtime = fs.statSync(DB_FILE).mtimeMs;
  } catch {}
  if (!g.__curioDb || g.__curioDb.mtime !== mtime) {
    let tables: Tables = {};
    try {
      tables = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {}
    g.__curioDb = { tables, mtime };
  }
  return g.__curioDb.tables;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(g.__curioDb!.tables));
  fs.renameSync(tmp, DB_FILE);
  g.__curioDb!.mtime = fs.statSync(DB_FILE).mtimeMs;
}

const table = (name: string): Row[] => (load()[name] ??= []);
const now = () => new Date().toISOString();
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// ---- value comparison -------------------------------------------------------------------------

const isNil = (v: unknown) => v === null || v === undefined;
function same(a: unknown, b: unknown): boolean {
  if (isNil(a) || isNil(b)) return isNil(a) && isNil(b);
  return a === b || String(a) === String(b);
}
function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
/** A PostgREST literal from an or() string: "true", "null", "5", "abc". */
function literal(s: string): unknown {
  if (s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  return s;
}

type Pred = (r: Row) => boolean;

function opPred(col: string, op: string, val: unknown): Pred {
  switch (op) {
    case "eq":
      return (r) => same(r[col], val);
    case "neq":
      return (r) => !same(r[col], val);
    case "is":
      return (r) => (isNil(val) ? isNil(r[col]) : same(r[col], val));
    case "gt":
      return (r) => !isNil(r[col]) && cmp(r[col], val) > 0;
    case "gte":
      return (r) => !isNil(r[col]) && cmp(r[col], val) >= 0;
    case "lt":
      return (r) => !isNil(r[col]) && cmp(r[col], val) < 0;
    case "lte":
      return (r) => !isNil(r[col]) && cmp(r[col], val) <= 0;
    case "in": {
      const list = Array.isArray(val) ? val : String(val).replace(/^\(|\)$/g, "").split(",").map(literal);
      return (r) => list.some((v) => same(r[col], v));
    }
    case "cs":
      return (r) => Array.isArray(r[col]) && (Array.isArray(val) ? val : [val]).every((v) => (r[col] as unknown[]).some((x) => same(x, v)));
    default:
      throw new Error(`localDb: unsupported filter "${op}"`);
  }
}

/** "a.eq.1,b.is.null,c.not.is.null" → one predicate (any of). */
function orPred(expr: string): Pred {
  const parts = expr.split(",").map((p) => p.trim()).filter(Boolean);
  const preds = parts.map((p) => {
    const [col, ...rest] = p.split(".");
    let negate = false;
    if (rest[0] === "not") {
      negate = true;
      rest.shift();
    }
    const op = rest.shift()!;
    const pred = opPred(col, op, literal(rest.join(".")));
    return negate ? (r: Row) => !pred(r) : pred;
  });
  return (r) => preds.some((p) => p(r));
}

// ---- select lists with embedded relations -----------------------------------------------------

/** Split on top-level commas: "a, b, papers!inner(x, y)" → ["a", "b", "papers!inner(x, y)"]. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const singular = (t: string) => t.replace(/s$/, "");

function project(tableName: string, row: Row, cols: string): Row | null {
  const items = splitTop(cols || "*");
  const out: Row = {};
  for (const item of items) {
    const rel = item.match(/^([a-z_]+)(!inner)?\(([\s\S]*)\)$/);
    if (!rel) {
      if (item === "*") Object.assign(out, clone(row));
      else out[item] = clone(row[item] ?? null);
      continue;
    }
    const [, relTable, inner, relCols] = rel;
    const fk = `${singular(relTable)}_id`;
    let value: unknown;
    if (fk in row) {
      // many-to-one: this row points at the related one
      const target = table(relTable).find((t) => same(t.id, row[fk]));
      value = target ? project(relTable, target, relCols) : null;
    } else {
      // one-to-many: related rows point back at this one
      const back = `${singular(tableName)}_id`;
      value = table(relTable).filter((t) => same(t[back], row.id)).map((t) => project(relTable, t, relCols));
    }
    if (inner && (value === null || (Array.isArray(value) && !value.length))) return null;
    out[relTable] = value;
  }
  return out;
}

// ---- table defaults ---------------------------------------------------------------------------

const DEFAULTS: Record<string, Row> = {
  papers: { owner: null, is_public: false, walkthrough: null, walkthrough_plan: null, suggestions: null, digest: null, library_slug: null, library_rank: null, library_blurb: null, drawing_until: null },
  nodes: { owner: "" },
  comments: { hidden: false, report_count: 0, deleted_at: null },
};

function withDefaults(name: string, r: Row): Row {
  const t = now();
  return { id: randomUUID(), created_at: t, updated_at: t, ...DEFAULTS[name], ...clone(r) };
}

// ---- the query builder ------------------------------------------------------------------------

type Action = { kind: "select" } | { kind: "insert"; rows: Row[] } | { kind: "upsert"; rows: Row[]; onConflict: string[]; ignore: boolean } | { kind: "update"; values: Row } | { kind: "delete" };

class Query implements PromiseLike<Result> {
  private preds: Pred[] = [];
  private action: Action = { kind: "select" };
  private cols: string | null = null;
  private countMode = false;
  private head = false;
  private orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  private lim: number | null = null;
  private from_ = 0;
  private one: "single" | "maybe" | null = null;

  constructor(private name: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    this.cols = cols;
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.action = { kind: "insert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.action = { kind: "upsert", rows: Array.isArray(rows) ? rows : [rows], onConflict: (opts?.onConflict ?? "id").split(",").map((s) => s.trim()), ignore: !!opts?.ignoreDuplicates };
    return this;
  }
  update(values: Row) {
    this.action = { kind: "update", values };
    return this;
  }
  delete() {
    this.action = { kind: "delete" };
    return this;
  }

  eq(c: string, v: unknown) { this.preds.push(opPred(c, "eq", v)); return this; }
  neq(c: string, v: unknown) { this.preds.push(opPred(c, "neq", v)); return this; }
  gt(c: string, v: unknown) { this.preds.push(opPred(c, "gt", v)); return this; }
  gte(c: string, v: unknown) { this.preds.push(opPred(c, "gte", v)); return this; }
  lt(c: string, v: unknown) { this.preds.push(opPred(c, "lt", v)); return this; }
  lte(c: string, v: unknown) { this.preds.push(opPred(c, "lte", v)); return this; }
  is(c: string, v: unknown) { this.preds.push(opPred(c, "is", v)); return this; }
  in(c: string, v: unknown[]) { this.preds.push(opPred(c, "in", v)); return this; }
  contains(c: string, v: unknown) { this.preds.push(opPred(c, "cs", v)); return this; }
  filter(c: string, op: string, v: unknown) { this.preds.push(opPred(c, op, typeof v === "string" ? literal(v) : v)); return this; }
  not(c: string, op: string, v: unknown) {
    const p = opPred(c, op, v);
    this.preds.push((r) => !p(r));
    return this;
  }
  or(expr: string) { this.preds.push(orPred(expr)); return this; }
  match(obj: Row) {
    for (const [c, v] of Object.entries(obj)) this.eq(c, v);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const asc = opts?.ascending ?? true;
    this.orders.push({ col, asc, nullsFirst: opts?.nullsFirst ?? !asc });
    return this;
  }
  limit(n: number) { this.lim = n; return this; }
  range(from: number, to: number) { this.from_ = from; this.lim = to - from + 1; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  returns() { return this; }
  throwOnError() { return this; }

  private matches(): Row[] {
    return table(this.name).filter((r) => this.preds.every((p) => p(r)));
  }

  private run(): Result {
    let rows: Row[];
    const a = this.action;
    if (a.kind === "select") rows = this.matches();
    else if (a.kind === "insert") {
      rows = a.rows.map((r) => withDefaults(this.name, r));
      table(this.name).push(...rows);
      save();
    } else if (a.kind === "upsert") {
      rows = [];
      for (const r of a.rows) {
        const existing = table(this.name).find((t) => a.onConflict.every((c) => same(t[c], r[c])));
        if (existing) {
          if (a.ignore) continue;
          Object.assign(existing, clone(r), "updated_at" in existing ? { updated_at: now() } : {});
          rows.push(existing);
        } else {
          const fresh = withDefaults(this.name, r);
          table(this.name).push(fresh);
          rows.push(fresh);
        }
      }
      save();
    } else if (a.kind === "update") {
      rows = this.matches();
      for (const r of rows) Object.assign(r, clone(a.values), "updated_at" in r && !("updated_at" in a.values) ? { updated_at: now() } : {});
      save();
    } else {
      rows = this.matches();
      const gone = new Set(rows);
      load()[this.name] = table(this.name).filter((r) => !gone.has(r));
      save();
    }

    // Writes return rows only when .select() asked for them.
    if (a.kind !== "select" && this.cols === null) return { data: null, error: null };

    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((x, y) => {
        const a1 = x[o.col], b1 = y[o.col];
        if (isNil(a1) || isNil(b1)) return isNil(a1) && isNil(b1) ? 0 : isNil(a1) === o.nullsFirst ? -1 : 1;
        return o.asc ? cmp(a1, b1) : cmp(b1, a1);
      });
    }
    let out = rows.map((r) => project(this.name, r, this.cols ?? "*")).filter((r): r is Row => r !== null);
    const count = this.countMode ? out.length : null;
    if (this.head) return { data: null, error: null, count };
    out = out.slice(this.from_, this.lim === null ? undefined : this.from_ + this.lim);

    if (this.one) {
      if (out.length > 1) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" }, count };
      if (!out.length) return this.one === "single" ? { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" }, count } : { data: null, error: null, count };
      return { data: out[0], error: null, count };
    }
    return { data: out, error: null, count };
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    let res: Result;
    try {
      res = this.run();
    } catch (err) {
      res = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
    return Promise.resolve(res).then(ok, fail);
  }
}

// ---- rpc: the SQL functions Curio calls -------------------------------------------------------

function rpc(fn: string, args: Row): Result {
  const papers = table("papers");
  switch (fn) {
    case "authorize_generation":
      // No plans or quotas in local mode: every generation is allowed on the platform key.
      return { data: { allowed: true, reason: "already_counted", plan: "free", key_source: "platform", reserved_now: false, used: 0, allowance: null }, error: null };
    case "mark_paper_used":
    case "refund_paper":
      return { data: null, error: null };
    case "save_walkthrough_scene": {
      const p = papers.find((r) => same(r.id, args.p_paper));
      if (p) {
        const scene = args.p_scene as Row;
        const plan = p.walkthrough_plan as Row | null;
        const w = (p.walkthrough as { paper?: unknown; scenes: Row[] } | null) ?? { paper: plan?.paper, scenes: [] };
        w.scenes = [...w.scenes.filter((s) => !same(s.id, scene.id)), scene].sort((x, y) => Number(x.index) - Number(y.index));
        p.walkthrough = w;
        p.updated_at = now();
        save();
      }
      return { data: null, error: null };
    }
    case "take_drawing_lease": {
      const p = papers.find((r) => same(r.id, args.p_paper));
      const free = p && (isNil(p.drawing_until) || Date.parse(String(p.drawing_until)) < Date.now());
      if (p && free) {
        p.drawing_until = new Date(Date.now() + Number(args.p_seconds) * 1000).toISOString();
        save();
      }
      return { data: !!free, error: null };
    }
    case "report_comment": {
      const c = table("comments").find((r) => same(r.id, args.p_comment));
      if (!c) return { data: [], error: null };
      const reports = table("comment_reports");
      if (!reports.some((r) => same(r.comment_id, c.id) && same(r.reporter, args.p_reporter))) {
        reports.push(withDefaults("comment_reports", { comment_id: c.id, reporter: args.p_reporter, reason: args.p_reason }));
        c.report_count = Number(c.report_count ?? 0) + 1;
        if (Number(c.report_count) >= Number(args.p_hide_at)) c.hidden = true;
        save();
      }
      return { data: [{ report_count: c.report_count, hidden: c.hidden }], error: null };
    }
    default:
      return { data: null, error: { message: `localDb: unknown function ${fn}` } };
  }
}

// ---- storage ----------------------------------------------------------------------------------

/** The file on disk for a bucket path, refusing anything that escapes the storage folder. */
export function storageFile(bucket: string, p: string): string {
  const root = path.join(STORAGE_DIR, bucket);
  const file = path.resolve(root, p);
  if (!file.startsWith(root + path.sep)) throw new Error("bad storage path");
  return file;
}

const storageUrl = (bucket: string, p: string) => `${baseUrl()}/api/local-storage/${bucket}/${p.split("/").map(encodeURIComponent).join("/")}`;

function bucket(name: string) {
  const err = (message: string) => ({ data: null, error: { message } });
  return {
    async upload(p: string, body: Buffer | Uint8Array | ArrayBuffer | Blob, opts?: { upsert?: boolean }) {
      const file = storageFile(name, p);
      if (!opts?.upsert && fs.existsSync(file)) return err("The resource already exists");
      const bytes = body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : Buffer.from(body as ArrayBuffer);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      return { data: { path: p }, error: null };
    },
    async download(p: string) {
      const file = storageFile(name, p);
      if (!fs.existsSync(file)) return err("Object not found");
      return { data: new Blob([new Uint8Array(fs.readFileSync(file))], { type: "application/pdf" }), error: null };
    },
    async createSignedUrl(p: string) {
      if (!fs.existsSync(storageFile(name, p))) return err("Object not found");
      return { data: { signedUrl: storageUrl(name, p) }, error: null };
    },
    async createSignedUploadUrl(p: string) {
      storageFile(name, p);
      return { data: { signedUrl: storageUrl(name, p), token: "local", path: p }, error: null };
    },
    async remove(paths: string[]) {
      for (const p of paths) fs.rmSync(storageFile(name, p), { force: true });
      return { data: paths.map((p) => ({ name: p })), error: null };
    },
  };
}

// ---- the client -------------------------------------------------------------------------------

export function localClient() {
  return {
    from: (name: string) => new Query(name),
    rpc: (fn: string, args: Row = {}) => Promise.resolve(rpc(fn, args)),
    storage: { from: bucket },
  };
}
