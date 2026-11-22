// Clerk reads and refreshes the session on every request. Pages stay public (the landing
// page, /demo and the demo papers); API routes check `auth()` themselves.
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals, static files and the bundled demo assets.
    "/((?!_next|demo/|icon.svg|pdf.worker.min.mjs|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|pdf|json|mjs)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
