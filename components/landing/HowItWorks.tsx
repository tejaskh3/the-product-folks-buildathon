import { DrawOnView } from "./DrawOnView";
import { AgentsIllustration, PlayIllustration, UploadIllustration } from "./StepIllustrations";

const STEPS = [
  {
    title: "Upload",
    body: "Drop in the PDF of a research paper or a whole book. It stays open beside everything you make from it.",
    art: <UploadIllustration />,
  },
  {
    title: "Agents find the questions",
    body: "Claude reads the whole thing, then a small team of agents each chase one question the text raises but never draws.",
    art: <AgentsIllustration />,
  },
  {
    title: "Play with diagrams",
    body: "Every question comes back as a live diagram. Drag, click and change the numbers until the idea makes sense.",
    art: <PlayIllustration />,
  },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-8 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <h2 id="how-title" className="max-w-xl font-serif text-4xl leading-tight tracking-[-0.02em] text-ink sm:text-5xl">
          How it works
        </h2>
        <ol className="mt-12 grid gap-12 md:mt-16 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <DrawOnView className="rounded-2xl border border-line px-6 py-8">{step.art}</DrawOnView>
              <div className="mt-6 flex gap-4">
                <span className="font-serif text-2xl leading-none text-ink-3" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-lg font-medium text-ink">{step.title}</h3>
                  <p className="mt-2 leading-relaxed text-ink-2">{step.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
