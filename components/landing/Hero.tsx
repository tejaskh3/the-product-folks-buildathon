import Link from "next/link";
import { HeroScene } from "./HeroScene";
import { TRY_URL } from "./site";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mx-auto max-w-6xl px-4 pt-16 pb-14 sm:px-6 sm:pt-24 md:pb-20">
      <div className="grid gap-8 md:grid-cols-12 md:items-end md:gap-10">
        <h1 id="hero-title" className="font-serif text-[2.9rem] leading-[1.02] tracking-[-0.025em] text-ink sm:text-7xl md:col-span-7 lg:text-[5.4rem]">
          Read papers by playing with them.
        </h1>
        <div className="md:col-span-5 md:pb-2">
          <p className="max-w-md text-lg leading-relaxed text-ink-2">
            Upload a paper or a book. Claude finds the questions worth asking and turns each one into a diagram you can
            click, drag and pull apart, with the original open beside it.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href={TRY_URL} className="btn-primary h-11 px-5">
              Try the demo →
            </a>
            <Link href="/play" className="btn-secondary h-11 px-5">
              Upload your paper
            </Link>
          </div>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-2">
            Tell Curio your topics and it keeps you on the cutting edge: the
            newest research, notifications and a spoken briefing.{" "}
            <Link href="/research" className="text-accent-hover underline underline-offset-2">
              Try the research agent
            </Link>{" "}
            ·{" "}
            <Link href="/for-you" className="text-accent-hover underline underline-offset-2">
              Set up your feed
            </Link>
          </p>
        </div>
      </div>

      <div className="mt-14 border-t border-line pt-10 md:mt-20 md:pt-12">
        <HeroScene />
      </div>
    </section>
  );
}
