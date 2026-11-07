import { JetBrains_Mono, Oxanium } from "next/font/google";
import CommandDeck from "./command-deck.tsx";

const displayFont = Oxanium({ subsets: ["latin"], variable: "--font-deck-display" });
const monoFont = JetBrains_Mono({ subsets: ["latin"], variable: "--font-deck-mono" });

export default function HomePage() {
  return (
    // translate="no": browser auto-translate rewrites engine identifiers (SURGE, 0% Skim, SOLAR_ARRAY) into words that no longer match the receipts.
    <main translate="no" className={`deck-root ${displayFont.variable} ${monoFont.variable}`}>
      <CommandDeck />
    </main>
  );
}
