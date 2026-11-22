// Sign-in check for /play routes. Kept apart from playServer so the offline
// generation scripts never import Clerk.
import { currentUser, type SignedInUser } from "./auth";
import { json } from "./playServer";

export const signInRequired = () => json(401, "Sign in to upload papers and ask questions.");

/** The signed-in user, or a 401 response for routes that spend model credits or save data. */
export async function requireUser(): Promise<SignedInUser | Response> {
  return (await currentUser()) ?? signInRequired();
}
