# SoulVault Visual Identity Brief

*Infrastructure-grade privacy. Authority without hype.*

---

## 01 — IDENTITY STRATEGY STATEMENT

SoulVault's visual identity must embody architectural precision and decentralized authority. The brand is architect-grade infrastructure, not a friendly startup—precision matters because the audience (AI systems architects, security-conscious professionals, developers) makes trust decisions based on clarity and specificity. Every visual choice should feel constructed, intentional, and grounded in first principles. The aesthetic is closer to PostgreSQL or Kubernetes than to consumer SaaS: cool, minimal, no decorative elements. The identity reinforces the positioning that this is not a marketing product; it's infrastructure that happens to be beautiful because beauty comes from elegant engineering.

---

## 02 — LOGO DIRECTION

**Primary Direction**
Wordmark + optional icon system. The wordmark is the primary mark (SoulVault as logotype). An optional accompanying icon can represent the core concepts (continuity, encryption, vault/security) but the wordmark should stand alone confidently.

**Character**
Authority and precision. The mark should feel constructed and mathematical, not organic or hand-drawn. It should convey trustworthiness through geometric clarity, not through friendliness. When a developer or legal professional sees this mark, they should think "this is engineered properly."

**Style Notes**
- Geometric construction; all curves and angles should be intentional
- Letterforms should have consistent stroke weight (not modulated)
- Minimal decoration; negative space is used functionally, not ornamentally
- No rounded corners that signal "approachable startup"
- If an icon accompanies it, use simple geometric forms: interlocking shapes, concentric circles, linear encryption metaphors

**What to Avoid**
- Hand-drawn or script letterforms (signals playfulness, not authority)
- Gradients or shadows (signals depth and modernity in a consumer way; SoulVault should feel flat and structural)
- Blockchain/crypto visual clichés (chain links, coins, circuit boards)
- Mascots, characters, or illustrative elements
- Any derivative of a lock icon (overused in security/privacy)
- Rounded sans-serifs that soften the mark (Rounded Gotham, Circular, etc.)

**Logo References**

**Stripe** (wordmark + accent)
Borrow: Geometric construction, tight letterforms, use of an accent mark (the vertical line) that adds meaning without being decorative. Stripe's identity feels earned and precise, not designed. The wordmark works at any size without losing character.

**Intercom** (geometric mark + wordmark)
Borrow: The accompanying geometric mark uses a simple, constructed form (rounded square with internal structure) that works independently but also reinforces the wordmark. Feels like infrastructure, not a consumer app. Neutral color choice strengthens that impression.

**Figma** (geometric icon)
Borrow: The icon is pure geometric construction—nested rectangles that suggest layering and composition. It's reductive, not ornamental. The icon alone communicates the brand; it doesn't need a mascot or decorative flourish to stand on its own.

---

## 03 — COLOR PALETTE

**Primary Color: Indigo**
- **Hex:** `#4F46E5` — light mode. Dark-mode primary is `#A5B4FC`; a solid fill dark enough for white text stops being legible against a dark ground, so the role inverts rather than the hue.
- **Rationale:** Indigo reads cool, serious, and technical without landing in the two crowded rooms next door. Plain SaaS blue (`#0052CC`-ish) is the single most occupied space in developer tooling — Stripe, Linear, Vercel, and a hundred imitators. Teal was the first choice here and was dropped for a more specific reason: [presidio-web](https://github.com/nacmonad/presidio-web) already owns it, and the two products appear side by side constantly — in the architecture diagram, in the README, in the same pitch. Two products in one story wearing one color read as one product, or as carelessness. Indigo is adjacent to both and identical to neither.

**Supporting Ramp**
- `#3730A3` — deep indigo, for text on the light tint and for dark-mode chart fills
- `#6366F1` / `#818CF8` — mid ramp, for secondary data series and hover states
- `#EEF2FF` — pale tint, for passive status surfaces (badges, callouts, active nav)

**Secondary Color 1: Slate Gray (Text & Structure)**
- **Hex:** `#334155` (or `#64748B` for secondary text)
- **Role:** Primary text, interface elements, structure. Carries most of the interface. Feels architectural and professional.

**Secondary Color 2: Cool Off-White (Background)**
- **Hex:** `#F8FAFC` (cards sit on `#FFFFFF` for a half-step of elevation)
- **Role:** Primary background. The cool undertone pairs with indigo; a warm white would fight it. Avoids the sterile feel of pure white while keeping the page bright.

**Secondary Color 3: Alert (Reserved)**
- **Hex:** `#DC2626`
- **Role:** Irreversible and destructive actions only — revoke access, delete, critical errors. Never decorative. Nothing else in the system is red, so red always means the same thing.

**Color Personality**
Cool, technical, trustworthy. The palette occupies the "calm authority" territory — not warm or inviting, but not sterile either. It feels like looking at a well-lit server room: organized, clear, slightly industrial.

**Usage Rules**
- Indigo is the only saturated color in the interface; it marks what is interactive or what matters
- Slate gray dominates text and structure (should be 70%+ of the interface)
- Off-white is the page; white is a card
- Red is reserved for irreversible actions and never appears otherwise
- Never use: warm colors (orange, warm yellow), pastels, or a second saturated hue competing with indigo
- Accessibility: every pairing below clears WCAG AA (4.5:1)

**Palette Type**
Monochromatic indigo with a neutral slate support. Deliberately not complementary or triadic — those read as playful. A single hue doing all the signalling is what makes the system feel engineered rather than decorated.

---

## 04 — TYPOGRAPHY

**Primary Typeface: Inter**
- **Rationale:** Geometric sans-serif, open letterforms, consistent stroke weight, excellent readability at all sizes. Designed for screens. Neutral authority—it doesn't have personality, it has precision. Free (Google Fonts), which aligns with open-source values.
- **Weight usage:** Regular (400) for body, Semibold (600) for subheads, Bold (700) for headlines
- **Character:** Professional, modern, no decorative serifs or flourishes. Works equally well in headings and dense body copy. Tight, economical letterforms suggest engineering.

**Secondary Typeface: IBM Plex Mono**
- **Rationale:** Monospace signals "this is a value, not prose." Humanist rather than grotesque — rounder counters, slightly angled terminals — so it stays engineered without going rigid.
- **Role:** *Technical values only.* Cryptographic hashes, wallet addresses, file paths, code, contract identifiers, stat figures, step numerals. Nothing decorative.
- **Weights:** 400 and 500 only. Not a variable font, so every weight used must be requested explicitly.

**The mono/sans line**
Mono earns its place by meaning something: if the reader could copy the string and paste it into a terminal, it is mono. If it is a label describing the content, it is Inter. Two earlier drafts got this wrong — first JetBrains Mono, then IBM Plex Mono, set the small all-caps section eyebrows, and both read as stencil-like at 11px. The problem was not which mono; it was using mono for a label at all. Eyebrows and status chips are now Inter (see the `eyebrow` and `chip` utilities in `globals.css`), and the page reads calmer for it.

**Labels and eyebrows (Inter)**
- **Eyebrow:** 11px, weight 500, letter-spacing 0.12em, uppercase. Caps at this size need the extra tracking and the medium weight to stay legible; the defaults look thin and cramped.
- **Status chip:** 10px, weight 500, letter-spacing 0.08em, uppercase.
- Both are defined once as Tailwind utilities rather than repeated as class strings, so they cannot drift apart across the seven places they appear.

**Type Personality**
Clean, engineered, precise. Typography should be invisible—it should serve the content, not draw attention to itself. Kerning should be tight. Line spacing should be generous (1.6–1.8 line height for body). No italic variants except for emphasis in code or quotes. Hierarchy should be achieved through size and weight, not through style variations.

**Usage Hierarchy**
- **Headlines (H1):** Inter Bold, 32–48px, tight line height (1.2)
- **Subheads (H2/H3):** Inter Semibold, 24–28px, line height 1.3
- **Body:** Inter Regular, 16px, line height 1.6, max 70 characters per line
- **Labels & Microcopy:** Inter Regular, 12–14px, line height 1.5
- **Code/Technical:** IBM Plex Mono Regular, 13–14px, line height 1.4
- **Eyebrow / Label:** Inter Medium, 11px, 0.12em tracking, uppercase

**Avoid**
- Rounded sans-serifs (Rounded Gotham, SF Display with rounded variants)
- Serif typefaces (signals tradition, not modernity)
- Script or display fonts (signals creativity; SoulVault is infrastructure)
- Excessive weight variation (stick to 400, 600, 700; avoid 300 or 800)
- Italic for non-emphasis (upright always, unless deliberate emphasis)

---

## 05 — IMAGERY & PHOTOGRAPHY STYLE

**Overall Aesthetic**
Technical, minimal, architectural. Avoid lifestyle photography entirely. The visual mood is "looking at a well-engineered system"—clean lines, intentional composition, no unnecessary elements.

**Subject Matter**
- **Conceptual/Abstract:** Geometric shapes suggesting encryption (nested rectangles), continuity (interlocking circles), decentralization (distributed nodes), privacy (partial disclosure, selective visibility). Avoid literal "lock" imagery.
- **Technical:** Screenshots of clean interfaces, code samples, wallet interactions, documentation. Show the product working.
- **Environmental:** Minimalist workspace photography (clean desk, terminal, developer tools) if human figures are needed, but prefer abstract and technical imagery.
- **Avoid:** People in lifestyle poses, stock photos of handshakes/trust/security, clipart clouds, blockchain visual clichés (chains, coins, circuit boards).

**Color Treatment**
- Desaturated or monochromatic (grays, blacks, brand indigo)
- High contrast—avoid muddy midtones
- If color is used in imagery, limit to 2 colors maximum (e.g., indigo + gray)
- No warm color casts or golden-hour sunsets

**What to Avoid**
- Overproduced marketing photography (professional models, perfect lighting, staged scenarios)
- Stock photo aesthetics (Getty Images, Unsplash generic shots)
- Blockchain/crypto visual language (avoid looking like other crypto/Web3 marketing)
- Inspirational lifestyle imagery (sunrises, mountains, "empowered" poses)
- Heavy filters or effects; clean and direct is better
- Photorealistic renders of "the future" (too speculative; stay grounded in what exists now)

---

## 06 — ICONOGRAPHY & ILLUSTRATION

**Style**
Geometric line icons or minimal filled icons. Icons should be constructed from simple shapes (circles, rectangles, lines). No curves unless geometrically necessary. All icons in a set should maintain consistent visual language.

**Weight**
Thin to regular (1–2px stroke weight for line icons, or appropriately weighted fills). Heavy icons feel aggressive. Icons should feel like precision tools, not like graphic design flourishes.

**Personality**
Functional and utilitarian. Icons should communicate their meaning without needing labels. They're part of the interface, not decorative. An icon for "backup" should suggest continuity or archival (a simple vault or layered circle), not a friendly smiley-face system.

**Examples**
- Encryption: Concentric rectangles or a simple geometric lock shape
- Continuity: Interlocking or stacked elements suggesting persistence
- Wallet: Simplified geometric envelope or shield outline
- Revocation: Clean X or blocking line
- Access: A keyhole or authorization gate rendered geometrically

---

## 07 — DESIGN PRINCIPLES

**Precision Over Personality**
Every element should be intentional and earn its place. There is no "cute" or "playful." Layout, color, spacing, and typography should work together to create clarity, not delight. A professional reading the interface should feel that the system is engineered carefully, not designed casually.

**Clarity Through Restraint**
Information hierarchy should be clear because of what's emphasized, not because of what's added. Avoid: drop shadows, gradients, decorative elements, unnecessary animation. Clarity comes from using negative space, careful sizing, and color sparingly. A user should understand the interface in seconds without needing to read instructions.

**Structural Elegance**
The visual system should feel like a well-architected building: every element has a purpose, symmetry and rhythm are used intentionally, and removing any element would diminish the whole. This is achieved through consistent spacing (use a 4px or 8px grid), aligned elements, and repeating patterns.

**Technical Authenticity**
The visual language should reflect what the product actually does. Don't hide or simplify the technical reality; visualize it accurately. Show that this is real infrastructure, not marketing theater. An interface for managing encryption keys should look more like a database admin panel than a consumer app.

---

## 08 — BRAND EXPRESSIONS

### Social Media (Twitter, LinkedIn, GitHub)
**Avatar:** Mark + logotype (combined or icon alone; must remain recognizable at 48px). Indigo primary, gray/white supporting.

**Post Templates:** Minimal backgrounds (white or off-white), bold indigo accents for key information. Typography hierarchy: Inter for all. Use monospace (`IBM Plex Mono`) for code snippets or technical callouts. Avoid full-bleed images; frame content in white cards with subtle borders (1px slate gray).

**Color Coding:** Technical posts (indigo), announcements (indigo + white), developer updates (white with code blocks), security/privacy focus (indigo on white, no images necessary).

---

### Website / App Interface
**Navigation:** Slate gray text on off-white background. Indigo used for active states and CTAs. Generous whitespace. Monospace font for technical fields (API keys, wallet addresses, hashes). Code blocks: dark background (`#1E293B`), indigo syntax highlighting, `IBM Plex Mono` font.

**Hero Section:** Off-white background, indigo accent line or minimal geometric shape. Headline in Inter Bold. No hero image; if visual is needed, use abstract geometric shapes (e.g., interlocking circles suggesting encryption).

**CTAs:** Indigo background, white text, Inter Semibold. Hover state: slightly darker indigo. No rounded corners; squared corners maintain precision.

**Documentation:** Clean hierarchy, generous spacing, sidebar navigation in slate gray. Code samples on dark background. Monospace for technical terms inline.

---

### Business Cards / Stationery
**Format:** Minimal. Wordmark + logotype on front, contact info on back. Indigo on one side (wordmark), white on reverse (text). Paper should feel substantial (cardstock, not standard glossy). Consider: uncoated paper for a more technical, less polished feel. No photos or illustrations.

**Layout:** Lots of negative space. Text left-aligned, not centered. Use the grid (align to thirds). Indigo accent line (2–3mm thick) running down one edge.

---

### Presentations / Pitch Decks
**Deck Template:** Off-white background (`#F8FAFC`), slate gray text, indigo for emphasis and section dividers. Headlines in Inter Bold. Body in Inter Regular, generous line spacing. Use geometric shapes (rectangles, lines, circles) as visual accents, not photography.

**Title Slide:** Wordmark, headline, and a minimal geometric accent (e.g., an indigo line or interlocking circles). No photo.

**Content Slides:** 70% text, 30% visual (never imagery; use diagrams, geometric shapes, or interface screenshots). Data visualizations in indigo + gray. Avoid: clipart, stock photos, animated transitions.

**Close Slide:** Wordmark + "Questions?" in Inter Bold. Optional: indigo accent. No call-to-action graphic; let the work speak.

---

### Email Templates
**Header:** Wordmark + minimal indigo accent line. Off-white background.

**Body:** Inter Regular, 16px, slate gray text. Generous line height (1.6). Use indigo for links (underlined). Code blocks in monospace on light gray background.

**CTA Button:** Indigo background, white Inter Semibold text, squared corners, generous padding. Hover state: darker indigo.

---

## ACCESSIBILITY & IMPLEMENTATION

**Color Contrast**
- Indigo (#4F46E5) on white: 6.29:1 contrast ratio ✓
- Slate gray (#334155) on white: 10.6:1 contrast ratio ✓
- Deep indigo (#3730A3) on #EEF2FF tint: 8.88:1 contrast ratio ✓
- All combinations meet WCAG AA standards

**Responsive Design**
- Typography scales from 14px (mobile body) to 48px (desktop headline)
- Icons remain crisp at all sizes (use SVG, not bitmap)
- Whitespace scales proportionally on smaller screens
- Monospace code blocks remain readable and don't require zoom

**Production Guidelines**
- Logo files: SVG (primary), PNG variants (favicon, social), PDF (print)
- Color palette: document as hex codes, RGB, and CSS variables (e.g., `--color-primary-indigo`, `--color-text-slate`)
- Typography: provide font files for self-hosting or declare Google Fonts CDN usage
- Icon set: create as SVG master file with consistent stroke weight and sizing
- Grid system: document spacing (4px base unit), sizing, and alignment rules for developers

---

## FINAL NOTES FOR DESIGNERS & DEVELOPERS

This identity will be executed primarily in digital (web app, CLI, documentation). The visual system should feel like infrastructure because it *is* infrastructure. Think less "creative agency designing a startup" and more "system architect designing a protocol."

The aesthetic is intentionally austere. That austerity is the point—it signals that this system is designed for reliability and precision, not for delight. Professionals trust systems that are engineered carefully, and the visual identity should reinforce that trust through clarity and restraint.

Every pixel, every line, every color choice should earn its place. When in doubt, remove it.
