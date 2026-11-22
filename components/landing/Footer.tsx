import { PRODUCT_NAME } from "./site";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-serif text-base text-ink">{PRODUCT_NAME}</span>
          <span className="ml-3">Built with Claude</span>
        </p>
        <div className="flex gap-6">
          <a href="#how" className="rounded-md hover:text-ink">
            How it works
          </a>
          <a href="/library" className="rounded-md hover:text-ink">
            Library
          </a>
          <a href="/pricing" className="rounded-md hover:text-ink">
            Pricing
          </a>
        </div>
      </div>
    </footer>
  );
}
