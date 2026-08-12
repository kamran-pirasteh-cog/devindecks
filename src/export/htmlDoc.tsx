'use client';

/**
 * Model -> static HTML document builder, shared by the HTML export and the
 * PDF export (which prints this same markup via the browser's print-to-PDF).
 * Renders through <SlideView> — the identical component the editor canvas and
 * filmstrip use — so the HTML/PDF output matches the on-screen WYSIWYG exactly.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { emuToInches, type Deck, type DesignSystem } from '@/model';
import { SlideView } from '@/render/SlideView';

// All three allowed families (see src/model/fonts.ts) are Google Fonts; load
// them by name so the standalone document renders identically to the editor,
// which gets them via next/font in the app shell.
const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;700&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&display=swap';

const FONT_VARS = `
  :root {
    --font-geist-sans: 'Geist', system-ui, sans-serif;
    --font-geist-mono: 'Geist Mono', ui-monospace, monospace;
    --font-source-serif: 'Source Serif 4', Georgia, serif;
  }
`;

export function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

function renderSlides(deck: Deck, ds: DesignSystem, widthPx: number, className: string): string {
  return deck.slides
    .map(
      (slide) =>
        `<section class="${className}">${renderToStaticMarkup(
          <SlideView slide={slide} slideSize={deck.slideSize} designSystem={ds} width={widthPx} />,
        )}</section>`,
    )
    .join('\n');
}

/** Self-contained HTML page: slides stacked for on-screen viewing/sharing. */
export function buildDeckHtml(deck: Deck, ds: DesignSystem): string {
  const viewWidth = 960;
  const slidesHtml = renderSlides(deck, ds, viewWidth, 'dd-slide');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(deck.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="${GOOGLE_FONTS_HREF}" />
<style>
${FONT_VARS}
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #e5e5e5;
    padding: 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    font-family: var(--font-geist-sans);
  }
  .dd-slide { box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
</style>
</head>
<body>
${slidesHtml}
</body>
</html>
`;
}

/**
 * Print-ready document: one slide per physical page, sized to the deck's
 * actual aspect ratio at 96 CSS px/in so the rendered pixel width equals the
 * page width exactly (no post-hoc CSS rescale of the absolutely-positioned
 * element tree).
 */
export function buildDeckPrintHtml(deck: Deck, ds: DesignSystem): string {
  const wIn = emuToInches(deck.slideSize.w);
  const hIn = emuToInches(deck.slideSize.h);
  const pagePx = wIn * 96;
  const slidesHtml = renderSlides(deck, ds, pagePx, 'dd-page');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(deck.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="${GOOGLE_FONTS_HREF}" />
<style>
${FONT_VARS}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  @page { size: ${wIn}in ${hIn}in; margin: 0; }
  .dd-page { break-after: page; }
  .dd-page:last-child { break-after: auto; }
</style>
</head>
<body>
${slidesHtml}
</body>
</html>
`;
}

export function deckFileBaseName(deck: Deck): string {
  return deck.title.replace(/[^\w.-]+/g, '_') || 'deck';
}
