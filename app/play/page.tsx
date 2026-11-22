"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DiagramStage, type Crumb, type DeeperStatus } from "@/components/demo/DiagramStage";
import type { PaperTarget } from "@/components/demo/PaperPanel";
import { PRODUCT_NAME } from "@/components/landing/site";
import { AgentsWorking } from "@/components/live/AgentsWorking";
import { UploadScreen } from "@/components/play/Entry";
import { QuestionTree, STAGE_LABEL } from "@/components/play/QuestionTree";
import {
  getPersistence,
  nodeLineage,
  paperKey,
  persist,
  rootSceneId,
  useExploreStore,
  type Anchor,
  type Cursor,
  type LiveStage,
  type PaperInfo,
} from "@/components/play/useExploreStore";
import { AskBox, SceneNav, WalkthroughProgress } from "@/components/play/WalkthroughPlayer";
import { useResumeFromUrl } from "@/components/play/useResume";
// Registers the saved-papers layer: /play/<id> in the address bar, and restoring a paper already saved.
import "@/components/play/supabasePersistence";
import { Shelf } from "@/components/play/Shelf";
import { PaywallError, SignInError, fetchSuggestions, streamDiagram, uploadPaper } from "@/lib/playClient";
import { Paywall } from "@/components/billing/Paywall";
import { UserMenu } from "@/components/auth/UserMenu";
import { AccountBadge } from "@/components/play/AccountBadge";
import { useGoogleSignIn } from "@/components/auth/googleSignIn";
import { useUser } from "@/components/auth/useUser";
import type { Suggestions } from "@/lib/playPrompts";
import type { Diagram, Explorable } from "@/lib/types";
import type { ExploreNode, Walkthrough } from "@/lib/walkthrough";
import { streamWalkthrough } from "@/lib/walkthroughClient";
import { KeyIdeas, PlainWords, SourceNote } from "@/components/play/SceneExtras";
import { useReading } from "@/components/play/useReading";
import { SelectionMenu } from "@/components/play/SelectionMenu";
import { BookmarkButton, NotesPanel } from "@/components/play/NotesPanel";
import { Discussion } from "@/components/play/Discussion";
import { usePaintHighlights } from "@/components/play/paintHighlights";
import { parsePlaceHash, type PlaceKind } from "@/lib/readingNotes";

const PaperPanel = dynamic(() => import("@/components/demo/PaperPanel"), { ssr: false });

const NUDGE_AFTER_MS = 8000;
/** A walkthrough that runs out of server time is continued this many times, this far apart. */
const MAX_RESUME_ROUNDS = 6;
const RESUME_DELAY_MS = 3000;

export default function PlayPage() {
  // Demo papers are open to everyone; uploading and asking need a signed-in user.
  // `undefined` until the session is known, so nothing renders before the client takes over.
  const user = useUser();
  const ready = user !== undefined;

  const [s, dispatch] = useExploreStore();
  const [uploading, setUploading] = useState(false);
  /** Big uploads (over 4 MB) go straight to Storage: how far along, 0–1; null otherwise. */
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [meta, setMeta] = useState<Suggestions | null>(null);
  const [suggestError, setSuggestError] = useState(false);
  const [selected, setSelected] = useState<Explorable | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);
  const [paperTarget, setPaperTarget] = useState<PaperTarget | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [nudgeFor, setNudgeFor] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallError | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [askPrefill, setAskPrefill] = useState<{ text: string; n: number } | null>(null);
  const [placeEl, setPlaceEl] = useState<HTMLElement | null>(null);
  /** A bookmark link (#at=scene:s3) waiting for its paper to load. */
  const pendingPlace = useRef<{ kind: PlaceKind; target: string } | null>(null);
  const aborts = useRef<AbortController[]>([]);
  const stateRef = useRef(s);
  useEffect(() => {
    stateRef.current = s;
  }, [s]);

  useEffect(() => () => aborts.current.forEach((a) => a.abort()), []);

  const { start: signIn } = useGoogleSignIn();
  const handleError = useCallback(
    (err: unknown): string => {
      if (err instanceof SignInError) void signIn();
      if (err instanceof PaywallError && err.reason !== "daily_cap") setPaywall(err);
      return err instanceof Error ? err.message : String(err);
    },
    [signIn],
  );

  function track() {
    const a = new AbortController();
    aborts.current.push(a);
    return a;
  }

  // ---- Upload → walkthrough + suggestions ------------------------------------

  async function onUpload(input: { file: File } | { arxiv: string }) {
    if (!ready) return;
    setUploading(true);
    setUploadError("");
    try {
      const up = await uploadPaper(input, { onProgress: setUploadProgress });
      const arxivId = "arxiv" in input ? input.arxiv.trim() : undefined;
      const paper: PaperInfo = { paperId: up.paperId, key: up.key, arxivId, name: up.name, pdfUrl: up.pdfUrl, isPublic: !!up.demo };
      dispatch({ type: "paper", paper });
      persist(() => getPersistence().onPaper?.(paper.key, paper));
      startWalkthrough(paper);

      // Demo papers come with saved suggestions (or none): no paid call.
      if (up.demo || !paper.paperId) {
        if (up.suggestions) setMeta(up.suggestions);
        else setSuggestError(true);
        return;
      }
      const abort = track();
      fetchSuggestions(paper.paperId, abort.signal)
        .then(setMeta)
        .catch((err: unknown) => {
          if (!abort.signal.aborted) {
            handleError(err);
            setSuggestError(true);
          }
        });
    } catch (err) {
      setUploadError(handleError(err));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function startWalkthrough(paper: PaperInfo) {
    const load = getPersistence().load;
    if (load) {
      const saved = await load(paper.key).catch(() => null);
      if (saved?.complete) {
        dispatch({ type: "hydrate", walkthrough: saved.walkthrough, nodes: saved.nodes });
        return;
      }
      if (saved?.nodes?.length) dispatch({ type: "hydrate", nodes: saved.nodes });
    }
    await streamScenes(paper);
  }

  /** Reopened a saved paper whose walkthrough still has scenes to draw. */
  function resumeDrawing(paper: PaperInfo) {
    void streamScenes(paper);
  }

  /**
   * Streams the walkthrough. The server saves every scene as it lands; when it runs out of
   * time it says "continue" and we call again, which draws only what's missing (no new charge).
   */
  async function streamScenes(paper: PaperInfo, round = 0) {
    const abort = track();
    let again = false;
    try {
      await streamWalkthrough({ paperId: paper.paperId, key: paper.key, signal: abort.signal }, (ev) => {
        if (ev.type === "plan") dispatch({ type: "plan", meta: ev.paper, scenes: ev.scenes, extras: { citation: ev.citation, takeaways: ev.takeaways } });
        else if (ev.type === "scene") dispatch({ type: "scene", scene: ev.scene });
        else if (ev.type === "status") dispatch({ type: "sceneStatus", id: ev.sceneId, status: ev.stage });
        else if (ev.type === "continue") again = true;
        else if (ev.type === "error") {
          if (ev.sceneId) dispatch({ type: "sceneStatus", id: ev.sceneId, status: "error", error: ev.message });
          else dispatch({ type: "walk", walk: "error", error: ev.message });
        } else if (ev.type === "done") {
          if (!again && stateRef.current.walk !== "error") dispatch({ type: "walk", walk: "done" });
        }
      });
    } catch (err) {
      if (!abort.signal.aborted) dispatch({ type: "walk", walk: "error", error: handleError(err) });
      return;
    }
    if (again && !abort.signal.aborted) {
      if (round >= MAX_RESUME_ROUNDS) dispatch({ type: "walk", walk: "error", error: "Some scenes are taking too long. Reload the page to try them again." });
      else setTimeout(() => void streamScenes(paper, round + 1), RESUME_DELAY_MS);
    }
  }

  // Reopening /play/<id>: restore the saved paper, and finish its walkthrough if scenes are missing.
  const resumeError = useResumeFromUrl(ready, s.paper !== null, dispatch, resumeDrawing);

  // /play?arxiv=<id> (from the research agent's "Explain this paper"): open that paper straight away.
  const arxivStarted = useRef(false);
  useEffect(() => {
    if (!ready || arxivStarted.current || s.paper) return;
    const id = new URLSearchParams(window.location.search).get("arxiv");
    if (!id) return;
    arxivStarted.current = true;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    void onUpload({ arxiv: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, s.paper]);

  // ---- The reader's own layer: favorite, notes, bookmarks, highlights (private) ------------

  const reading = useReading(s.paper?.paperId, !!user);
  useEffect(() => {
    pendingPlace.current = parsePlaceHash(window.location.hash);
  }, []);

  // ---- Where the reader is ---------------------------------------------------

  const scenes = s.scenes;
  const cursor = s.cursor;
  const sceneIndex = cursor?.kind === "scene" ? scenes.findIndex((sc) => sc.id === cursor.id) : -1;
  const scene = sceneIndex >= 0 ? scenes[sceneIndex] : null;
  const node = cursor?.kind === "node" ? s.nodes.find((n) => n.id === cursor.id) ?? null : null;
  const nodeScene = node ? scenes.find((sc) => sc.id === rootSceneId(s, node.id)) ?? null : null;
  const homeIndex = nodeScene ? scenes.indexOf(nodeScene) : -1;
  const current: Diagram | null = scene?.diagram ?? node?.diagram ?? null;

  const placeKind: PlaceKind | null = scene ? "scene" : node ? "node" : null;
  const placeTarget = scene?.id ?? node?.id ?? null;
  const placeMarks = reading.reading.highlights
    .filter((h) => h.kind === placeKind && h.target === placeTarget)
    .map((h) => ({ quote: h.quote, color: h.color }));
  usePaintHighlights(placeEl, placeMarks, current);

  const go = useCallback(
    (c: Cursor) => {
      dispatch({ type: "go", cursor: c });
      setSelected(null);
      setNudgeFor(null);
      setTreeOpen(false);
      requestAnimationFrame(() => document.getElementById("stage")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    },
    [dispatch],
  );

  const goScene = useCallback(
    (i: number) => {
      const sc = stateRef.current.scenes[i];
      if (sc) go({ kind: "scene", id: sc.id });
    },
    [go],
  );

  // Nudge "Next scene" once a ready scene has had time to play; any move or click resets it.
  const sceneReady = scene?.status === "ready";
  const sceneId = scene?.id ?? null;
  useEffect(() => {
    if (!sceneReady || !sceneId) return;
    const t = setTimeout(() => setNudgeFor(sceneId), NUDGE_AFTER_MS);
    return () => clearTimeout(t);
  }, [sceneId, sceneReady]);
  const nudge = nudgeFor !== null && nudgeFor === sceneId && !selected;

  // ←/→ step through scenes (not while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = stateRef.current;
      if (st.cursor?.kind !== "scene") return;
      const i = st.scenes.findIndex((sc) => sc.id === st.cursor?.id);
      if (e.key === "ArrowRight" && i < st.scenes.length - 1) goScene(i + 1);
      if (e.key === "ArrowLeft" && i > 0) goScene(i - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goScene]);

  // ---- Asking and going deeper -------------------------------------------------

  /** Draws a node's diagram. The server saves the node itself (pending, then ready or error). */
  function generate(n: ExploreNode, body: Record<string, unknown>) {
    const abort = track();
    const node = { id: n.id, kind: n.kind, title: n.title, parentId: n.parentId };
    streamDiagram("/api/play/diagram", { ...body, paperId: s.paper?.paperId, node }, (stage) => dispatch({ type: "nodeStage", id: n.id, stage }), abort.signal)
      .then((d) => dispatch({ type: "nodeReady", id: n.id, diagram: d }))
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        dispatch({ type: "nodeError", id: n.id, message: handleError(err) });
      });
  }

  function addNode(n: ExploreNode, anchor: Anchor | undefined, body: Record<string, unknown>) {
    if (!user || !s.paper?.paperId) {
      // Asking spends credits, so it needs an account; Google returns them to this page.
      void signIn();
      return;
    }
    dispatch({ type: "addNode", node: n, anchor });
    go({ kind: "node", id: n.id });
    generate(n, body);
  }

  /** A typed question, scoped to the scene or answer the reader is on. */
  function askHere(question: string) {
    if (!s.paper) return;
    const where = scene ? `scene “${scene.title}”` : node ? `the diagram “${node.diagram?.title ?? node.title}”` : "";
    const scoped = where ? `(Asked while viewing the ${where}.) ${question}` : question;
    const n: ExploreNode = {
      id: newId(),
      kind: "question",
      title: question,
      parentId: cursor?.id ?? null,
      diagram: null,
      status: "pending",
      createdAt: now(),
    };
    addNode(n, undefined, { question: scoped.slice(0, 300) });
  }

  /** A suggested question: paper-level. */
  function askSuggested(title: string) {
    if (!s.paper) return;
    const existing = s.nodes.find((n) => n.title === title);
    if (existing) return go({ kind: "node", id: existing.id });
    const sug = meta?.questions.find((q) => q.title === title);
    const n: ExploreNode = {
      id: newId(),
      kind: "suggested",
      title,
      parentId: null,
      diagram: null,
      status: "pending",
      createdAt: now(),
    };
    addNode(n, sug ? { pages: sug.pages, quote: sug.quote, label: title } : undefined, { question: title });
  }

  function onExplore(id: string) {
    const e = current?.explorables.find((x) => x.id === id);
    if (!e) return;
    setSelected(e);
    setNudgeFor(null);
    requestAnimationFrame(() =>
      document.querySelector('[aria-label="Explanation"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }

  function goDeeper(e: Explorable) {
    if (!current || !s.paper || !cursor) return;
    const id = `${current.id}/${e.id}`;
    const existing = s.nodes.find((n) => n.id === id);
    if (existing) {
      if (existing.status === "error") retryNode(existing);
      return go({ kind: "node", id });
    }
    const n: ExploreNode = { id, kind: "deeper", title: e.label, parentId: cursor.id, diagram: null, status: "pending", createdAt: now() };
    addNode(n, { pages: e.pages, quote: e.quote, label: e.label }, {
      parent: { id: current.id, title: current.title, explorable: e },
    });
  }

  function retryNode(n: ExploreNode) {
    if (!s.paper) return;
    dispatch({ type: "retryNode", id: n.id });
    if (n.kind === "deeper") {
      const parentDiagram = findDiagramFor(n.parentId);
      const eid = n.id.split("/").pop() ?? "";
      const e = parentDiagram?.explorables.find((x) => x.id === eid);
      if (parentDiagram && e) {
        generate(n, { parent: { id: parentDiagram.id, title: parentDiagram.title, explorable: e } });
        return;
      }
    }
    generate(n, { question: n.title });
  }

  function findDiagramFor(id: string | null): Diagram | null {
    if (!id) return null;
    return s.scenes.find((sc) => sc.id === id)?.diagram ?? s.nodes.find((n) => n.id === id)?.diagram ?? null;
  }

  // ---- Paper panel -------------------------------------------------------------

  function openPaper(t: PaperTarget | null) {
    setPaperTarget(t);
    setPaperOpen(true);
  }

  function stageTarget(): PaperTarget | null {
    if (scene) return { page: scene.pages[0] ?? 1, quote: scene.quote, label: scene.title };
    if (node) {
      const a = s.anchors[node.id];
      if (a) return { page: a.pages[0] ?? 1, quote: a.quote, label: a.label ?? node.title };
      const e = node.diagram?.explorables[0];
      if (e) return { page: e.pages[0] ?? 1, quote: e.quote, label: e.label };
    }
    const first = scenes[0];
    return first ? { page: first.pages[0] ?? 1, quote: first.quote, label: first.title } : null;
  }

  // ---- Places (for bookmarks, highlights and the notes panel) --------------------

  function placeName(kind: PlaceKind, target: string): string {
    if (kind === "page") return `Page ${target}`;
    if (kind === "scene") {
      const i = scenes.findIndex((sc) => sc.id === target);
      return i >= 0 ? `Scene ${i + 1}: ${scenes[i].title}` : "A scene";
    }
    const n = s.nodes.find((x) => x.id === target);
    return n ? n.diagram?.title ?? n.title : "An answer";
  }

  /** Walkthrough order: each scene, then the answers under it, then the paper's pages. */
  function placeOrder(kind: PlaceKind, target: string): number {
    if (kind === "page") return 1e6 + Number(target);
    const sceneId = kind === "scene" ? target : rootSceneId(s, target);
    const i = scenes.findIndex((sc) => sc.id === sceneId);
    return (i >= 0 ? i : 999) * 1000 + (kind === "node" ? 1 + s.nodes.findIndex((x) => x.id === target) : 0);
  }

  function goPlace(kind: PlaceKind, target: string): boolean {
    if (kind === "page") {
      openPaper({ page: Number(target) || 1, quote: "", label: `Page ${target}` });
      return true;
    }
    if (kind === "scene" ? scenes.some((sc) => sc.id === target) : s.nodes.some((n) => n.id === target)) {
      go({ kind, id: target });
      return true;
    }
    return false;
  }

  // Opened from a bookmark link: go there once that place has loaded.
  useEffect(() => {
    const p = pendingPlace.current;
    if (!p || !s.paper) return;
    if (goPlace(p.kind, p.target)) {
      pendingPlace.current = null;
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  });

  const placeLabel = scene ? `Scene ${sceneIndex + 1}: ${scene.title}` : node ? node.diagram?.title ?? node.title : "";
  const bookmarkHere =
    reading.enabled && placeKind && placeTarget ? (
      <BookmarkButton
        what={placeKind === "scene" ? "scene" : "answer"}
        on={!!reading.bookmarkFor(placeKind, placeTarget)}
        onToggle={() => void reading.toggleBookmark(placeKind, placeTarget, placeLabel)}
      />
    ) : null;

  // ---- Stage props -------------------------------------------------------------

  let deeper: DeeperStatus = { kind: "none" };
  if (selected && current) {
    const e = selected;
    const existing = s.nodes.find((n) => n.id === `${current.id}/${e.id}`);
    if (existing?.status === "error") deeper = { kind: "error", message: s.errors[existing.id] ?? "That didn’t work.", onRetry: () => goDeeper(e) };
    else if (existing) deeper = { kind: "available", onGo: () => goDeeper(e) };
    else deeper = { kind: "needs-code", onGo: () => goDeeper(e) };
  }

  const lineage = node ? nodeLineage(s, node.id) : [];
  const crumbs: Crumb[] = [];
  if (scene) crumbs.push({ key: scene.id, label: `Scene ${sceneIndex + 1}` });
  if (node) {
    if (nodeScene) crumbs.push({ key: nodeScene.id, label: `Scene ${homeIndex + 1}` });
    for (const n of lineage) crumbs.push({ key: n.id, label: short(n.title) });
  }
  function navigateCrumb(i: number) {
    const c = crumbs[i];
    if (!c) return;
    if (scenes.some((sc) => sc.id === c.key)) go({ kind: "scene", id: c.key });
    else go({ kind: "node", id: c.key });
  }

  const walkLoading = s.walk === "planning" || s.walk === "streaming";
  const askContext = scene ? `scene ${sceneIndex + 1}` : node ? "this answer" : "the paper";
  const title = s.meta?.title ?? meta?.title ?? s.paper?.name ?? "";

  const takeaways = s.extras.takeaways ?? [];
  const lastIndex = scenes.length - 1;
  const showKeyIdeas = () => {
    goScene(lastIndex);
    setTimeout(() => document.getElementById("key-ideas")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };
  const sceneLabelFor = (id: string) => {
    const i = scenes.findIndex((sc) => sc.id === id);
    return i >= 0 ? `scene ${i + 1}` : null;
  };

  const tree = (
    <QuestionTree
      onKeyIdeas={takeaways.length && scenes.length ? showKeyIdeas : undefined}
      scenes={scenes}
      nodes={s.nodes}
      cursor={cursor}
      onGo={go}
      suggestions={meta?.questions ?? null}
      suggestError={suggestError}
      onSuggest={askSuggested}
      walkLoading={walkLoading}
    />
  );

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-serif text-lg text-ink">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            {/* Phones with a paper open need the room for its buttons. */}
            <span className={s.paper ? "max-sm:sr-only" : undefined}>{PRODUCT_NAME}</span>
          </Link>
          {s.paper && (
            <span className="hidden min-w-0 truncate rounded-full border border-line px-3 py-1 text-sm text-ink-2 md:block">
              {title}
              {s.meta?.authors ? ` · ${s.meta.authors}` : ""}
              {s.meta?.year ? ` ${s.meta.year}` : ""}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {s.paper && (
              <>
                <button
                  type="button"
                  onClick={() => setTreeOpen(true)}
                  className="btn-secondary h-9 px-3 text-sm lg:hidden"
                  aria-expanded={treeOpen}
                  aria-controls="question-drawer"
                >
                  Questions{s.nodes.length ? ` · ${s.nodes.length}` : ""}
                </button>
                {reading.enabled && (
                  <>
                    <button
                      type="button"
                      onClick={reading.toggleFavorite}
                      aria-pressed={reading.reading.favorite}
                      aria-label={reading.reading.favorite ? "Remove from favorites" : "Add to favorites"}
                      title={reading.reading.favorite ? "In your favorites" : "Favorite"}
                      className={`hidden size-9 place-items-center rounded-md hover:bg-paper-2 sm:grid ${reading.reading.favorite ? "text-accent" : "text-ink-3 hover:text-ink"}`}
                    >
                      <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                        <path
                          d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
                          fill={reading.reading.favorite ? "currentColor" : "none"}
                          stroke="currentColor"
                          strokeWidth={1.3}
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button type="button" onClick={() => setNotesOpen(true)} aria-label="Notes" className="btn-secondary h-9 px-2.5 text-sm sm:px-3">
                      <svg viewBox="0 0 16 16" className="size-4 sm:hidden" aria-hidden="true">
                        <path d="M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
                      </svg>
                      <span className="hidden sm:inline">Notes</span>
                      {reading.reading.highlights.length + reading.reading.bookmarks.length > 0 && (
                        <span className="ml-1.5 hidden text-ink-3 sm:inline">{reading.reading.highlights.length + reading.reading.bookmarks.length}</span>
                      )}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    aborts.current.forEach((a) => a.abort());
                    aborts.current = [];
                    dispatch({ type: "reset" });
                    setMeta(null);
                    setSuggestError(false);
                    setSelected(null);
                  }}
                  className="hidden rounded-md px-2 py-1 text-sm text-ink-3 hover:text-ink sm:block"
                >
                  New paper
                </button>
                <button type="button" onClick={() => openPaper(stageTarget())} className="btn-secondary h-9 px-3.5 text-sm">
                  <span className="sm:hidden">Paper</span>
                  <span className="hidden sm:inline">Read the paper</span>
                </button>
              </>
            )}
            {!s.paper && (
              <Link href="/library" className="hidden rounded-md px-2 py-1 text-sm text-ink-3 hover:text-ink sm:block">
                Library
              </Link>
            )}
            <AccountBadge refresh={s.paper?.paperId} />
            <UserMenu />
          </div>
        </div>
      </header>

      {!ready ? null : !s.paper ? (
        <>
          <UploadScreen onUpload={onUpload} busy={uploading} progress={uploadProgress} error={uploadError || resumeError} signedIn={!!user} />
          {user && <Shelf />}
        </>
      ) : (
        <main data-no-floater="phone" className="mx-auto grid max-w-[1360px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10 lg:py-8">
          <aside className="hidden min-w-0 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
            {tree}
          </aside>

          <div id="stage" className="min-w-0 scroll-mt-20 space-y-4">
            {scenes.length > 0 && (
              <WalkthroughProgress
                scenes={scenes}
                current={scene ? sceneIndex : homeIndex}
                onGo={goScene}
              />
            )}

            {scene ? (
              <div ref={setPlaceEl} data-place-kind="scene" data-place-target={scene.id} className="min-w-0 space-y-4">
                <SceneHeader
                  action={bookmarkHere}
                  index={sceneIndex}
                  total={scenes.length}
                  stage={STAGE_LABEL[scene.stage] ?? scene.stage}
                  title={scene.title}
                  narration={scene.narration}
                  explanation={scene.explanation}
                  kind={scene.kind}
                />
                {scene.diagram ? (
                  <DiagramStage
                    crumbs={crumbs}
                    onNavigate={navigateCrumb}
                    diagram={scene.diagram}
                    onExplore={onExplore}
                    onShowInPaper={() => openPaper(stageTarget())}
                    selected={selected}
                    onOpenSelectedInPaper={() =>
                      selected && openPaper({ page: selected.pages[0] ?? 1, quote: selected.quote, label: selected.label })
                    }
                    deeper={deeper}
                  />
                ) : (
                  <PendingCard
                    eyebrow={`Scene ${sceneIndex + 1}`}
                    title={scene.title}
                    stage={scene.status === "pending" ? "reading" : scene.status === "error" || scene.status === "ready" ? "drawing" : scene.status}
                    error={scene.status === "error" ? scene.error ?? "This scene couldn’t be drawn." : undefined}
                    note="Claude is drawing this scene. You can read the others meanwhile."
                  />
                )}
                {(scene.section || scene.quote) && (
                  <SourceNote section={scene.section} pages={scene.pages} quote={scene.quote} onShow={() => openPaper(stageTarget())} />
                )}
                <SceneNav
                  index={sceneIndex}
                  total={scenes.length}
                  onBack={() => goScene(sceneIndex - 1)}
                  onNext={() => goScene(sceneIndex + 1)}
                  nudge={nudge}
                />
                {sceneIndex === lastIndex && takeaways.length > 0 && (
                  <KeyIdeas takeaways={takeaways} sceneLabel={sceneLabelFor} onTry={(id) => go({ kind: "scene", id })} citation={s.extras.citation} />
                )}
              </div>
            ) : node ? (
              <div ref={setPlaceEl} data-place-kind="node" data-place-target={node.id} className="min-w-0 space-y-4">
                <ReturnBar
                  action={bookmarkHere}
                  sceneLabel={nodeScene ? `Scene ${homeIndex + 1}: ${nodeScene.title}` : null}
                  onBack={() => (nodeScene ? go({ kind: "scene", id: nodeScene.id }) : scenes[0] && goScene(0))}
                  onContinue={
                    homeIndex >= 0 && homeIndex < scenes.length - 1 ? () => goScene(homeIndex + 1) : scenes.length && homeIndex < 0 ? () => goScene(0) : null
                  }
                />
                {node.diagram ? (
                  <DiagramStage
                    crumbs={crumbs}
                    onNavigate={navigateCrumb}
                    diagram={node.diagram}
                    onExplore={onExplore}
                    onShowInPaper={() => openPaper(stageTarget())}
                    selected={selected}
                    onOpenSelectedInPaper={() =>
                      selected && openPaper({ page: selected.pages[0] ?? 1, quote: selected.quote, label: selected.label })
                    }
                    deeper={deeper}
                  />
                ) : (
                  <PendingCard
                    eyebrow={node.kind === "deeper" ? "Going deeper" : "Your question"}
                    title={node.title}
                    stage={s.stages[node.id] ?? "reading"}
                    error={node.status === "error" ? s.errors[node.id] ?? "That didn’t work." : undefined}
                    onRetry={() => retryNode(node)}
                    note="Takes about two minutes. Keep exploring; it will appear in the list on the left."
                  />
                )}
              </div>
            ) : s.walk === "error" ? (
              <PendingCard eyebrow="Walkthrough" title="Couldn’t explain this paper" stage="reading" error={s.walkError ?? "Something went wrong."} />
            ) : (
              <PendingCard
                eyebrow="Explaining the paper first"
                title={title || "Reading the paper"}
                stage="reading"
                note="Claude is reading the whole paper and planning the walkthrough."
              />
            )}

            <AskBox context={askContext} onAsk={askHere} prefill={askPrefill} />

            {s.paper.isPublic && s.paper.paperId && (
              <Discussion
                paperId={s.paper.paperId}
                sceneId={scene?.id ?? nodeScene?.id ?? null}
                sceneLabel={sceneLabelFor}
                onGoScene={(id) => go({ kind: "scene", id })}
                signedIn={!!user}
                onSignIn={() => void signIn()}
              />
            )}
          </div>
        </main>
      )}

      {/* Mobile drawer for the question tree */}
      {s.paper && treeOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Questions" id="question-drawer">
          <button type="button" aria-label="Close" onClick={() => setTreeOpen(false)} className="absolute inset-0 bg-ink/30" />
          <div className="absolute inset-y-0 left-0 w-[86%] max-w-[340px] overflow-y-auto bg-white px-4 py-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-serif text-lg text-ink">Questions</span>
              <button type="button" onClick={() => setTreeOpen(false)} className="rounded-md px-2 py-1 text-sm text-ink-3 hover:text-ink">
                Close
              </button>
            </div>
            {tree}
          </div>
        </div>
      )}

      {reading.enabled && (
        <SelectionMenu
          onHighlight={(p, color, note) => void reading.addHighlight({ ...p, color, note })}
          onAsk={(p) => {
            setPaperOpen(false);
            setAskPrefill({ text: `About “${p.quote.length > 160 ? `${p.quote.slice(0, 157)}…` : p.quote}”: `, n: Date.now() });
          }}
        />
      )}
      {reading.error && (
        <div role="alert" className="fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-md items-start gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-2 shadow-lg">
          <span className="min-w-0 flex-1">{reading.error}</span>
          <button type="button" onClick={reading.clearError} className="shrink-0 text-ink-3 hover:text-ink">
            Dismiss
          </button>
        </div>
      )}
      {notesOpen && reading.enabled && (
        <NotesPanel
          reading={reading}
          title={title}
          authors={s.meta?.authors}
          year={s.meta?.year}
          placeName={placeName}
          placeOrder={placeOrder}
          onGo={(k, t) => void goPlace(k, t)}
          onClose={() => setNotesOpen(false)}
        />
      )}

      {paywall && paywall.reason !== "daily_cap" && (
        <Paywall allowance={paywall.allowance} plan={paywall.plan} reason={paywall.reason} onClose={() => setPaywall(null)} />
      )}

      {s.paper && (
        <PaperPanel
          open={paperOpen}
          onClose={() => setPaperOpen(false)}
          pdfUrl={s.paper.pdfUrl}
          title={title}
          target={paperTarget}
          reading={
            reading.enabled
              ? {
                  highlights: reading.reading.highlights.filter((h) => h.kind === "page"),
                  isBookmarked: (page) => !!reading.bookmarkFor("page", String(page)),
                  toggleBookmark: (page) => void reading.toggleBookmark("page", String(page), `Page ${page}`),
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function now() {
  return Date.now();
}

function newId() {
  return `q-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function short(t: string) {
  return t.length > 32 ? `${t.slice(0, 30)}…` : t;
}

const KIND_BADGE: Record<string, string> = { figure: "Figure remake", equation: "Equation" };

function SceneHeader({
  action,
  index,
  total,
  stage,
  title,
  narration,
  explanation,
  kind,
}: {
  action?: React.ReactNode;
  index: number;
  total: number;
  stage: string;
  title: string;
  narration: string;
  explanation?: string;
  kind?: string;
}) {
  const badge = kind ? KIND_BADGE[kind] : undefined;
  return (
    <div className="min-w-0 px-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium tracking-[0.08em] text-ink-3 uppercase">
        <span>
          Scene {index + 1} of {total} · <span className="text-accent">{stage}</span>
        </span>
        {badge && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 tracking-normal normal-case text-accent-hover">{badge}</span>
        )}
      </p>
      <div className="mt-1 flex items-start gap-2">
        <h2 className="min-w-0 flex-1 font-serif text-2xl leading-snug tracking-[-0.01em] text-ink sm:text-3xl">{title}</h2>
        {action}
      </div>
      {narration && <p className="mt-2 max-w-prose text-[16px] leading-relaxed text-ink-2">{narration}</p>}
      {explanation && <PlainWords text={explanation} />}
    </div>
  );
}

function ReturnBar({
  action,
  sceneLabel,
  onBack,
  onContinue,
}: {
  action?: React.ReactNode;
  sceneLabel: string | null;
  onBack: () => void;
  onContinue: (() => void) | null;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-paper-2 px-3 py-2">
      <button type="button" onClick={onBack} className="min-w-0 truncate rounded-md px-2 py-1 text-left text-sm text-ink-2 hover:text-ink">
        ↩ Back to {sceneLabel ?? "the walkthrough"}
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {action}
        {onContinue && (
          <button type="button" onClick={onContinue} className="btn-secondary h-8 shrink-0 px-3 text-sm">
            Continue walkthrough →
          </button>
        )}
      </div>
    </div>
  );
}

function PendingCard({
  eyebrow,
  title,
  stage,
  error,
  onRetry,
  note,
}: {
  eyebrow: string;
  title: string;
  stage: LiveStage;
  error?: string;
  onRetry?: () => void;
  note?: string;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white px-5 py-6 shadow-[0_1px_0_var(--color-line),0_24px_48px_-36px_rgb(26_25_23/0.22)] sm:px-8 sm:py-7">
      <p className="text-sm text-ink-3">{eyebrow}</p>
      <h1 className="mt-1 font-serif text-2xl leading-snug tracking-[-0.01em] text-ink sm:text-[28px]">{title}</h1>
      {error ? (
        <div role="alert" className="mt-6 flex min-h-[260px] flex-col items-center justify-center rounded-xl bg-paper-2 px-6 py-10 text-center">
          <p className="text-[15px] text-ink-2">{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn-secondary mt-4 h-9 px-4 text-sm">
              Try again
            </button>
          )}
        </div>
      ) : (
        <div className="mt-6 flex min-h-[340px] flex-col items-center justify-center rounded-xl bg-paper-2 px-4 py-10">
          <AgentsWorking stage={stage} />
          {note && <p className="mt-6 max-w-sm text-center text-sm text-ink-3">{note}</p>}
        </div>
      )}
    </section>
  );
}
