import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

// Clerk's sign-in, sign-up and user menu, dressed in the site's tokens.
export const clerkAppearance: Appearance = {
  // Hide the "Development mode" badge while we run on Clerk's development instance.
  // Remove once the production instance (getcurio.world) is live.
  options: { unsafe_disableDevelopmentModeWarnings: true },
  variables: {
    colorPrimary: "#e5702f",
    colorForeground: "#1a1917",
    colorBackground: "#ffffff",
    borderRadius: "0.75rem",
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  },
  elements: {
    headerTitle: { fontFamily: "var(--font-fraunces), Georgia, serif", fontWeight: 400, fontSize: "1.5rem" },
    card: { boxShadow: "0 1px 0 #ece9e4, 0 24px 48px -32px rgb(26 25 23 / 0.25)", border: "1px solid #ece9e4" },
  },
};
