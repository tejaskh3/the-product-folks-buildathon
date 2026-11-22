// Runs once before the browser tests: fetches Clerk's testing token (skips bot protection) and
// makes sure the test user exists in the Clerk *development* instance. Refuses a live key.
import { createClerkClient } from "@clerk/backend";
import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { E2E_EMAIL } from "./fakeApi";

setup("clerk test user", async () => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey?.startsWith("sk_test_")) throw new Error("Browser tests need a Clerk development secret key (sk_test_…) in .env.local.");
  await clerkSetup();
  const clerk = createClerkClient({ secretKey });
  const { data } = await clerk.users.getUserList({ emailAddress: [E2E_EMAIL] });
  if (!data.length) await clerk.users.createUser({ emailAddress: [E2E_EMAIL], firstName: "Curio", lastName: "E2E", skipPasswordRequirement: true });
});
