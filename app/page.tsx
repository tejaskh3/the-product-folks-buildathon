import { Example } from "@/components/landing/Example";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Nav } from "@/components/landing/Nav";
import { PaperVsCurio } from "@/components/landing/PaperVsCurio";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="top" className="overflow-x-clip">
        <Hero />
        <HowItWorks />
        <PaperVsCurio />
        <Example />
      </main>
      <Footer />
    </>
  );
}
