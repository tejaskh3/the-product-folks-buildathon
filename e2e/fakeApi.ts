// A stand-in for Curio's /api routes, answered inside the browser. It keeps a little state the
// way the server does (the saved paper fills in as scenes stream, the plan turns active after
// checkout), so the tests can follow a user across pages. Scenes are the bundled Attention demo.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import type { Walkthrough } from "@/lib/walkthrough";

export const E2E_EMAIL = "curio-e2e+clerk_test@example.com";

const DEMO = JSON.parse(readFileSync("public/demo/walkthrough.json", "utf8")) as Walkthrough;
export const PDF = readFileSync("public/demo/attention.pdf");
export const SCENES = DEMO.scenes;

type Plan = "free" | "byok" | "starter" | "pro";

export function answerDiagram(title: string) {
  const ids = ["a", "b"];
  return {
    id: "answer",
    title,
    caption: "How the parts fit together.",
    tryHint: "Click a box.",
    html: `<svg viewBox="0 0 200 100">${ids.map((id, i) => `<g data-explore="${id}"><rect x="${10 + i * 100}" y="20" width="80" height="60" fill="#eee"/><text x="${20 + i * 100}" y="55">${id}</text></g>`).join("")}</svg>`,
    explorables: ids.map((id) => ({ id, label: `Part ${id}`, blurb: `What part ${id} does.`, pages: [3], quote: "attention" })),
  };
}

export class FakeApi {
  readonly paperId = randomUUID();
  readonly calls: { method: string; path: string; body: unknown }[] = [];
  /** What the server would say about the user's plan. */
  plan: Plan = "free";
  used = 0;
  /** Out of papers: the next walkthrough is refused with a 402 "quota". */
  outOfPapers = false;
  /** Uploads come back as a library paper (served free, with saved suggestions). */
  demo = false;
  /** Sync calls that still answer "pending" before the plan shows as active. */
  pendingSyncs = 1;
  /** arXiv ids the library already has: a paper request for one is linked, not filed. */
  libraryArxiv = new Set<string>();
  /** Sizes of the files PUT to the stand-in for Storage's signed upload URL (big uploads). */
  readonly storagePuts: number[] = [];
  private saved: Walkthrough | null = null;
  /** The public discussion on this paper (library papers only). */
  comments: { id: string; author: string; sceneId: string | null; body: string; createdAt: string; mine: boolean; hidden: boolean; reportedByMe: boolean }[] = [
    { id: randomUUID(), author: "Grace H.", sceneId: null, body: "The positional encodings section is the one to reread.", createdAt: new Date().toISOString(), mine: false, hidden: false, reportedByMe: false },
  ];
  readonly reports: string[] = [];
  /** The reader's private layer on this paper, as the reading routes keep it. */
  reading = { favorite: false, notes: "", opened: false, bookmarks: [] as Record<string, unknown>[], highlights: [] as Record<string, unknown>[] };
  private nodes: unknown[] = [];

  constructor(private page: Page) {}

  async install() {
    await this.page.route("**/api/**", (route) => this.handle(route));
  }

  called(method: string, path: string) {
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  private ndjson(route: Route, events: unknown[]) {
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: events.map((e) => JSON.stringify(e)).join("\n") + "\n" });
  }

  private paperRow() {
    return {
      id: this.paperId,
      paper_key: `sha:${this.paperId}`,
      name: "attention.pdf",
      title: this.saved?.paper.title ?? null,
      authors: null,
      year: null,
      arxiv_id: null,
      updated_at: new Date().toISOString(),
      file_id: null,
      pdf_sha256: this.paperId,
      is_public: false,
      walkthrough: this.saved,
      walkthrough_plan: this.saved ? { scenes: this.saved.scenes.map((s) => ({ id: s.id })) } : null,
    };
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    // Big uploads PUT the file to a signed Storage URL; this stands in for it.
    if (req.method() === "PUT" && path.startsWith("/api/e2e-storage/")) {
      this.storagePuts.push(req.postDataBuffer()?.length ?? 0);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: path }) });
    }
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData() ? "(form)" : null;
    }
    this.calls.push({ method: req.method(), path, body });
    const json = (status: number, data: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

    switch (`${req.method()} ${path}`) {
      case "GET /api/account":
        return json(200, {
          plan: this.plan,
          status: "active",
          billing: true,
          used: this.used,
          allowance: { free: 2, byok: null, starter: 10, pro: 30 }[this.plan],
          periodEnd: null,
          cancelAtPeriodEnd: false,
          canManageBilling: this.plan !== "free",
          key: null,
        });
      case "POST /api/play/upload/start": {
        const staged = `incoming/e2e/${randomUUID()}.pdf`;
        return json(200, { path: staged, signedUrl: `${url.origin}/api/e2e-storage/${staged}?token=t` });
      }
      case "POST /api/play/upload":
      case "POST /api/play/upload/finish":
        return json(200, {
          paperId: this.paperId,
          key: `sha:${this.paperId}`,
          name: "attention.pdf",
          ...(this.demo ? { demo: true, library: true, suggestions: this.suggestions() } : {}),
        });
      case "GET /api/play/papers":
        if (url.searchParams.has("key")) return json(404, { error: "Not found" });
        return json(200, { papers: [] });
      case `GET /api/play/papers/${this.paperId}`:
        return json(200, { paper: this.paperRow(), nodes: this.nodes });
      case `GET /api/play/papers/${this.paperId}/pdf`:
        return route.fulfill({ status: 200, contentType: "application/pdf", body: PDF });
      case "POST /api/play/suggest":
        return json(200, this.suggestions());
      case "POST /api/play/walkthrough": {
        if (this.outOfPapers)
          return json(402, { error: "You’ve used your 2 free papers.", reason: "quota", plan: this.plan, used: 2, allowance: 2 });
        this.used += 1;
        this.saved = DEMO;
        const plan = { type: "plan", paper: DEMO.paper, scenes: DEMO.scenes.map(({ diagram: _d, ...s }) => s) };
        return this.ndjson(route, [plan, ...DEMO.scenes.map((scene) => ({ type: "scene", scene })), { type: "done" }]);
      }
      case "POST /api/play/diagram": {
        const { node } = body as { node: { id: string; kind: string; title: string; parentId: string | null } };
        const diagram = { ...answerDiagram(`Answer: ${node.title}`), id: node.id };
        this.nodes.push({ ...node, diagram, status: "ready", createdAt: Date.now() });
        return this.ndjson(route, [{ type: "status", stage: "reading" }, { type: "status", stage: "drawing" }, { type: "done", diagram }]);
      }
      case `GET /api/play/papers/${this.paperId}/reading`: {
        const { favorite, notes, bookmarks, highlights } = this.reading;
        return json(200, { favorite, notes, bookmarks, highlights });
      }
      case `PATCH /api/play/papers/${this.paperId}/reading`: {
        const b = body as { favorite?: boolean; notes?: string; opened?: boolean };
        Object.assign(this.reading, b);
        return route.fulfill({ status: 204 });
      }
      case `POST /api/play/papers/${this.paperId}/bookmarks`: {
        const b = { id: randomUUID(), created_at: new Date().toISOString(), label: "", ...(body as object) };
        this.reading.bookmarks.push(b);
        return json(201, b);
      }
      case `DELETE /api/play/papers/${this.paperId}/bookmarks`:
        this.reading.bookmarks = this.reading.bookmarks.filter((b) => b.id !== url.searchParams.get("id"));
        return route.fulfill({ status: 204 });
      case `POST /api/play/papers/${this.paperId}/highlights`: {
        const h = { id: randomUUID(), created_at: new Date().toISOString(), color: "yellow", note: "", ...(body as object) };
        this.reading.highlights.push(h);
        return json(201, h);
      }
      case `PATCH /api/play/papers/${this.paperId}/highlights`: {
        const h = this.reading.highlights.find((x) => x.id === url.searchParams.get("id"));
        if (!h) return json(400, { error: "That highlight is gone." });
        Object.assign(h, body);
        return json(200, h);
      }
      case `DELETE /api/play/papers/${this.paperId}/highlights`:
        this.reading.highlights = this.reading.highlights.filter((h) => h.id !== url.searchParams.get("id"));
        return route.fulfill({ status: 204 });
      case `GET /api/play/papers/${this.paperId}/comments`:
        return this.demo ? json(200, { comments: this.comments }) : json(404, { error: "No discussion here." });
      case `POST /api/play/papers/${this.paperId}/comments`: {
        const b = body as { body: string; sceneId: string | null };
        const c = { id: randomUUID(), author: "Curio E.", sceneId: b.sceneId, body: b.body.trim(), createdAt: new Date().toISOString(), mine: true, hidden: false, reportedByMe: false };
        this.comments.push(c);
        return json(201, c);
      }
      case `DELETE /api/play/papers/${this.paperId}/comments`:
        this.comments = this.comments.filter((c) => c.id !== url.searchParams.get("id"));
        return route.fulfill({ status: 204 });
      case `POST /api/play/papers/${this.paperId}/comments/report`:
        this.reports.push((body as { id: string }).id);
        return json(200, { hidden: false });
      case "GET /api/play/shelf": {
        const paper = { id: this.paperId, title: DEMO.paper.title, name: "attention.pdf", authors: DEMO.paper.authors, year: DEMO.paper.year };
        return json(200, {
          library: [],
          mine: this.saved ? [{ ...paper, at: new Date().toISOString() }] : [],
          favorites: this.reading.favorite ? [{ ...paper, at: new Date().toISOString() }] : [],
          bookmarks: this.reading.bookmarks.map((b) => ({ ...b, paper: { id: this.paperId, title: paper.title, name: paper.name } })),
          history: this.reading.opened ? [{ ...paper, at: new Date().toISOString() }] : [],
        });
      }
      case "POST /api/billing/checkout": {
        const { plan, next } = body as { plan: Plan; next: string };
        this.pendingPlan = plan;
        // Dodo's hosted page is skipped: straight to where Dodo would send them after paying.
        return json(200, { url: `/billing/return?subscription_id=sub_e2e&status=active&next=${encodeURIComponent(next)}` });
      }
      case "POST /api/billing/sync": {
        if (this.pendingSyncs-- > 0) return json(200, { status: "pending" });
        this.plan = this.pendingPlan ?? "starter";
        this.used = 0;
        this.outOfPapers = false;
        return json(200, { status: "active", plan: this.plan });
      }
      case "POST /api/feedback": {
        const { kind, arxiv } = body as { kind: string; arxiv?: string };
        const id = arxiv?.match(/\d{4}\.\d{4,5}/)?.[0];
        if (kind === "paper" && id && this.libraryArxiv.has(id))
          return json(200, { library: { id: this.paperId, title: DEMO.paper.title, href: `/play/${this.paperId}` } });
        return json(200, { ok: true });
      }
      default:
        return json(404, { error: `fakeApi: no handler for ${req.method()} ${path}` });
    }
  }

  private pendingPlan: Plan | null = null;

  private suggestions() {
    return {
      title: DEMO.paper.title,
      authors: DEMO.paper.authors,
      year: DEMO.paper.year,
      questions: [{ title: "Why drop recurrence entirely?", hook: "h", pages: [2], quote: "recurrence" }],
    };
  }
}
