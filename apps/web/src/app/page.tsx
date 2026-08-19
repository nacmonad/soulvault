import { Capabilities } from "@/components/landing/capabilities";
import { Cta } from "@/components/landing/cta";
import { Demo } from "@/components/landing/demo";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";

export default function Home() {
  return (
    <>
      <Hero />
      <Capabilities />
      <HowItWorks />
      <Demo />
      <Cta />
    </>
  );
}
