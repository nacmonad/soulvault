import { ImageResponse } from "next/og";

import { site } from "@/lib/site";

export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The mark is inlined rather than imported from `brand/logo.tsx`: Satori
 * renders a restricted subset of SVG, and this variant is pre-coloured for a
 * dark card (`currentColor` has no meaning here). Keep the two paths in sync.
 */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none"><path d="M128 20C154 40 185 48 218 54V116C218 174 182 216 128 238C74 216 38 174 38 116V54C71 48 102 40 128 20Z" stroke="#A5B4FC" stroke-width="14" stroke-linejoin="round"/><path d="M78 104L111 78L145 112L180 76M111 78L124 158M145 112L124 158L170 164" stroke="#A5B4FC" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><g fill="#A5B4FC"><circle cx="78" cy="104" r="10"/><circle cx="111" cy="78" r="10"/><circle cx="145" cy="112" r="10"/><circle cx="180" cy="76" r="10"/><circle cx="124" cy="158" r="10"/><circle cx="170" cy="164" r="10"/></g></svg>`;

const markSrc = `data:image/svg+xml;base64,${Buffer.from(MARK).toString("base64")}`;

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0B0F1F",
        color: "#F8FAFC",
        padding: 72,
        // A single hairline rule of brand colour along the top edge, matching
        // the flat, bordered language of the site itself.
        borderTop: "8px solid #4F46E5",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <img src={markSrc} width={72} height={72} alt="" />
        <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>
          {site.name}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Satori has no <br/>, and requires an explicit display on any node
            with more than one child, so the headline is stacked by hand. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 68,
            fontWeight: 600,
            letterSpacing: -2,
            lineHeight: 1.15,
          }}
        >
          <div>Coordinate securely.</div>
          <div style={{ color: "#A5B4FC" }}>Collaborate privately.</div>
        </div>
        <div style={{ fontSize: 26, color: "#94A3B8", maxWidth: 900 }}>
          Encrypted continuity for agent swarms, and wallet-authorized selective
          disclosure for confidential documents.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          fontSize: 20,
          color: "#64748B",
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        0G Galileo + Sepolia · MIT
      </div>
    </div>,
    size,
  );
}
