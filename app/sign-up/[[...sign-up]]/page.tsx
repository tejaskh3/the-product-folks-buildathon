import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { PRODUCT_NAME } from "@/components/landing/site";

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-16">
      <Link href="/" className="font-serif text-2xl text-ink">
        {PRODUCT_NAME}
      </Link>
      <SignUp />
    </main>
  );
}
