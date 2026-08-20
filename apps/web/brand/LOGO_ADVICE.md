# SoulVault Logo Generation Brief

> **Status: resolved — 2026-08-20.** The mark shipped is the **Constellation
> Shield**: `assets/soulvault-mark.svg`, inlined as `LogoMark` in
> [`../src/components/brand/logo.tsx`](../src/components/brand/logo.tsx).
>
> It **deliberately overrides the "no shields" constraint below.** The shield
> was kept because it is self-describing: a boundary holding a swarm reads as
> what the product does, where an abstract nested-rectangle mark would have
> needed a caption. Everything else in this brief held — the mark is flat,
> monochrome, single-weight, squared-cornered, gradient-free, and drawn from
> pure geometry, which is what separates it from the April hackathon shield.
>
> The rest of this file is kept as the record of the brief that produced it.
> If you regenerate, read the resolution note before the constraints.

For generating a beautiful, minimal SVG logo using an AI image model.

## Brand Context

**SoulVault** is infrastructure for agent swarm continuity and selective document disclosure. Not a consumer product. The brand voice is "architect-grade, not marketing." Think PostgreSQL, Kubernetes, Stripe — precision over friendliness.

**Tagline:** Coordinate securely. Collaborate privately.

**Core concepts:**
- Encrypted continuity across ephemeral sessions
- Selective disclosure: redaction at source, hydration by authorization
- Cryptographic primitives (secp256k1 ECDH, AES-256-GCM)
- Swarm coordination, membership governance

## Visual Direction

### What the logo should feel like

Geometric construction. Mathematical. Intentional, not organic. The logo should convey that this is engineered properly. If a developer or legal professional saw it without the name, they should think "this is infrastructure."

### What to do

- **Geometric forms only.** Squares, rectangles, circles, lines, chevrons, interlocking shapes.
- **Consistent stroke weight** — no modulated strokes or varying thickness to suggest depth.
- **Negative space is functional.** Use it to create meaning, not ornament.
- **Minimal,** but not empty. Suggest "vault," "continuity," "encryption," or "coordination" through pure geometry.
- **Monochromatic.** Design in black/white; color fills in via CSS variables at runtime.
- **Squared corners only.** No rounded corners — that signals "approachable startup," not "infrastructure."
- **Works at 16px–256px.** Test legibility at favicon size (16px solid), header size (32px), and print scale (256px+).

### What NOT to do

- **No lock icons.** Every security product uses them. Overused cliché.
- ~~**No shields.**~~ *Overridden — see the resolution note at the top.* The
  cliché is the *glowing* shield with a padlock in it. A flat single-weight
  shield outline used as a boundary, with the swarm drawn inside it, carries
  actual meaning rather than borrowed "protected by X" symbolism.
- **No gradients or shadows.** Those signal consumer-product depth. SoulVault should feel flat and structural.
- **No blockchain tropes.** No chain links, coins, circuit boards, nodes connected by lines.
- **No mascots, characters, or illustrations.**
- **No hand-drawn or script letterforms.**
- **No rounded, friendly sans-serifs** in accompanying wordmark (that's Inter, handled separately).

## Specific Concepts to Consider

### Option 1: Redaction & Hydration
The core flow is: **redact** (locally) → **encrypt** → **send** → **hydrate** (by wallet). A logo could hint at this as a cycle or progression of shapes.

Example language: concentric shapes revealing an inner layer only after decryption; nested rectangles suggesting "layers only the right key can open."

### Option 2: Swarm Coordination
Agents coordinating across ephemeral sessions, shared encrypted state. A logo could suggest membership, continuity, or shared structure.

Example language: interlocking geometric forms; a central axis with symmetry; orbits or membership paths converging.

### Option 3: Vault / Containment
"SoulVault" implies a place where souls (agent continuity, swarm memory) are safely kept. Not a physical strongbox, but a mathematical boundary.

Example language: an abstract enclosure (not a shield); nested boundaries; a frame containing a compressed or abstracted data representation.

## Color Specification

**Primary: Indigo**
- Hex: `#4F46E5`
- oklch: `oklch(0.5106 0.2301 276.97)`

Keep the logo black or white (neutral). The indigo fills in at render time via CSS.

## SVG Requirements

- **Format:** Minified SVG, under 2KB ideal (under 5KB acceptable).
- **ViewBox:** `0 0 256 256` (square, 1:1 ratio).
- **Stroke:** Use `stroke-width="2"` or `"4"` for thin, clean lines at standard scales. Test at 16px to confirm legibility.
- **Fills:** Black fill or strokes only; color applied at runtime.
- **No nested groups** unless necessary for animation; flatten where possible.
- **No filters, masks, or complex effects** — keep it structural and renderable at any size.

## References from Design Thinking

**Stripe** (wordmark + accent)
- Geometric construction; tight letterforms
- The accent mark (the vertical line) adds meaning without being decorative
- Identity feels earned and precise, not designed
- Works at any size without losing character

**Intercom** (geometric mark + wordmark)
- The accompanying mark: simple, constructed form (rounded square with internal structure)
- Works independently and reinforces the wordmark
- Feels like infrastructure, not a consumer app

**Figma** (icon)
- Pure geometric construction — nested rectangles
- Reductive, not ornamental
- Icon alone communicates the brand; doesn't need decoration

## Specifications for the Model

When prompting an AI image model, include:

```
Generate a minimalist SVG logo for SoulVault, an infrastructure platform 
for encrypted agent swarm coordination.

Style: Geometric, architectural, constructed — not organic or hand-drawn.
Think Stripe, Intercom, Figma visual language.

Visual cues: The logo should suggest "vault," "continuity," "encryption," 
or "coordination" through pure geometry. Nested rectangles, interlocking 
shapes, or progressive revelation are possible directions.

Constraints:
- Geometric forms only (squares, rectangles, circles, lines)
- Consistent stroke weight, no gradients or shadows
- Squared corners only, no rounded corners
- Monochromatic (black or white)
- Works at 16px to 256px
- No lock icons, blockchain tropes, mascots, or illustrations
- Flat, structural feel — precision over friendliness

Output: Minified SVG, under 2KB, viewBox="0 0 256 256", square 1:1 ratio.
```

## Next Steps

All done, for the record:

1. ~~Generate SVG using the prompt above.~~
2. ~~Test at 16px (favicon), 32px (header), and 256px (print/hero).~~
3. ~~Verify stroke weight and negative space read clearly at all sizes.~~
4. ~~Extract the minified SVG and save it.~~ Lives at
   [`../../../assets/soulvault-mark.svg`](../../../assets/soulvault-mark.svg)
   (indigo-filled, for the README), with a solid-fill favicon variant at
   [`../src/app/icon.svg`](../src/app/icon.svg).
5. ~~Update `Logo.tsx`.~~ `LogoMark` inlines the paths as JSX and strokes with
   `currentColor`, so it inherits the theme instead of shipping two files. The
   two standalone SVGs and the Satori copy in `app/opengraph-image.tsx` are
   hand-synced duplicates — change one, change all four.
6. ~~Verify light and dark.~~ `currentColor` + `text-primary` covers it; no
   `prefers-color-scheme` override was needed.

## Historical Context

The preliminary logo from the April hackathon slides is a shield with a glowing
network inside — good as a hero image, wrong as a mark: the gradient, the glow,
and the rendered depth all signal consumer product, and none of it survives at
16px. The Constellation Shield is that idea reduced to geometry — the same
"swarm inside a boundary" story, drawn in one stroke weight with no fills, no
depth, and no light source. Keeping the silhouette was the point; keeping the
render was not.
