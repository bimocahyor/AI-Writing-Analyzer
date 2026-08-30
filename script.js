/* ============================================================
   AI Writing Analyzer — script.js
   Deterministic heuristic text-pattern analyzer
   All scores derived from actual text features — no random numbers
   ============================================================ */

'use strict';

/* ─── Constants ──────────────────────────────────────────── */

// Scoring weights (must sum to 1.00)
const WEIGHTS = {
  sentenceUniformity:   0.18,
  lexicalRepetition:    0.14,
  phraseRepetition:     0.12,
  structuralConsistency:0.10,
  vocabularyDiversity:  0.12,
  wordComplexity:       0.10,
  punctuationVariation: 0.08,
  burstiness:           0.16,
};

// Common stop-words to skip in phrase/lexical analysis
const STOP_WORDS = new Set([
  'dan','yang','di','ke','dari','dengan','untuk','dalam','pada','adalah','ini',
  'itu','atau','juga','telah','akan','dapat','lebih','oleh','tidak','ada','bagi',
  'bahwa','serta','seperti','karena','sehingga','namun','tetapi','jika','maka',
  'sebuah','suatu','setiap','semua','berbagai','antara','dalam','tersebut',
  'the','a','an','of','in','to','and','that','is','it','for','on','are','as',
  'was','with','by','be','this','have','from','or','at','but','not','been',
  'they','which','their','had','has','when','there','one','all','would','we',
  'its','also','into','more','about','so','what','up','if','than','out','do',
  'were','can','he','she','him','her','his','we','our','you','your','my','me',
]);

const MIN_WORDS = 80;

/* ─── State ──────────────────────────────────────────────── */
let currentAnalysis = null;
let charts = {};

/* ─── DOM Refs ───────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ============================================================
   NAVIGATION
   ============================================================ */
function initNavigation() {
  const navItems    = document.querySelectorAll('.nav-item');
  const pages       = document.querySelectorAll('.page');
  const sidebar     = $('sidebar');
  const overlay     = $('sidebarOverlay');
  const hamburger   = $('hamburger');
  const sidebarClose= $('sidebarClose');
  const pageTitles  = {
    dashboard: { title: 'Dashboard',         desc: 'Selamat datang di AI Writing Analyzer' },
    analyze:   { title: 'Analisis Teks',     desc: 'Masukkan teks akademik untuk dianalisis' },
    guide:     { title: 'Panduan Analisis',  desc: 'Cara kerja sistem dan keterbatasannya' },
    history:   { title: 'Riwayat Analisis',  desc: 'Hasil analisis yang tersimpan di browser Anda' },
    about:     { title: 'Tentang',           desc: 'Informasi tentang AI Writing Analyzer' },
  };

  function showPage(pageId) {
    pages.forEach(p => p.classList.add('hidden'));
    navItems.forEach(n => n.classList.remove('active'));
    const target = document.getElementById('page-' + pageId);
    if (target) target.classList.remove('hidden');
    const active = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (active) active.classList.add('active');
    const meta = pageTitles[pageId];
    if (meta) {
      $('pageTitle').textContent  = meta.title;
      $('pageDesc').textContent   = meta.desc;
    }
    closeSidebar();
    if (pageId === 'history') renderHistory();
    if (pageId === 'dashboard') refreshDashboard();
  }

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  }

  navItems.forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      showPage(item.dataset.page);
    });
  });

  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.goto));
  });

  hamburger.addEventListener('click', openSidebar);
  sidebarClose.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);
}

/* ============================================================
   TEXT PREPROCESSING
   ============================================================ */

/**
 * Tokenize text into sentences.
 * Splits on . ! ? followed by whitespace or end-of-string.
 */
function getSentences(text) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
}

/**
 * Tokenize text into words (alphanumeric only, lowercase).
 */
function getWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9À-ÿ\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

/**
 * Count paragraphs separated by blank lines.
 */
function getParagraphs(text) {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 10);
}

/* ============================================================
   MODULE: DOCUMENT STRUCTURE PARSER
   Preserves titles, authors, headings, lists, citations,
   quotations, and paragraph breaks across the improvement pipeline.
   ============================================================ */

/**
 * Parse raw input text into a typed document object.
 *
 * Block types:
 *   title      — short all-caps or title-case line at very start (≤10 words)
 *   author     — "Oleh ..." / "By ..." line following title
 *   heading    — short line followed by blank line, not ending in period
 *   paragraph  — regular prose paragraph (rewritten by improver)
 *   quotation  — line starting with " or ' or containing "…" block-quote marks
 *   bullet     — line starting with - / • / * / →
 *   numbered   — line starting with digit + "." or ")"
 *   citation   — line that looks like a bibliographic reference
 *   separator  — horizontal rule (---, ===, ***)
 *   empty-line — preserved blank line between blocks
 *
 * @param {string} rawText
 * @returns {{ title: string|null, author: string|null, blocks: Array<{type,content}> }}
 */
function parseDocument(rawText) {
  if (!rawText || !rawText.trim()) return { title: null, author: null, blocks: [] };

  // Split into raw lines preserving order
  const lines = rawText.split('\n');
  const blocks = [];
  let i = 0;
  let titleFound  = false;
  let authorFound = false;
  let detectedTitle  = null;
  let detectedAuthor = null;

  // ── Helper predicates ────────────────────────────────────────────────────
  const isSeparator  = l => /^[-=*]{3,}\s*$/.test(l.trim());
  const isBullet     = l => /^[\-•\*→]\s/.test(l.trim());
  const isNumbered   = l => /^\d+[.)]\s/.test(l.trim());
  const isCitation   = l => {
    const t = l.trim();
    // e.g. "Smith, J. (2020)." or "[1] Author..." or "Author, A. (Year)."
    return /^\[?\d+\]/.test(t) || /^[A-Z][a-z]+,\s+[A-Z]\./.test(t) || /\(\d{4}\)/.test(t);
  };
  const isQuotation  = l => {
    const t = l.trim();
    return t.startsWith('"') || t.startsWith('\u201c') || t.startsWith('\u2018') || t.startsWith('>');
  };
  const isHeading    = l => {
    const t = l.trim();
    if (t.length === 0 || t.length > 100) return false;
    if (t.endsWith('.') || t.endsWith('?') || t.endsWith('!')) return false;
    const wc = t.split(/\s+/).length;
    return wc <= 8 && wc >= 1;
  };

  // Buffer for accumulating multi-line paragraph content
  let paraBuffer = [];

  const flushPara = () => {
    if (paraBuffer.length > 0) {
      blocks.push({ type: 'paragraph', content: paraBuffer.join(' ').trim() });
      paraBuffer = [];
    }
  };

  while (i < lines.length) {
    const raw  = lines[i];
    const line = raw.trim();

    // ── Empty line ───────────────────────────────────────────────────────
    if (line === '') {
      flushPara();
      // Collapse consecutive blank lines into one empty-line block
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'empty-line') {
        blocks.push({ type: 'empty-line', content: '' });
      }
      i++;
      continue;
    }

    // ── Separator ────────────────────────────────────────────────────────
    if (isSeparator(line)) {
      flushPara();
      blocks.push({ type: 'separator', content: line });
      i++; continue;
    }

    // ── Detect TITLE — only at the very start (before any paragraph) ─────
    if (!titleFound && blocks.filter(b => b.type === 'paragraph').length === 0) {
      const wc = line.split(/\s+/).length;
      if (wc <= 12 && !line.endsWith('.') && line.length < 150) {
        // Title: first non-blank line that is short and doesn't end with a sentence terminator
        titleFound   = true;
        detectedTitle = line;
        blocks.push({ type: 'title', content: line });
        i++; continue;
      }
    }

    // ── Detect AUTHOR — line immediately after title ──────────────────────
    // Accepts explicit prefixes (Oleh/By/Penulis/Nama/Author) OR a short
    // name-like line (no sentence terminators, ≤6 words) that comes before
    // any paragraph content.
    if (titleFound && !authorFound && blocks.filter(b=>b.type==='paragraph').length === 0) {
      const lc = line.toLowerCase();
      const isExplicitAuthor =
        lc.startsWith('oleh') || lc.startsWith('by ') || lc.startsWith('penulis') ||
        lc.startsWith('nama') || lc.startsWith('author');
      const wc = line.split(/\s+/).length;
      // A name-like line: ≤ 6 words, does not end with sentence punctuation,
      // does not look like a numbered/bullet item, and is not all-caps long (that is likely a heading).
      const isNameLike =
        wc >= 1 && wc <= 6 &&
        !line.endsWith('.') && !line.endsWith('?') && !line.endsWith('!') &&
        !isBullet(line) && !isNumbered(line);
      if (isExplicitAuthor || isNameLike) {
        authorFound   = true;
        detectedAuthor = line;
        blocks.push({ type: 'author', content: line });
        i++; continue;
      }
    }

    // ── Bullet list item ─────────────────────────────────────────────────
    if (isBullet(line)) {
      flushPara();
      blocks.push({ type: 'bullet', content: line });
      i++; continue;
    }

    // ── Numbered list item ───────────────────────────────────────────────
    if (isNumbered(line)) {
      flushPara();
      blocks.push({ type: 'numbered', content: line });
      i++; continue;
    }

    // ── Citation / reference ─────────────────────────────────────────────
    if (isCitation(line)) {
      flushPara();
      blocks.push({ type: 'citation', content: line });
      i++; continue;
    }

    // ── Block quotation ──────────────────────────────────────────────────
    if (isQuotation(line)) {
      flushPara();
      blocks.push({ type: 'quotation', content: line });
      i++; continue;
    }

    // ── Heading — short line preceded by (or followed by) an empty line ──
    if (paraBuffer.length === 0 && isHeading(line) && i + 1 < lines.length && lines[i+1].trim() === '') {
      blocks.push({ type: 'heading', content: line });
      i++; continue;
    }

    // ── Regular paragraph text (may span multiple lines) ─────────────────
    paraBuffer.push(line);
    i++;
  }

  flushPara(); // flush any remaining buffer

  return { title: detectedTitle, author: detectedAuthor, blocks };
}

/**
 * Reconstruct a flat plain-text string from a parsed document.
 * Suitable for clipboard copy and analysis engine input.
 *
 * @param {{ blocks: Array<{type,content}> }} doc
 * @returns {string}
 */
function reconstructDocumentText(doc) {
  if (!doc || !doc.blocks) return '';
  return doc.blocks.map(b => {
    if (b.type === 'empty-line') return '';
    if (b.type === 'separator')  return '---';
    return b.content;
  }).join('\n');
}

/**
 * Render typed document blocks as semantic HTML into a container element.
 * Used for all .text-panel elements that show original or improved text.
 *
 * @param {Array<{type,content}>} blocks
 * @param {HTMLElement} containerEl
 */
function renderDocumentBlocks(blocks, containerEl, plainText = false) {
  if (!containerEl) return;

  // Plain-text mode: just show pre-formatted text with line breaks
  if (plainText) {
    const flat = blocks ? blocks.map(b => {
      if (b.type === 'empty-line') return '';
      if (b.type === 'separator')  return '---';
      return b.content;
    }).join('\n') : '';
    containerEl.innerHTML = `<pre class="doc-plaintext">${escapeHtml(flat)}</pre>`;
    return;
  }

  if (!blocks || blocks.length === 0) { containerEl.innerHTML = ''; return; }

  const parts = blocks.map(b => {
    const text = escapeHtml(b.content);
    switch (b.type) {
      case 'title':
        return `<p class="doc-block doc-title">${text}</p>`;
      case 'author':
        return `<p class="doc-block doc-author">${text}</p>`;
      case 'heading':
        return `<p class="doc-block doc-heading">${text}</p>`;
      case 'paragraph':
        return `<p class="doc-block doc-paragraph">${text}</p>`;
      case 'quotation':
        return `<blockquote class="doc-block doc-quotation">${text}</blockquote>`;
      case 'bullet':
        return `<p class="doc-block doc-bullet">${text}</p>`;
      case 'numbered':
        return `<p class="doc-block doc-numbered">${text}</p>`;
      case 'citation':
        return `<p class="doc-block doc-citation">${text}</p>`;
      case 'separator':
        return `<hr class="doc-separator" />`;
      case 'empty-line':
        return `<div class="doc-spacer"></div>`;
      default:
        return `<p class="doc-block doc-paragraph">${text}</p>`;
    }
  });

  containerEl.innerHTML = parts.join('');
}

/**
 * Render document into a panel, respecting the current _formatMode.
 * Use this for ALL text panel renders instead of raw textContent assignment.
 *
 * @param {string|{blocks:Array}} docOrText — parsed document OR raw string
 * @param {HTMLElement} containerEl
 */
function renderPanel(docOrText, containerEl) {
  if (!containerEl) return;
  const isPlain = (_formatMode === 'plaintext');

  let doc;
  if (typeof docOrText === 'string') {
    doc = parseDocument(docOrText);
  } else {
    doc = docOrText;
  }

  if (!doc || !doc.blocks || doc.blocks.length === 0) {
    containerEl.innerHTML = '';
    return;
  }

  renderDocumentBlocks(doc.blocks, containerEl, isPlain);
}

/**
 * Validate structural consistency between original and improved document.
 * Returns a status object with a flag and optional message.
 *
 * @param {{ blocks: Array }} origDoc
 * @param {{ blocks: Array }} impDoc
 * @returns {{ ok: boolean, message: string }}
 */
function validateDocumentStructure(origDoc, impDoc) {
  if (!origDoc || !impDoc) return { ok: false, message: 'Dokumen tidak valid.' };

  const countType = (doc, type) => doc.blocks.filter(b => b.type === type).length;

  const origParas  = countType(origDoc,  'paragraph');
  const impParas   = countType(impDoc,   'paragraph');
  const origTitle  = countType(origDoc,  'title');
  const impTitle   = countType(impDoc,   'title');
  const origAuthor = countType(origDoc,  'author');
  const impAuthor  = countType(impDoc,   'author');

  if (origTitle !== impTitle || origAuthor !== impAuthor) {
    return { ok: false, message: 'Beberapa bagian struktur perlu ditinjau.' };
  }
  if (Math.abs(origParas - impParas) > 2) {
    return { ok: false, message: 'Beberapa bagian struktur perlu ditinjau.' };
  }
  return { ok: true, message: 'Struktur dokumen dipertahankan dari teks asli.' };
}

/**
 * Normalize a history record that may be from an older version without document structure.
 * Returns a document object from flat originalText if no parsed doc is stored.
 *
 * @param {object} record — history record
 * @returns {{ title, author, blocks }}
 */
function normalizeHistoricalAnalysis(record) {
  if (record.originalDocument) return record.originalDocument;
  // Fallback: parse from flat originalText
  if (record.originalText) return parseDocument(record.originalText);
  return { title: null, author: null, blocks: [] };
}

/* ============================================================
   FEATURE EXTRACTION
   Each function returns a normalised value 0–100 (higher = more AI-like)
   unless noted. Raw values are also returned where useful.
   ============================================================ */

/**
 * Sentence Uniformity (0–100).
 * AI text tends to have very similar sentence lengths.
 * Uses coefficient of variation (CV): low CV = high uniformity = high score.
 */
function calcSentenceUniformity(sentences) {
  if (sentences.length < 2) return { score: 50, raw: { mean: 0, cv: 0 } };
  const lengths = sentences.map(s => s.split(/\s+/).filter(w => w).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length;
  const std = Math.sqrt(variance);
  const cv = mean > 0 ? std / mean : 0;
  // cv near 0 = very uniform (AI-like). Map cv 0→1 to score 100→0.
  const score = Math.min(100, Math.max(0, 100 - cv * 120));
  return { score, raw: { mean: +mean.toFixed(1), std: +std.toFixed(1), cv: +cv.toFixed(3), lengths } };
}

/**
 * Lexical Repetition (0–100).
 * How often significant words (non-stop) repeat relative to unique count.
 */
function calcLexicalRepetition(words) {
  const sig = words.filter(w => !STOP_WORDS.has(w) && w.length > 3);
  if (sig.length === 0) return { score: 0, raw: { topWords: [] } };
  const freq = {};
  sig.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const counts = Object.values(freq).sort((a, b) => b - a);
  const unique  = Object.keys(freq).length;
  const total   = sig.length;
  // Repetition ratio: how much of the text is repeated words
  const repeatedTokens = counts.filter(c => c > 1).reduce((a, b) => a + b, 0);
  const repRatio = total > 0 ? repeatedTokens / total : 0;
  const score = Math.min(100, repRatio * 130);
  const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { score, raw: { total, unique, repRatio: +repRatio.toFixed(3), topWords } };
}

/**
 * Phrase Repetition (0–100).
 * Counts bigrams and trigrams; high repetition = high score.
 */
function calcPhraseRepetition(words) {
  const sig = words.filter(w => !STOP_WORDS.has(w) && w.length > 2);
  if (sig.length < 4) return { score: 0, raw: { topPhrases: [] } };
  const bigrams = {};
  for (let i = 0; i < sig.length - 1; i++) {
    const key = sig[i] + ' ' + sig[i + 1];
    bigrams[key] = (bigrams[key] || 0) + 1;
  }
  const repeatedBigrams = Object.values(bigrams).filter(c => c > 1).reduce((a, b) => a + b, 0);
  const totalBigrams = sig.length - 1;
  const repRatio = totalBigrams > 0 ? repeatedBigrams / totalBigrams : 0;
  const score = Math.min(100, repRatio * 180);
  const topPhrases = Object.entries(bigrams)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return { score, raw: { totalBigrams, repeatedBigrams, repRatio: +repRatio.toFixed(3), topPhrases } };
}

/**
 * Structural Consistency (0–100).
 * Measures how similar paragraph lengths are to each other.
 */
function calcStructuralConsistency(paragraphs) {
  if (paragraphs.length < 2) return { score: 50, raw: {} };
  const lengths = paragraphs.map(p => p.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const score = Math.min(100, Math.max(0, 100 - cv * 100));
  return { score, raw: { paraCount: paragraphs.length, cv: +cv.toFixed(3) } };
}

/**
 * Vocabulary Diversity (Type-Token Ratio) — INVERTED for AI score.
 * Low TTR = low diversity = high AI risk.
 * TTR 0–1 → AI risk = (1 - TTR) * 100
 */
function calcVocabularyDiversity(words) {
  if (words.length === 0) return { score: 50, ttr: 0.5, raw: {} };
  const unique = new Set(words).size;
  // Adjusted TTR using moving window of 50 words to reduce text-length bias
  const windowSize = Math.min(50, words.length);
  let windowTTRsum = 0, windows = 0;
  for (let i = 0; i <= words.length - windowSize; i += Math.max(1, Math.floor(windowSize / 2))) {
    const slice = words.slice(i, i + windowSize);
    windowTTRsum += new Set(slice).size / slice.length;
    windows++;
  }
  const avgTTR = windows > 0 ? windowTTRsum / windows : unique / words.length;
  // AI risk: low diversity → high score
  const score = Math.min(100, Math.max(0, (1 - avgTTR) * 120));
  return { score, ttr: +avgTTR.toFixed(3), raw: { total: words.length, unique } };
}

/**
 * Word Complexity (0–100).
 * AI often uses slightly higher proportion of long/formal words.
 * Proportion of words > 7 chars.
 */
function calcWordComplexity(words) {
  if (words.length === 0) return { score: 50, raw: {} };
  const longWords = words.filter(w => w.length > 7).length;
  const ratio = longWords / words.length;
  // ratio near 0.35+ suggests high complexity
  const score = Math.min(100, ratio * 280);
  return { score, ratio: +ratio.toFixed(3), raw: { longWords, total: words.length } };
}

/**
 * Punctuation Variation (INVERTED for AI score).
 * AI tends to have regular, uniform punctuation patterns.
 * Fewer punctuation types = higher AI score.
 */
function calcPunctuationVariation(text) {
  const punctMatches = text.match(/[.,;:!?()\-—–"']/g) || [];
  if (punctMatches.length < 5) return { score: 60, raw: { variety: 0, count: 0 } };
  const variety = new Set(punctMatches).size;
  const count   = punctMatches.length;
  // More variety = more human-like. Low variety → high AI risk.
  const score = Math.min(100, Math.max(0, 100 - (variety / 9) * 100));
  return { score, raw: { variety, count } };
}

/**
 * Burstiness (INVERTED for AI score).
 * Human writing tends to "burst" — varying sentence lengths a lot.
 * Low burstiness (smooth distribution) → high AI score.
 * Burstiness formula: (std - mean) / (std + mean)
 */
function calcBurstiness(sentences) {
  if (sentences.length < 3) return { score: 50, raw: {} };
  const lengths = sentences.map(s => s.split(/\s+/).filter(w => w).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length;
  const std = Math.sqrt(variance);
  // Burstiness B = (std - mean) / (std + mean)  range: -1 to 1
  const B = (std + mean) > 0 ? (std - mean) / (std + mean) : 0;
  // B near -1 = very regular = high AI risk
  // Map B from (-1, 1) → AI score (100, 0)
  const score = Math.min(100, Math.max(0, (1 - B) * 50));
  return { score, burstiness: +B.toFixed(3), raw: { std: +std.toFixed(1), mean: +mean.toFixed(1) } };
}

/**
 * Detect first-person vs third-person usage.
 */
function detectPersonUsage(text) {
  const lower = text.toLowerCase();
  const firstPerson  = (lower.match(/\b(saya|aku|kami|kita|i\b|we\b|my\b|our\b)\b/g) || []).length;
  const thirdPerson  = (lower.match(/\b(ia|dia|mereka|beliau|penelitian ini|studi ini|they|their|it\b)\b/g) || []).length;
  return { firstPerson, thirdPerson };
}

/**
 * Detect academic phrase repetition.
 */
function detectAcademicPhrases(text) {
  const phrases = [
    'selain itu','di samping itu','dengan demikian','oleh karena itu','berdasarkan',
    'dapat disimpulkan','hasil penelitian','dalam hal ini','terkait dengan','bertujuan untuk',
    'furthermore','in addition','however','therefore','in conclusion','it is important',
    'it can be seen','this study','research shows','as a result','in order to',
  ];
  const lower = text.toLowerCase();
  const found = [];
  phrases.forEach(p => {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const count = (lower.match(re) || []).length;
    if (count > 0) found.push({ phrase: p, count });
  });
  found.sort((a, b) => b.count - a.count);
  return found;
}

/* ============================================================
   SCORE CALCULATION
   Combines all feature scores with weights into final risk score.
   Deterministic: same input → same output.
   ============================================================ */
function calculateScore(features) {
  const raw = {
    sentenceUniformity:    features.sentenceUniformity.score,
    lexicalRepetition:     features.lexicalRepetition.score,
    phraseRepetition:      features.phraseRepetition.score,
    structuralConsistency: features.structuralConsistency.score,
    vocabularyDiversity:   features.vocabularyDiversity.score,
    wordComplexity:        features.wordComplexity.score,
    punctuationVariation:  features.punctuationVariation.score,
    burstiness:            features.burstiness.score,
  };

  let total = 0;
  const contributions = {};
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const contribution = raw[key] * weight;
    contributions[key] = +contribution.toFixed(2);
    total += contribution;
  }

  const finalScore = Math.min(100, Math.max(0, Math.round(total)));
  return { finalScore, contributions, rawScores: raw };
}

/**
 * Returns risk category label and badge class.
 */
function getRiskCategory(score) {
  if (score < 30) return { label: 'Risiko Rendah',        badge: 'low',       color: '#4ade80' };
  if (score < 60) return { label: 'Risiko Sedang',        badge: 'moderate',  color: '#fde047' };
  if (score < 80) return { label: 'Risiko Tinggi',        badge: 'high',      color: '#fb923c' };
  return            { label: 'Risiko Sangat Tinggi',      badge: 'very-high', color: '#f87171' };
}

/* ============================================================
   MAIN ANALYSIS RUNNER
   ============================================================ */
function analyzeText(text) {
  const sentences  = getSentences(text);
  const words      = getWords(text);
  const paragraphs = getParagraphs(text);

  const features = {
    sentenceUniformity:    calcSentenceUniformity(sentences),
    lexicalRepetition:     calcLexicalRepetition(words),
    phraseRepetition:      calcPhraseRepetition(words),
    structuralConsistency: calcStructuralConsistency(paragraphs),
    vocabularyDiversity:   calcVocabularyDiversity(words),
    wordComplexity:        calcWordComplexity(words),
    punctuationVariation:  calcPunctuationVariation(text),
    burstiness:            calcBurstiness(sentences),
  };

  const { finalScore, contributions, rawScores } = calculateScore(features);
  const category  = getRiskCategory(finalScore);
  const person    = detectPersonUsage(text);
  const academic  = detectAcademicPhrases(text);

  return {
    text,
    words,
    sentences,
    paragraphs,
    features,
    finalScore,
    contributions,
    rawScores,
    category,
    person,
    academic,
    wordCount:     words.length,
    sentenceCount: sentences.length,
    charCount:     text.length,
    timestamp:     Date.now(),
  };
}

/* ============================================================
   UI RENDERING
   ============================================================ */

function setStatus(state, label) {
  const dot   = document.querySelector('.status-dot');
  const lbl   = document.querySelector('.status-label');
  dot.className = 'status-dot ' + state;
  lbl.textContent = label;
}

function showError(msg) {
  const el = $('errorMsg');
  el.classList.remove('hidden');
  el.innerHTML = `<span style="color:var(--accent-red);">⚠</span> ${msg}`;
  setStatus('error', 'Error');
}

function clearError() {
  $('errorMsg').classList.add('hidden');
}

/**
 * Render KPI cards.
 */
function renderKPIs(analysis) {
  const { finalScore, wordCount, sentenceCount, category } = analysis;
  $('kpiRiskScore').textContent  = finalScore + '%';
  $('kpiHumanScore').textContent = (100 - finalScore) + '%';
  $('kpiWords').textContent      = wordCount.toLocaleString('id-ID');
  $('kpiSentences').textContent  = sentenceCount.toLocaleString('id-ID');
  const badge = $('kpiRiskBadge');
  badge.textContent  = category.label;
  badge.className    = 'kpi-badge badge-' + category.badge;
}

/**
 * Render metrics grid.
 */
function renderMetrics(analysis) {
  const container = $('metricsGrid');
  container.innerHTML = '';

  const metricDefs = [
    {
      key: 'sentenceUniformity',
      name: 'Keseragaman Kalimat',
      valueLabel: v => v.toFixed(0) + '%',
      desc: s => `Rata-rata panjang kalimat: ${s.raw.mean} kata (SD ±${s.raw.std})`,
      tooltip: 'Tulisan AI cenderung memiliki kalimat dengan panjang yang sangat seragam. Skor tinggi menunjukkan panjang kalimat yang relatif konsisten.',
      invert: false,
    },
    {
      key: 'lexicalRepetition',
      name: 'Repetisi Leksikal',
      valueLabel: v => v.toFixed(0) + '%',
      desc: s => `${(s.raw.repRatio * 100).toFixed(1)}% token signifikan merupakan pengulangan`,
      tooltip: 'Mengukur seberapa sering kata-kata bermakna diulang dalam teks. Pengulangan tinggi bisa mengindikasikan pola AI.',
      invert: false,
    },
    {
      key: 'phraseRepetition',
      name: 'Repetisi Frasa',
      valueLabel: v => v.toFixed(0) + '%',
      desc: s => s.raw.topPhrases.length > 0
        ? `Frasa berulang: "${s.raw.topPhrases[0]?.[0]}" (${s.raw.topPhrases[0]?.[1]}×)`
        : 'Tidak ada frasa berulang signifikan',
      tooltip: 'Menghitung seberapa sering pasangan kata yang sama muncul. Frasa yang terlalu sering muncul adalah pola umum AI.',
      invert: false,
    },
    {
      key: 'structuralConsistency',
      name: 'Konsistensi Struktur',
      valueLabel: v => v.toFixed(0) + '%',
      desc: s => `${s.raw.paraCount} paragraf dianalisis (CV: ${s.raw.cv})`,
      tooltip: 'Seberapa seragam panjang setiap paragraf. AI cenderung menghasilkan paragraf dengan panjang yang sangat konsisten.',
      invert: false,
    },
    {
      key: 'vocabularyDiversity',
      name: 'Keragaman Kosakata',
      valueLabel: v => (100 - v).toFixed(0) + '%',
      desc: s => `TTR rata-rata: ${(s.ttr * 100).toFixed(1)}% (${s.raw.unique} kata unik dari ${s.raw.total})`,
      tooltip: 'Type-Token Ratio (TTR): rasio kata unik terhadap total kata. Semakin tinggi TTR, semakin beragam kosakata. Nilai TTR rendah meningkatkan skor risiko AI.',
      invert: true, // displayed as diversity, not risk
    },
    {
      key: 'wordComplexity',
      name: 'Kompleksitas Kata',
      valueLabel: v => v.toFixed(0) + '%',
      desc: s => `${(s.ratio * 100).toFixed(1)}% kata memiliki lebih dari 7 karakter`,
      tooltip: 'Proporsi kata panjang (>7 karakter). Teks AI sering menggunakan banyak kata formal panjang secara konsisten.',
      invert: false,
    },
    {
      key: 'punctuationVariation',
      name: 'Variasi Tanda Baca',
      valueLabel: v => (100 - v).toFixed(0) + '%',
      desc: s => `${s.raw.variety} jenis tanda baca digunakan (${s.raw.count} total)`,
      tooltip: 'Keberagaman tanda baca yang digunakan. Teks AI cenderung menggunakan jenis tanda baca yang terbatas secara merata.',
      invert: true,
    },
    {
      key: 'burstiness',
      name: 'Burstiness Kalimat',
      valueLabel: v => (100 - v).toFixed(0) + '%',
      desc: s => `Burstiness index: ${s.burstiness} (SD: ${s.raw?.std}, mean: ${s.raw?.mean})`,
      tooltip: 'Variasi "meledak" dalam panjang kalimat. Penulis manusia cenderung memiliki variasi mendadak. Teks AI cenderung lebih smooth (burstiness rendah).',
      invert: true,
    },
  ];

  metricDefs.forEach(def => {
    const feat    = analysis.features[def.key];
    const score   = feat.score;
    const barPct  = Math.round(score);
    const displayVal = def.valueLabel(score);
    const barColor   = score >= 70 ? 'var(--accent-red)' : score >= 40 ? 'var(--accent-gold)' : 'var(--accent-green)';

    const card = document.createElement('div');
    card.className = 'metric-card';
    card.innerHTML = `
      <div class="metric-header">
        <span class="metric-name">${def.name}</span>
        <span class="metric-value">${displayVal}</span>
      </div>
      <div class="metric-bar-track">
        <div class="metric-bar-fill" style="width:${barPct}%;background:${barColor};"></div>
      </div>
      <p class="metric-desc">${def.desc(feat)}</p>
      <button class="metric-tooltip-btn" aria-expanded="false">Apa artinya?</button>
      <div class="metric-expanded hidden">${def.tooltip}</div>
    `;
    const btn = card.querySelector('.metric-tooltip-btn');
    const expanded = card.querySelector('.metric-expanded');
    btn.addEventListener('click', () => {
      const isOpen = !expanded.classList.contains('hidden');
      expanded.classList.toggle('hidden', isOpen);
      btn.textContent = isOpen ? 'Apa artinya?' : 'Sembunyikan ↑';
      btn.setAttribute('aria-expanded', String(!isOpen));
    });
    container.appendChild(card);
  });
}

/**
 * Render "Why did I get this score?" section.
 */
function renderWhySection(analysis) {
  const { finalScore, features, category } = analysis;
  const container = $('whySection');
  const reasons   = [];

  if (features.sentenceUniformity.score >= 60)
    reasons.push('Panjang kalimat relatif seragam, kurang bervariasi.');
  if (features.lexicalRepetition.score >= 55)
    reasons.push('Beberapa kata bermakna diulang cukup sering dalam teks.');
  if (features.phraseRepetition.score >= 50)
    reasons.push('Terdapat frasa atau pasangan kata yang muncul berulang kali.');
  if (features.structuralConsistency.score >= 60)
    reasons.push('Panjang paragraf sangat konsisten di seluruh teks.');
  if (features.vocabularyDiversity.score >= 55)
    reasons.push('Keragaman kosakata relatif rendah — banyak kata yang diulang.');
  if (features.wordComplexity.score >= 55)
    reasons.push('Proporsi kata formal atau panjang cukup tinggi secara merata.');
  if (features.punctuationVariation.score >= 60)
    reasons.push('Variasi penggunaan tanda baca terbatas, cenderung seragam.');
  if (features.burstiness.score >= 60)
    reasons.push('Distribusi panjang kalimat cukup smooth (rendah variasi mendadak).');

  if (reasons.length === 0)
    reasons.push('Tidak ada pola tunggal yang sangat dominan dalam teks ini.');

  const listHtml = reasons.map(r => `
    <li class="why-item">
      <span class="why-bullet"></span>
      <span>${r}</span>
    </li>`).join('');

  container.innerHTML = `
    <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.5rem;">
      Skor estimasi Anda <strong style="color:var(--text-primary)">${finalScore}%</strong>
      (${category.label}) muncul karena:
    </p>
    <ul class="why-list">${listHtml}</ul>
  `;
}

/**
 * Render writing quality insight section.
 */
function renderInsightSection(analysis) {
  const { features, wordCount, sentenceCount, person, academic } = analysis;
  const container = $('insightSection');
  const insights  = [];

  // Sentence variation
  const cv = features.sentenceUniformity.raw.cv;
  if (cv < 0.3) {
    insights.push({ tag: 'warning', tagClass: 'tag-warning', title: 'Variasi Kalimat Rendah',
      desc: `Koefisien variasi panjang kalimat: ${(cv * 100).toFixed(1)}%. Kalimat-kalimat tampak sangat seragam.`,
      rec: 'Coba variasikan panjang kalimat — campurkan kalimat pendek, sedang, dan panjang.' });
  } else {
    insights.push({ tag: 'ok', tagClass: 'tag-ok', title: 'Variasi Kalimat Cukup Baik',
      desc: `Variasi panjang kalimat terdeteksi (CV: ${(cv * 100).toFixed(1)}%).`,
      rec: 'Pertahankan variasi struktur kalimat ini.' });
  }

  // Repetition
  if (features.lexicalRepetition.score >= 50 || features.phraseRepetition.score >= 45) {
    const top = features.lexicalRepetition.raw.topWords?.[0];
    insights.push({ tag: 'warning', tagClass: 'tag-warning', title: 'Repetisi Kata/Frasa',
      desc: top ? `Kata "${top[0]}" muncul ${top[1]} kali. Beberapa frasa tampak berulang.` : 'Beberapa kata atau frasa tampak berulang.',
      rec: 'Pertimbangkan penggunaan sinonim atau restrukturisasi kalimat untuk mengurangi pengulangan.' });
  }

  // Word density
  const avgWordsPerSent = sentenceCount > 0 ? (wordCount / sentenceCount).toFixed(1) : 0;
  if (avgWordsPerSent > 25) {
    insights.push({ tag: 'warning', tagClass: 'tag-warning', title: 'Kepadatan Kata Tinggi',
      desc: `Rata-rata ${avgWordsPerSent} kata per kalimat. Kalimat cenderung panjang dan padat.`,
      rec: 'Pertimbangkan memecah kalimat panjang menjadi dua atau tiga kalimat lebih pendek.' });
  } else {
    insights.push({ tag: 'ok', tagClass: 'tag-ok', title: 'Kepadatan Kata Seimbang',
      desc: `Rata-rata ${avgWordsPerSent} kata per kalimat.`,
      rec: 'Panjang kalimat rata-rata berada dalam kisaran yang cukup baik untuk teks akademik.' });
  }

  // Person usage
  if (person.firstPerson < 1 && sentenceCount > 10) {
    insights.push({ tag: 'info', tagClass: 'tag-info', title: 'Penggunaan Sudut Pandang',
      desc: 'Tidak terdeteksi kata ganti orang pertama. Teks menggunakan gaya impersonal.',
      rec: 'Gaya impersonal umum dalam tulisan akademik formal — pastikan ini sesuai dengan gaya yang diminta.' });
  }

  // Academic phrase repetition
  const highRepPhrase = academic.filter(a => a.count >= 3);
  if (highRepPhrase.length > 0) {
    insights.push({ tag: 'warning', tagClass: 'tag-warning', title: 'Frasa Akademik Berulang',
      desc: `Frasa seperti "${highRepPhrase[0].phrase}" muncul ${highRepPhrase[0].count} kali.`,
      rec: 'Gunakan variasi frasa transisi dan penghubung agar tulisan terasa lebih natural.' });
  }

  // Structural consistency
  if (features.structuralConsistency.score >= 70 && analysis.paragraphs.length >= 3) {
    insights.push({ tag: 'warning', tagClass: 'tag-warning', title: 'Konsistensi Struktur Tinggi',
      desc: `${analysis.paragraphs.length} paragraf memiliki panjang yang sangat mirip.`,
      rec: 'Variasikan panjang dan komposisi setiap paragraf sesuai dengan kedalaman ide yang disampaikan.' });
  }

  const html = insights.map(ins => `
    <div class="insight-item">
      <div class="insight-item-header">
        <span class="insight-tag ${ins.tagClass}">${ins.tag === 'warning' ? 'Perhatian' : ins.tag === 'ok' ? 'Baik' : 'Info'}</span>
        <span class="insight-item-title">${ins.title}</span>
      </div>
      <p class="insight-item-desc">${ins.desc}</p>
      <p class="insight-rec">💡 ${ins.rec}</p>
    </div>
  `).join('');

  container.innerHTML = `<div class="insight-list">${html}</div>`;
}

/* ============================================================
   CHART RENDERING
   ============================================================ */

const CHART_DEFAULTS = {
  color: '#F8FAFC',
  gridColor: 'rgba(255,255,255,0.07)',
  tickColor: '#64748b',
};

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}

/**
 * A. Donut chart — overall AI risk score.
 */
function renderDonutChart(score, category) {
  destroyChart('donut');
  const ctx = $('chartDonut').getContext('2d');
  charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [score, 100 - score],
        backgroundColor: [category.color, 'rgba(255,255,255,0.06)'],
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 800, easing: 'easeInOutQuart' },
    },
  });
  $('donutCenter').textContent = score + '%';
}

/**
 * B. Radar chart — feature profile.
 */
function renderRadarChart(analysis) {
  destroyChart('radar');
  const ctx = $('chartRadar').getContext('2d');
  const f   = analysis.rawScores;
  charts.radar = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: [
        'Keseragaman\nKalimat',
        'Repetisi\nLeksikal',
        'Repetisi\nFrasa',
        'Konsistensi\nStruktur',
        'Kosakata\n(Risiko)',
        'Kompleksitas\nKata',
        'Tanda Baca\n(Risiko)',
        'Burstiness\n(Risiko)',
      ],
      datasets: [{
        label: 'Skor Risiko Fitur',
        data: [
          f.sentenceUniformity,
          f.lexicalRepetition,
          f.phraseRepetition,
          f.structuralConsistency,
          f.vocabularyDiversity,
          f.wordComplexity,
          f.punctuationVariation,
          f.burstiness,
        ].map(v => Math.round(v)),
        backgroundColor: 'rgba(37,99,235,0.2)',
        borderColor: 'rgba(37,99,235,0.8)',
        borderWidth: 2,
        pointBackgroundColor: '#2563EB',
        pointRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { stepSize: 25, color: CHART_DEFAULTS.tickColor, backdropColor: 'transparent', font: { size: 10 } },
          grid:  { color: CHART_DEFAULTS.gridColor },
          pointLabels: { color: CHART_DEFAULTS.color, font: { size: 10 } },
          angleLines: { color: CHART_DEFAULTS.gridColor },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.formattedValue + '%' } },
      },
      animation: { duration: 700 },
    },
  });
}

/**
 * C. Bar chart — sentence length distribution.
 */
function renderSentenceLengthChart(sentences) {
  destroyChart('sentLen');
  const ctx = $('chartSentLen').getContext('2d');
  const lengths = sentences.map(s => s.split(/\s+/).filter(w => w).length);
  // Bucket into ranges
  const buckets = { '1-5': 0, '6-10': 0, '11-15': 0, '16-20': 0, '21-30': 0, '31-40': 0, '41+': 0 };
  lengths.forEach(l => {
    if      (l <= 5)  buckets['1-5']++;
    else if (l <= 10) buckets['6-10']++;
    else if (l <= 15) buckets['11-15']++;
    else if (l <= 20) buckets['16-20']++;
    else if (l <= 30) buckets['21-30']++;
    else if (l <= 40) buckets['31-40']++;
    else              buckets['41+']++;
  });
  charts.sentLen = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(buckets).map(k => k + ' kata'),
      datasets: [{
        label: 'Jumlah Kalimat',
        data: Object.values(buckets),
        backgroundColor: 'rgba(37,99,235,0.7)',
        borderColor: 'rgba(37,99,235,1)',
        borderWidth: 1,
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.formattedValue + ' kalimat' } },
      },
      scales: {
        x: { ticks: { color: CHART_DEFAULTS.tickColor }, grid: { color: CHART_DEFAULTS.gridColor } },
        y: { ticks: { color: CHART_DEFAULTS.tickColor, stepSize: 1 }, grid: { color: CHART_DEFAULTS.gridColor }, beginAtZero: true },
      },
      animation: { duration: 600 },
    },
  });
}

/**
 * D. Horizontal bar chart — risk factor contributions.
 */
function renderRiskFactorsChart(contributions) {
  destroyChart('riskFactors');
  const ctx = $('chartRiskFactors').getContext('2d');
  const labels = {
    sentenceUniformity:    'Keseragaman Kalimat',
    burstiness:            'Burstiness Kalimat',
    lexicalRepetition:     'Repetisi Leksikal',
    vocabularyDiversity:   'Keragaman Kosakata',
    phraseRepetition:      'Repetisi Frasa',
    structuralConsistency: 'Konsistensi Struktur',
    wordComplexity:        'Kompleksitas Kata',
    punctuationVariation:  'Variasi Tanda Baca',
  };
  const entries = Object.entries(contributions).sort((a, b) => b[1] - a[1]);
  const maxVal  = Math.max(...entries.map(e => e[1]));
  charts.riskFactors = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map(([k]) => labels[k] || k),
      datasets: [{
        label: 'Kontribusi ke Skor Risiko (%)',
        data: entries.map(([, v]) => +v.toFixed(2)),
        backgroundColor: entries.map(([, v]) => {
          const frac = maxVal > 0 ? v / maxVal : 0;
          if (frac > 0.75) return 'rgba(220,38,38,0.75)';
          if (frac > 0.45) return 'rgba(234,88,12,0.7)';
          return 'rgba(37,99,235,0.65)';
        }),
        borderWidth: 0,
        borderRadius: 5,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.formattedValue.toFixed(2) + ' poin' } },
      },
      scales: {
        x: { ticks: { color: CHART_DEFAULTS.tickColor }, grid: { color: CHART_DEFAULTS.gridColor }, beginAtZero: true },
        y: { ticks: { color: CHART_DEFAULTS.tickColor, font: { size: 11 } }, grid: { color: CHART_DEFAULTS.gridColor } },
      },
      animation: { duration: 600 },
    },
  });
}

function renderAllCharts(analysis) {
  renderDonutChart(analysis.finalScore, analysis.category);
  renderRadarChart(analysis);
  renderSentenceLengthChart(analysis.sentences);
  renderRiskFactorsChart(analysis.contributions);
}

/* ============================================================
   HISTORY MODULE — Full structured storage + detail view
   ============================================================ */
const HISTORY_KEY = 'aiwa_history_v2';

/** Load history array from localStorage. */
function loadAnalysisHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

/** Persist history array to localStorage. */
function persistHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
  catch (e) { console.warn('localStorage write failed:', e); }
}

/**
 * Save a complete analysis snapshot to history.
 * Stores the full structured object — not just summary stats.
 * @param {object} analysis — result of analyzeText()
 * @param {object|null} improvedData — { improvedText, improvedAnalysis, changeMade } or null
 */
function saveAnalysisToHistory(analysis, improvedData = null) {
  const history = loadAnalysisHistory();
  const label   = analysis.text.slice(0, 80).trim().replace(/\s+/g, ' ') + (analysis.text.length > 80 ? '…' : '');
  const num     = history.length + 1;

  // Parse + store document structure for backward compatibility
  const originalDocument = parseDocument(analysis.text);

  const record = {
    id:           analysis.timestamp,
    num,
    label,
    date:         new Date(analysis.timestamp).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
    time:         new Date(analysis.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    // Original metrics (stored verbatim — never recalculated)
    originalText:     analysis.text,
    originalDocument, // ← structured document (new)
    wordCount:        analysis.wordCount,
    sentenceCount:    analysis.sentenceCount,
    paragraphCount:   analysis.paragraphs.length,
    finalScore:       analysis.finalScore,
    category:         analysis.category,
    rawScores:        analysis.rawScores,
    contributions:    analysis.contributions,
    features: {
      sentUniformityMean: analysis.features.sentenceUniformity.raw.mean,
      sentUniformityCV:   analysis.features.sentenceUniformity.raw.cv,
      lexRepScore:        analysis.features.lexicalRepetition.score,
      lexRepTopWords:     analysis.features.lexicalRepetition.raw.topWords,
      phraseRepScore:     analysis.features.phraseRepetition.score,
      phraseRepTop:       analysis.features.phraseRepetition.raw.topPhrases,
      structScore:        analysis.features.structuralConsistency.score,
      vocabTTR:           analysis.features.vocabularyDiversity.ttr,
      vocabScore:         analysis.features.vocabularyDiversity.score,
      burstScore:         analysis.features.burstiness.score,
      burstIndex:         analysis.features.burstiness.burstiness,
      punctScore:         analysis.features.punctuationVariation.score,
      punctVariety:       analysis.features.punctuationVariation.raw.variety,
      complexScore:       analysis.features.wordComplexity.score,
    },
    // Improved version — stored if Writing Improver was used
    hasImproved:      !!improvedData,
    improvedText:     improvedData?.improvedText || null,
    improvedScore:    improvedData?.improvedAnalysis?.finalScore ?? null,
    improvedFeatures: improvedData ? {
      sentUniformityCV: improvedData.improvedAnalysis.features.sentenceUniformity.raw.cv,
      lexRepScore:      improvedData.improvedAnalysis.features.lexicalRepetition.score,
      vocabTTR:         improvedData.improvedAnalysis.features.vocabularyDiversity.ttr,
      burstScore:       improvedData.improvedAnalysis.features.burstiness.score,
    } : null,
    changeMade: improvedData?.changeMade || [],
  };

  history.unshift(record);
  if (history.length > 25) history.pop();
  persistHistory(history);
  return record;
}

/** Update an existing history record with improved data. */
function updateHistoryWithImprovement(id, improvedData) {
  const history = loadAnalysisHistory();
  const idx = history.findIndex(h => h.id === id);
  if (idx === -1) return;
  history[idx].hasImproved     = true;
  history[idx].improvedText    = improvedData.improvedText;
  history[idx].improvedScore   = improvedData.improvedAnalysis.finalScore;
  history[idx].improvedFeatures = {
    sentUniformityCV: improvedData.improvedAnalysis.features.sentenceUniformity.raw.cv,
    lexRepScore:      improvedData.improvedAnalysis.features.lexicalRepetition.score,
    vocabTTR:         improvedData.improvedAnalysis.features.vocabularyDiversity.ttr,
    burstScore:       improvedData.improvedAnalysis.features.burstiness.score,
  };
  history[idx].changeMade = improvedData.changeMade;
  // Store all 3 candidates for full inspection from history detail view
  if (improvedData.allCandidates) {
    history[idx].allCandidates       = improvedData.allCandidates.map(c => ({
      candNum:      c.candNum,
      rankNum:      c.rankNum,
      qualityIndex: c.qualityIndex,
      qualityLabel: c.qualityLabel,
      strategy:     c.strategy,
      text:         c.text,
      finalScore:   c.analysis.finalScore,
      validation:   c.validation,
      // Store just the key feature scores — not the full analysis object (too large for localStorage)
      featureSnapshot: {
        lexRepScore:      Math.round(c.analysis.features.lexicalRepetition.score),
        phraseRepScore:   Math.round(c.analysis.features.phraseRepetition.score),
        sentUniformity:   Math.round(c.analysis.features.sentenceUniformity.score),
        burstScore:       Math.round(c.analysis.features.burstiness.score),
        vocabTTR:         Math.round(c.analysis.features.vocabularyDiversity.ttr * 100),
      },
    }));
    history[idx].chosenCandidateIdx = improvedData.chosenCandidateIdx ?? 0;
    history[idx].failsafeState      = improvedData.failsafeState ?? null;
  }
  persistHistory(history);
}

function deleteHistoryItem(id) {
  const history = loadAnalysisHistory().filter(h => h.id !== id);
  persistHistory(history);
  renderHistoryList();
}

/**
 * Show a custom confirm dialog instead of browser confirm().
 * Calls onConfirm if user clicks confirm.
 */
function showConfirm(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog" role="dialog" aria-modal="true">
      <h3>Konfirmasi</h3>
      <p>${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn btn-ghost" id="confirmCancel">Batal</button>
        <button class="btn btn-primary" style="background:var(--accent-red)" id="confirmOk">Hapus Semua</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#confirmCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#confirmOk').addEventListener('click', () => { overlay.remove(); onConfirm(); });
}

function deleteAllHistory() {
  showConfirm('Hapus seluruh riwayat analisis? Tindakan ini tidak dapat dibatalkan.', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistoryList();
    showToast('Semua riwayat telah dihapus.', 'info');
  });
}

/* ─── History List Render ────────────────────────────────── */

let _historySearchTerm = '';
let _historyFilter = 'newest';

/**
 * Render the history list with current search/filter state.
 */
function renderHistoryList() {
  const container = $('historyList');
  if (!container) return;

  // Always show list view, hide detail view
  $('historyListView')?.classList.remove('hidden');
  $('historyDetailView')?.classList.add('hidden');

  let history = loadAnalysisHistory();

  // Apply search
  if (_historySearchTerm) {
    const q = _historySearchTerm.toLowerCase();
    history = history.filter(h => h.label.toLowerCase().includes(q) || h.originalText?.toLowerCase().includes(q));
  }

  // Apply filter
  const catFilters = ['low','moderate','high','very-high'];
  if (catFilters.includes(_historyFilter)) {
    history = history.filter(h => h.category?.badge === _historyFilter);
  } else if (_historyFilter === 'oldest') {
    history = [...history].reverse();
  }
  // 'newest' is default (already newest-first from unshift)

  if (history.length === 0) {
    container.innerHTML = `<div class="empty-history">Belum ada riwayat${_historySearchTerm ? ' yang sesuai pencarian' : ''}. ${_historySearchTerm ? '' : 'Analisis teks pertama Anda untuk memulai.'}</div>`;
    return;
  }

  container.innerHTML = history.map((item, i) => `
    <div class="history-card" data-id="${item.id}" tabindex="0" role="button" aria-label="Buka analisis: ${escapeHtml(item.label.slice(0,50))}">
      <div class="history-card-top">
        <div>
          <div class="history-card-label">Analisis Teks #${item.num || (history.length - i)}</div>
          <div class="history-card-time">${item.date} · ${item.time}</div>
        </div>
        <div class="history-score-badge badge-${item.category?.badge || 'moderate'}">${item.finalScore}%</div>
      </div>
      <div class="history-card-stats">
        <span class="history-card-stat"><strong>${item.wordCount}</strong> kata</span>
        <span class="history-card-stat"><strong>${item.sentenceCount}</strong> kalimat</span>
        <span class="history-card-stat"><strong>${item.paragraphCount || '—'}</strong> paragraf</span>
        ${item.hasImproved ? `<span class="history-badge-improved">✦ Sudah diperbaiki</span>` : ''}
      </div>
      <div class="history-card-bottom">
        <span class="history-card-cta">Lihat Analisis →</span>
        <button class="history-card-del" data-del="${item.id}" aria-label="Hapus riwayat ini">Hapus</button>
      </div>
    </div>`).join('');

  // Card click → open detail
  container.querySelectorAll('.history-card').forEach(card => {
    // Click anywhere except the delete button
    card.addEventListener('click', e => {
      if (e.target.classList.contains('history-card-del')) return;
      openHistoryDetail(Number(card.dataset.id));
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openHistoryDetail(Number(card.dataset.id));
      }
    });
  });

  // Delete buttons
  container.querySelectorAll('.history-card-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteHistoryItem(Number(btn.dataset.del));
    });
  });
}

// Alias for navigation compatibility
const renderHistory = renderHistoryList;

/* ─── History Detail View ────────────────────────────────── */

/** Currently open history record (for re-analyze). */
let _openHistoryRecord = null;

/**
 * Open a history detail view for a given analysis ID.
 * Loads stored data — does NOT recalculate anything.
 */
function openHistoryDetail(id) {
  const record = loadAnalysisHistory().find(h => h.id === id);
  if (!record) { showToast('Riwayat tidak ditemukan.', 'error'); return; }
  _openHistoryRecord = record;

  $('historyListView').classList.add('hidden');
  $('historyDetailView').classList.remove('hidden');

  const f = record.features;
  const rows = [
    ['AI Writing Risk Score', record.finalScore + '%', ''],
    ['Keragaman Kosakata (TTR)', ((f.vocabTTR || 0) * 100).toFixed(1) + '%', ''],
    ['Variasi Kalimat (CV)',     ((f.sentUniformityCV || 0) * 100).toFixed(1) + '%', ''],
    ['Rata-rata Panjang Kalimat', (f.sentUniformityMean || 0) + ' kata', ''],
    ['Repetisi Kata', (f.lexRepScore || 0).toFixed(0) + '%', ''],
    ['Repetisi Frasa', (f.phraseRepScore || 0).toFixed(0) + '%', ''],
    ['Konsistensi Struktur', (f.structScore || 0).toFixed(0) + '%', ''],
    ['Burstiness Index', (f.burstIndex !== undefined ? f.burstIndex : '—'), ''],
    ['Variasi Tanda Baca', (f.punctVariety || 0) + ' jenis', ''],
  ];

  const metricsHtml = rows.map(([label, val]) => `
    <div style="display:flex;justify-content:space-between;padding:0.45rem 0;border-bottom:1px solid var(--border-color);font-size:0.82rem;">
      <span style="color:var(--text-secondary);">${label}</span>
      <strong style="color:var(--text-primary);">${val}</strong>
    </div>`).join('');

  // Contribution breakdown
  const contribLabels = {
    sentenceUniformity:'Keseragaman Kalimat', lexicalRepetition:'Repetisi Leksikal',
    phraseRepetition:'Repetisi Frasa', structuralConsistency:'Konsistensi Struktur',
    vocabularyDiversity:'Keragaman Kosakata', wordComplexity:'Kompleksitas Kata',
    punctuationVariation:'Variasi Tanda Baca', burstiness:'Burstiness',
  };
  const contribHtml = record.contributions ? Object.entries(record.contributions)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => `
      <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border-color);font-size:0.8rem;">
        <span style="color:var(--text-secondary);">${contribLabels[k]||k}</span>
        <strong style="color:var(--accent-gold);">${v.toFixed(2)} poin</strong>
      </div>`).join('') : '<p style="color:var(--text-muted);font-size:0.82rem;">Data tidak tersedia.</p>';

  // Improved section
  const improvedHtml = record.hasImproved ? `
    <div class="card" style="margin-top:0;background:var(--bg-card-alt);">
      <p class="hd-section-title">Teks Hasil Perbaikan</p>
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;flex-wrap:wrap;">
        <span style="font-size:0.88rem;color:var(--text-secondary);">Skor Asli: <strong>${record.finalScore}%</strong></span>
        <span style="color:var(--text-muted);">→</span>
        <span style="font-size:0.88rem;color:var(--accent-gold);">Setelah Perbaikan: <strong>${record.improvedScore}%</strong></span>
      </div>
      <div class="hd-text-block">${escapeHtml(record.improvedText)}</div>
      ${record.changeMade?.length ? `
        <p class="hd-section-title" style="margin-top:0.5rem;">Perubahan yang Dilakukan</p>
        ${record.changeMade.map(c => `<div style="font-size:0.8rem;color:var(--text-secondary);padding:0.25rem 0;">✓ ${escapeHtml(c)}</div>`).join('')}` : ''}
    </div>` : `<div class="card" style="margin-top:0;background:var(--bg-card-alt);">
      <p style="font-size:0.84rem;color:var(--text-muted);">Writing Improver belum digunakan pada analisis ini.</p>
    </div>`;

  $('historyDetailContent').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1rem;">
      <div class="card" style="margin-top:0;">
        <div class="history-detail-timestamp">Riwayat Analisis · Dianalisis pada ${record.date}, pukul ${record.time}</div>
        <div style="margin-top:0.75rem;">
          <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.3rem;">Kutipan teks</p>
          <div class="hd-text-block" style="max-height:120px;">${escapeHtml(record.originalText)}</div>
        </div>
        <div class="kpi-grid" style="margin-top:1rem;">
          <div class="kpi-card kpi-main">
            <p class="kpi-label">AI Writing Risk Score</p>
            <div class="kpi-score">${record.finalScore}%</div>
            <div class="kpi-badge badge-${record.category?.badge || 'moderate'}">${record.category?.label || ''}</div>
          </div>
          <div class="kpi-card"><p class="kpi-label">Jumlah Kata</p><div class="kpi-score kpi-neutral">${record.wordCount}</div></div>
          <div class="kpi-card"><p class="kpi-label">Jumlah Kalimat</p><div class="kpi-score kpi-neutral">${record.sentenceCount}</div></div>
          <div class="kpi-card"><p class="kpi-label">Paragraf</p><div class="kpi-score kpi-neutral">${record.paragraphCount || '—'}</div></div>
        </div>
      </div>
      <div class="card" style="margin-top:0;">
        <p class="hd-section-title">Metrik Utama</p>
        ${metricsHtml}
      </div>
      <div class="card" style="margin-top:0;">
        <p class="hd-section-title">Kontribusi Faktor Risiko</p>
        ${contribHtml}
      </div>
      <div><p class="hd-section-title" style="margin-bottom:0.5rem;">Teks Hasil Perbaikan</p>${improvedHtml}</div>
    </div>`;
}

/** Restore an old analysis as the current session (for "re-analyze" flow). */
function restoreAnalysisState(record) {
  // Navigate to analyze page and pre-fill text
  document.querySelector('.nav-item[data-page="analyze"]')?.click();
  setTimeout(() => {
    $('inputText').value = record.originalText;
    updateCounters(record.originalText);
    showToast('Teks dari riwayat telah dimuat. Klik "Analisis Teks" untuk menganalisis ulang.', 'info');
  }, 100);
}

/* ============================================================
   DASHBOARD REFRESH
   ============================================================ */
function refreshDashboard() {
  const area = $('dashKpiArea');
  if (!currentAnalysis) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">◎</div>
        <h3>Belum ada analisis</h3>
        <p>Belum ada teks yang dianalisis.<br>Masukkan tulisan Anda untuk melihat hasil analisis.</p>
        <button class="btn btn-primary" data-goto="analyze">Analisis Teks Sekarang</button>
      </div>`;
    area.querySelector('[data-goto]')?.addEventListener('click', () => {
      document.querySelector('.nav-item[data-page="analyze"]').click();
    });
    return;
  }
  const { finalScore, wordCount, sentenceCount, category } = currentAnalysis;
  area.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card kpi-main">
        <p class="kpi-label">AI Writing Risk Score</p>
        <div class="kpi-score">${finalScore}%</div>
        <div class="kpi-badge badge-${category.badge}">${category.label}</div>
        <p class="kpi-note">Skor estimasi risiko pola tulisan AI</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">Human-like Score</p>
        <div class="kpi-score kpi-human">${100 - finalScore}%</div>
        <p class="kpi-note">Indikasi pola tulisan manusia</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">Jumlah Kata</p>
        <div class="kpi-score kpi-neutral">${wordCount.toLocaleString('id-ID')}</div>
        <p class="kpi-note">Total kata dalam teks</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">Jumlah Kalimat</p>
        <div class="kpi-score kpi-neutral">${sentenceCount.toLocaleString('id-ID')}</div>
        <p class="kpi-note">Total kalimat dalam teks</p>
      </div>
    </div>
    <div style="margin-top:0.75rem;">
      <button class="btn btn-primary" data-goto="analyze">Lihat Detail Analisis →</button>
    </div>`;
  area.querySelector('[data-goto]')?.addEventListener('click', () => {
    document.querySelector('.nav-item[data-page="analyze"]').click();
  });
}

/* ============================================================
   INPUT HANDLERS
   ============================================================ */
function updateCounters(text) {
  const words = getWords(text).length;
  const chars = text.length;
  const sents = getSentences(text).length;
  $('wordCount').textContent = words;
  $('charCount').textContent = chars;
  $('sentCount').textContent = sents;
}

function validateInput(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    showError('Teks tidak boleh kosong. Silakan masukkan teks akademik Anda.');
    return false;
  }
  const words = getWords(trimmed).length;
  if (words < MIN_WORDS) {
    showError(`Teks terlalu pendek untuk dianalisis secara bermakna. Masukkan setidaknya ${MIN_WORDS} kata. (Saat ini: ${words} kata)`);
    return false;
  }
  return true;
}

function runAnalysis() {
  const text = $('inputText').value;
  clearError();
  if (!validateInput(text)) return;

  setStatus('analyzing', 'Menganalisis...');
  $('analyzeBtn').disabled = true;
  $('analyzeBtn').textContent = 'Menganalisis...';

  // Use setTimeout to let the UI update before heavy computation
  setTimeout(() => {
    try {
      const analysis = analyzeText(text.trim());
      currentAnalysis = analysis;

      // Show results area
      $('resultsArea').classList.remove('hidden');

      // Render all UI sections
      renderKPIs(analysis);
      renderMetrics(analysis);
      renderWhySection(analysis);
      renderInsightSection(analysis);
      renderAllCharts(analysis);
      // Render Rekomendasi Perbaikan (new feature)
      renderRekomendasi(analysis);
      // Reset Writing Improver output when new analysis is run
      $('improverPanels').classList.add('hidden');
      $('changeLog').classList.add('hidden');
      $('comparisonCard').classList.add('hidden');
      $('evaluasiCard').classList.add('hidden');

      // Save full structured record to history
      saveAnalysisToHistory(analysis);

      setStatus('done', 'Selesai');
      showToast('Analisis selesai!', 'success');
      $('resultsArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError('Terjadi kesalahan saat menganalisis teks. Pastikan teks Anda mengandung kalimat lengkap.');
      console.error('Analysis error:', err);
      setStatus('error', 'Error');
    } finally {
      $('analyzeBtn').disabled = false;
      $('analyzeBtn').textContent = 'Analisis Teks';
    }
  }, 50);
}

/* ============================================================
   UTILITY
   ============================================================ */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  initNavigation();

  // Live counters
  $('inputText').addEventListener('input', () => {
    updateCounters($('inputText').value);
    clearError();
    setStatus('idle', 'Siap');
  });

  // Analyze button
  $('analyzeBtn').addEventListener('click', runAnalysis);

  // Allow Ctrl+Enter to analyze
  $('inputText').addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') runAnalysis();
  });

  // Clear button
  $('clearBtn').addEventListener('click', () => {
    $('inputText').value = '';
    updateCounters('');
    clearError();
    $('resultsArea').classList.add('hidden');
    setStatus('idle', 'Siap');
    $('inputText').focus();
  });

  // File upload
  $('fileUpload').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.txt') && file.type !== 'text/plain') {
      showError('Format file tidak didukung. Unggah file dengan ekstensi .txt');
      $('fileUpload').value = '';
      return;
    }
    if (file.size > 500_000) {
      showError('File terlalu besar. Maksimum 500KB.');
      $('fileUpload').value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const text = ev.target.result;
        $('inputText').value = text;
        updateCounters(text);
        clearError();
        setStatus('idle', 'File dimuat');
      } catch {
        showError('Gagal membaca file. Pastikan file tidak rusak.');
      }
    };
    reader.onerror = () => showError('Gagal membaca file. Pastikan file tidak rusak.');
    reader.readAsText(file, 'UTF-8');
    $('fileUpload').value = '';
  });

  // Note: clearHistoryBtn is handled in the INIT EXTENSION listener below
}

document.addEventListener('DOMContentLoaded', init);

/* ============================================================
   MODULE: TOAST NOTIFICATIONS
   ============================================================ */

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
function showToast(message, type = 'info') {
  const container = $('toastContainer');
  const icons = { success: '✓', error: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type]}</span> ${escapeHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/* ============================================================
   MODULE: RECOMMENDATION ENGINE
   Generates structured, text-based recommendations from analysis.
   Each recommendation is derived from the actual measured features.
   ============================================================ */

/**
 * Generate improvement recommendations from an analysis object.
 * Returns an array of recommendation objects sorted by severity (high → low).
 *
 * @param {object} analysis — result of analyzeText()
 * @returns {Array<{title, severity, explanation, example, action}>}
 */
function generateRecommendations(analysis) {
  const { features, sentences, words } = analysis;
  const recs = [];

  // --- 1. Sentence Length ---
  const cv = features.sentenceUniformity.raw.cv;
  const mean = features.sentenceUniformity.raw.mean;
  if (cv < 0.2) {
    const exSent = sentences.slice(0, 2).map(s => s.slice(0, 60)).join(' / ');
    recs.push({
      title: 'Variasi Panjang Kalimat Sangat Rendah',
      severity: 'high',
      explanation: `Hampir semua kalimat memiliki panjang yang sangat mirip (rata-rata ${mean} kata, koefisien variasi: ${(cv * 100).toFixed(1)}%). Ritme tulisan terasa mekanistis dan seragam.`,
      example: exSent ? `Contoh: "${escapeHtml(exSent)}..."` : '',
      action: 'Gabungkan beberapa kalimat pendek dan pecah beberapa kalimat panjang. Targetkan campuran kalimat 5–10 kata, 11–20 kata, dan 21+ kata.',
    });
  } else if (cv < 0.35) {
    recs.push({
      title: 'Variasi Panjang Kalimat Kurang Optimal',
      severity: 'medium',
      explanation: `Variasi panjang kalimat masih tergolong terbatas (CV: ${(cv * 100).toFixed(1)}%). Tulisan akan lebih dinamis dengan variasi yang lebih besar.`,
      example: '',
      action: 'Coba sisipkan beberapa kalimat pendek di antara kalimat-kalimat panjang untuk menciptakan ritme yang lebih natural.',
    });
  }

  // --- 2. Sentence Variation (burstiness) ---
  if (features.burstiness.score > 65) {
    recs.push({
      title: 'Struktur Kalimat Terlalu Seragam',
      severity: 'medium',
      explanation: 'Distribusi panjang kalimat menunjukkan pola yang sangat halus dan teratur. Tulisan manusia biasanya memiliki variasi "meledak" yang lebih alami.',
      example: '',
      action: 'Variasikan tidak hanya panjang, tetapi juga pola struktur kalimat: kalimat sederhana, kalimat majemuk, dan kalimat kompleks.',
    });
  }

  // --- 3. Vocabulary Diversity ---
  const ttr = features.vocabularyDiversity.ttr;
  if (ttr < 0.45) {
    const topWords = features.lexicalRepetition.raw.topWords?.slice(0, 3).map(w => `"${w[0]}" (${w[1]}×)`).join(', ');
    recs.push({
      title: 'Keragaman Kosakata Rendah',
      severity: 'high',
      explanation: `Rasio kata unik (TTR) sebesar ${(ttr * 100).toFixed(1)}% menunjukkan kosakata yang relatif terbatas. Banyak kata signifikan diulang berulang kali.`,
      example: topWords ? `Kata paling sering: ${topWords}` : '',
      action: 'Gunakan sinonim, parafrase, atau restrukturisasi kalimat untuk mengurangi pengulangan kata yang sama.',
    });
  } else if (ttr < 0.58) {
    recs.push({
      title: 'Keragaman Kosakata Bisa Ditingkatkan',
      severity: 'low',
      explanation: `TTR ${(ttr * 100).toFixed(1)}% — keragaman kosakata sudah cukup baik, namun masih ada ruang untuk meningkatkan variasi ekspresi.`,
      example: '',
      action: 'Pertimbangkan menggunakan variasi istilah, sinonim akademik, atau konstruksi kalimat alternatif di beberapa bagian.',
    });
  }

  // --- 4. Lexical Repetition ---
  if (features.lexicalRepetition.score >= 55) {
    const top = features.lexicalRepetition.raw.topWords?.[0];
    recs.push({
      title: 'Pengulangan Kata Signifikan Terlalu Tinggi',
      severity: features.lexicalRepetition.score >= 70 ? 'high' : 'medium',
      explanation: `${(features.lexicalRepetition.raw.repRatio * 100).toFixed(1)}% dari token bermakna dalam teks merupakan pengulangan kata yang sudah pernah muncul sebelumnya.`,
      example: top ? `Kata "${top[0]}" muncul ${top[1]} kali dalam teks.` : '',
      action: 'Identifikasi kata-kata kunci yang paling sering berulang, lalu ganti sebagian kemunculannya dengan sinonim atau parafrase.',
    });
  }

  // --- 5. Phrase Repetition ---
  if (features.phraseRepetition.score >= 45) {
    const topPhrase = features.phraseRepetition.raw.topPhrases?.[0];
    recs.push({
      title: 'Frasa Berulang Terdeteksi',
      severity: features.phraseRepetition.score >= 65 ? 'high' : 'medium',
      explanation: `Beberapa pasangan kata (bigram) muncul berulang kali secara konsisten dalam teks, menciptakan pola yang terlalu teratur.`,
      example: topPhrase ? `Frasa "${topPhrase[0]}" muncul ${topPhrase[1]} kali.` : '',
      action: 'Susun ulang kalimat-kalimat yang mengandung frasa berulang agar variasi ekspresi meningkat.',
    });
  }

  // --- 6. Paragraph Structure ---
  if (features.structuralConsistency.score >= 70 && analysis.paragraphs.length >= 3) {
    recs.push({
      title: 'Konsistensi Struktur Paragraf Terlalu Tinggi',
      severity: 'medium',
      explanation: `${analysis.paragraphs.length} paragraf memiliki panjang yang sangat mirip (CV: ${features.structuralConsistency.raw.cv}). Variasi panjang paragraf yang natural menunjukkan kedalaman pembahasan yang berbeda-beda.`,
      example: '',
      action: 'Biarkan panjang paragraf mencerminkan kedalaman ide: paragraf pendek untuk penekanan, paragraf panjang untuk elaborasi mendalam.',
    });
  }

  // --- 7. Punctuation Patterns ---
  if (features.punctuationVariation.score >= 65) {
    recs.push({
      title: 'Variasi Tanda Baca Terbatas',
      severity: 'low',
      explanation: `Hanya ${features.punctuationVariation.raw.variety} jenis tanda baca yang digunakan. Tulisan yang natural dan ekspresif biasanya menggunakan variasi tanda baca yang lebih beragam.`,
      example: '',
      action: 'Pertimbangkan penggunaan tanda baca yang lebih beragam: titik koma (;), tanda hubung (—), tanda kurung, atau titik dua (:) untuk menambahkan ritme dan penekanan.',
    });
  }

  // --- 8. Writing Flow (sentence connection) ---
  const longSentCount = sentences.filter(s => s.split(/\s+/).length > 30).length;
  if (longSentCount > sentences.length * 0.3) {
    recs.push({
      title: 'Terlalu Banyak Kalimat Sangat Panjang',
      severity: 'medium',
      explanation: `${longSentCount} dari ${sentences.length} kalimat (${Math.round(longSentCount / sentences.length * 100)}%) memiliki lebih dari 30 kata. Kalimat sangat panjang dapat mengurangi keterbacaan.`,
      example: sentences.find(s => s.split(/\s+/).length > 30)?.slice(0, 80) + '...',
      action: 'Pecah kalimat yang melebihi 30 kata menjadi dua atau lebih kalimat yang lebih jelas dan terfokus.',
    });
  }

  // --- 9. Word Complexity ---
  if (features.wordComplexity.score >= 60) {
    recs.push({
      title: 'Proporsi Kata Panjang Sangat Tinggi',
      severity: 'low',
      explanation: `${(features.wordComplexity.ratio * 100).toFixed(1)}% kata dalam teks memiliki lebih dari 7 karakter secara merata. Campuran kata pendek dan panjang memberikan ritme yang lebih natural.`,
      example: '',
      action: 'Ganti beberapa kata teknis panjang dengan padanan yang lebih sederhana jika tidak mengorbankan makna akademik.',
    });
  }

  // --- 10. Academic Phrase Overuse ---
  const highRep = analysis.academic?.filter(a => a.count >= 3) || [];
  if (highRep.length >= 2) {
    recs.push({
      title: 'Frasa Transisi Akademik Berulang',
      severity: 'medium',
      explanation: `${highRep.length} frasa transisi akademik muncul terlalu sering: ${highRep.slice(0, 3).map(a => `"${a.phrase}" (${a.count}×)`).join(', ')}.`,
      example: '',
      action: 'Variasikan frasa penghubung dan transisi — gunakan berbagai ekspresi untuk hubungan logika yang sama.',
    });
  }

  // Sort: high → medium → low
  const sevOrder = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return recs;
}

/* ============================================================
   MODULE: RECOMMENDATION RENDERER
   ============================================================ */
function renderRekomendasi(analysis) {
  const container = $('rekomendasiSection');
  const recs = generateRecommendations(analysis);

  if (recs.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:1.5rem 1rem;">
        <div class="empty-icon" style="font-size:2rem;">✓</div>
        <h3 style="font-size:0.95rem;">Tulisan sudah cukup baik</h3>
        <p>Tidak ada masalah signifikan yang terdeteksi pada teks Anda.</p>
      </div>`;
    return;
  }

  const sevLabel = { high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };
  const html = `<div class="rekom-list">${recs.map(r => `
    <div class="rekom-item sev-${r.severity}">
      <div class="rekom-item-header">
        <span class="sev-badge ${r.severity}">${sevLabel[r.severity]}</span>
        <span class="rekom-title">${r.title}</span>
      </div>
      <p class="rekom-explanation">${r.explanation}</p>
      ${r.example ? `<div class="rekom-example">${r.example}</div>` : ''}
      <div class="rekom-action">${r.action}</div>
    </div>`).join('')}
  </div>`;

  container.innerHTML = html;
}

/* ============================================================
   MODULE: WRITING IMPROVEMENT ENGINE v4
   ============================================================

   Architecture: DIAGNOSE → TARGET → REVISE → RECHECK → ACCEPT/REJECT
   Philosophy:   Minimum necessary intervention. Preserve author voice.
                 Write quality is the primary objective — not detector scores.

   Key principles:
   - Every sentence is individually classified (KEEP/REVISE_LIGHT/MODERATE/STRONG)
   - Revisions only applied where a measurable problem exists
   - 3 candidates use genuinely different strategies (not just threshold variation)
   - Semantic preservation is checked: key nouns, numbers, names are never changed
   - Natural Writing Quality Score is holistic: not just AI risk delta
   - Transition words are REMOVED when overused, never injected
   - Sentence combining is allowed only when two very short sentences are clearly related
   - Opening variation uses clause reordering, not just word stripping

   API integration point (future):
   Replace applySentenceRevision() with a language model call.
   The classify → validate → rank loop is API-agnostic.
   ============================================================ */

/* ──────────────────────────────────────────────────────────────────
   CONSTANTS
   ────────────────────────────────────────────────────────────────── */

/**
 * Synonym map — ONLY non-technical, high-frequency generic words.
 * Synonyms are verified to be contextually interchangeable in academic prose.
 * Academic terminology (penelitian, analisis, teori, metode…) intentionally absent.
 */
const SYNONYM_MAP = {
  // Indonesian generic verbs & adjectives
  'menunjukkan':   ['mengindikasikan','memperlihatkan','mencerminkan'],
  'merupakan':     ['adalah','menjadi'],
  'terdapat':      ['ditemukan','dijumpai'],
  'dilakukan':     ['dijalankan','dilaksanakan'],
  'diperoleh':     ['didapatkan','dihasilkan'],
  'dapat':         ['mampu','bisa'],
  'sangat':        ['amat'],
  'banyak':        ['sejumlah','berbagai'],
  'menggunakan':   ['memanfaatkan','menerapkan'],
  'memberikan':    ['menyediakan','menawarkan'],
  'penting':       ['signifikan','esensial'],
  'proses':        ['prosedur','mekanisme'],
  'faktor':        ['aspek','elemen'],
  'kegiatan':      ['aktivitas','upaya'],
  'masalah':       ['persoalan','tantangan'],
  'tujuan':        ['sasaran','maksud'],
  'kualitas':      ['mutu','standar'],
  'melalui':       ['lewat'],
  'mempengaruhi':  ['berdampak pada','memengaruhi'],
  'berkaitan':     ['berhubungan','terkait'],
  'menjelaskan':   ['memaparkan','menguraikan'],
  'berbagai':      ['beragam','sejumlah'],
  'seperti':       ['antara lain','misalnya'],
  // English generic verbs & adjectives
  'shows':     ['indicates','demonstrates'],
  'uses':      ['employs','applies'],
  'provides':  ['offers','supplies'],
  'found':     ['identified','detected'],
  'important': ['significant','essential'],
  'many':      ['numerous','several'],
  'also':      ['additionally'],
  'however':   ['nevertheless','yet'],
  'therefore': ['consequently','thus'],
  'because':   ['since','given that'],
  'suggests':  ['implies','indicates'],
  'allows':    ['enables','permits'],
  'creates':   ['produces','generates'],
};

/**
 * Overused transition patterns to detect and potentially remove.
 * These are classified as filler when they appear too frequently.
 */
const TRANSITION_PATTERNS = [
  // Indonesian
  { re: /^hal ini\b/i,           label: 'hal ini' },
  { re: /^oleh karena itu[,\s]/i,label: 'oleh karena itu' },
  { re: /^dengan demikian[,\s]/i,label: 'dengan demikian' },
  { re: /^selain itu[,\s]/i,     label: 'selain itu' },
  { re: /^selanjutnya[,\s]/i,    label: 'selanjutnya' },
  { re: /^pada akhirnya[,\s]/i,  label: 'pada akhirnya' },
  { re: /^di sisi lain[,\s]/i,   label: 'di sisi lain' },
  { re: /^lebih lanjut[,\s]/i,   label: 'lebih lanjut' },
  { re: /^sebagai tambahan[,\s]/i,label: 'sebagai tambahan' },
  { re: /^dalam hal ini[,\s]/i,  label: 'dalam hal ini' },
  { re: /^perlu dicatat[,\s]/i,  label: 'perlu dicatat' },
  // English
  { re: /^furthermore[,\s]/i,    label: 'furthermore' },
  { re: /^additionally[,\s]/i,   label: 'additionally' },
  { re: /^moreover[,\s]/i,       label: 'moreover' },
  { re: /^however[,\s]/i,        label: 'however' },
  { re: /^therefore[,\s]/i,      label: 'therefore' },
  { re: /^in addition[,\s]/i,    label: 'in addition' },
  { re: /^as a result[,\s]/i,    label: 'as a result' },
  { re: /^it is important[,\s]/i,label: 'it is important' },
];

/* ──────────────────────────────────────────────────────────────────
   SENTENCE DIAGNOSIS SYSTEM
   ────────────────────────────────────────────────────────────────── */

/**
 * Classify each sentence into a revision urgency tier.
 *
 * KEEP           — sentence is already strong; do not touch it
 * REVISE_LIGHT   — one minor issue (opening repetition OR one overused word)
 * REVISE_MODERATE— two issues or a structural pattern problem
 * REVISE_STRONG  — multiple problems; sentence genuinely needs work
 *
 * @returns {Array<{idx, sentence, tier, issues: string[]}>}
 */
function classifySentences(sentences, wordFreq) {
  const n          = sentences.length;
  const lengths    = sentences.map(s => s.split(/\s+/).filter(w=>w).length);
  const mean       = n > 0 ? lengths.reduce((a,b)=>a+b,0)/n : 0;
  const totalWords = Object.values(wordFreq).reduce((a,b)=>a+b,0);

  // Build opening-word frequency map (ignoring stop words)
  const openingFreq = {};
  sentences.forEach(s => {
    const fw = s.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (fw && !STOP_WORDS.has(fw)) openingFreq[fw] = (openingFreq[fw]||0) + 1;
  });

  // Detect transition openings per sentence
  const transitionCounts = {};
  sentences.forEach(s => {
    const s_lc = s.toLowerCase().trim();
    TRANSITION_PATTERNS.forEach(tp => {
      if (tp.re.test(s_lc)) transitionCounts[tp.label] = (transitionCounts[tp.label]||0) + 1;
    });
  });

  return sentences.map((sentence, idx) => {
    const issues = [];
    const wc     = lengths[idx];
    const s_lc   = sentence.toLowerCase().trim();

    // Issue 1: sentence length far from mean (either very long or very short relative to context)
    if (wc > 35) issues.push('too_long');
    if (wc < 5 && n > 3) issues.push('too_short');

    // Issue 2: word length close to too many neighbors (uniformity contribution)
    // Check if ±2 neighbors have within ±20% word count — indicates local uniformity cluster
    const neighbors = [idx-2, idx-1, idx+1, idx+2].filter(i=>i>=0&&i<n);
    const similarNeighbors = neighbors.filter(i => Math.abs(lengths[i] - wc) / Math.max(1, wc) < 0.2);
    if (similarNeighbors.length >= 3) issues.push('uniform_cluster');

    // Issue 3: repeated opening word (used ≥3 times globally)
    const fw = sentence.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (fw && !STOP_WORDS.has(fw) && (openingFreq[fw]||0) >= 3) issues.push('repeated_opening');

    // Issue 4: contains overused non-technical words
    const wordTokens = s_lc.match(/[a-zà-ÿ]{4,}/g) || [];
    const hasOverusedWord = wordTokens.some(w => {
      if (!SYNONYM_MAP[w]) return false;
      const rate = (wordFreq[w]||0) / Math.max(1, totalWords) * 100;
      return rate >= 2.0 && (wordFreq[w]||0) >= 3;
    });
    if (hasOverusedWord) issues.push('overused_word');

    // Issue 5: opens with a filler transition that is overused globally
    const matchedTransition = TRANSITION_PATTERNS.find(tp => tp.re.test(s_lc));
    if (matchedTransition && (transitionCounts[matchedTransition.label]||0) >= 2) {
      issues.push('overused_transition');
    }

    // Issue 6: redundant phrase — sentence contains a bigram that is over-repeated
    // (piggyback on word freq: detect two consecutive content words both overused)
    const tokens4plus = wordTokens.filter(w => w.length >= 4 && !STOP_WORDS.has(w));
    const redundantBigram = tokens4plus.some((w, i) => {
      if (i === 0) return false;
      const w2 = tokens4plus[i-1];
      const r1 = (wordFreq[w]||0) / Math.max(1, totalWords) * 100;
      const r2 = (wordFreq[w2]||0) / Math.max(1, totalWords) * 100;
      return r1 >= 2.0 && r2 >= 2.0;
    });
    if (redundantBigram) issues.push('redundant_phrase');

    // Tier assignment
    let tier;
    if (issues.length === 0) {
      tier = 'KEEP';
    } else if (issues.length === 1) {
      tier = 'REVISE_LIGHT';
    } else if (issues.length <= 3) {
      tier = 'REVISE_MODERATE';
    } else {
      tier = 'REVISE_STRONG';
    }

    return { idx, sentence, tier, issues, wc };
  });
}

/**
 * Check whether a sentence already starts with a known transition marker.
 */
function hasLeadingTransition(sentence) {
  const s = sentence.toLowerCase().trim();
  return TRANSITION_PATTERNS.some(tp => tp.re.test(s));
}

/**
 * Detect measurable writing problems in a text.
 * Returns a structured report for UI display and candidate generation.
 * Kept for backwards compatibility with the analysis pipeline.
 */
function analyzeWritingPatterns(sentences, wordFreq) {
  const lengths  = sentences.map(s => s.split(/\s+/).filter(w=>w).length);
  const mean     = lengths.length > 0 ? lengths.reduce((a,b)=>a+b,0)/lengths.length : 0;
  const variance = lengths.length > 0 ? lengths.reduce((s,l)=>s+(l-mean)**2,0)/lengths.length : 0;
  const cv       = mean > 0 ? Math.sqrt(variance)/mean : 0;
  const totalWords = Object.values(wordFreq).reduce((a,b)=>a+b,0);

  const problems = [];

  if (cv < 0.30) {
    problems.push({
      code: 'uniform_length',
      severity: Math.max(0, (0.30 - cv) / 0.30),
      detail: `Koefisien variasi panjang kalimat sangat rendah (${(cv*100).toFixed(1)}%).`,
      affectedIndices: [],
    });
  }

  // Repeated openings (≥3 identical first-word)
  const firstWords = {};
  sentences.forEach((s, i) => {
    const fw = s.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (!fw || STOP_WORDS.has(fw)) return;
    if (!firstWords[fw]) firstWords[fw] = [];
    firstWords[fw].push(i);
  });
  Object.entries(firstWords).forEach(([word, indices]) => {
    if (indices.length >= 3) {
      problems.push({
        code: 'repeated_opening',
        severity: indices.length / sentences.length,
        detail: `Kata pembuka "${word}" muncul ${indices.length} kali sebagai pembuka kalimat.`,
        affectedIndices: indices,
        word,
      });
    }
  });

  // Overused transition expressions
  const transCounts = {};
  sentences.forEach((s, i) => {
    const s_lc = s.toLowerCase().trim();
    TRANSITION_PATTERNS.forEach(tp => {
      if (tp.re.test(s_lc)) {
        if (!transCounts[tp.label]) transCounts[tp.label] = { count: 0, indices: [] };
        transCounts[tp.label].count++;
        transCounts[tp.label].indices.push(i);
      }
    });
  });
  Object.entries(transCounts).forEach(([label, {count, indices}]) => {
    if (count >= 2) {
      problems.push({
        code: 'overused_transition',
        severity: count / sentences.length,
        detail: `Transisi "${label}" muncul ${count} kali.`,
        affectedIndices: indices,
        word: label,
        count,
      });
    }
  });

  // Overused non-technical words
  Object.entries(wordFreq).forEach(([word, count]) => {
    if (STOP_WORDS.has(word) || word.length <= 3) return;
    if (!SYNONYM_MAP[word]) return;
    const rate = count / totalWords * 100;
    if (rate >= 2.5 && count >= 4) {
      const affectedIndices = sentences.reduce((acc,s,i) => {
        if (s.toLowerCase().includes(word)) acc.push(i);
        return acc;
      }, []);
      problems.push({
        code: 'repeated_word',
        severity: Math.min(1, (rate-2.5)/5),
        detail: `Kata "${word}" muncul ${count} kali (${rate.toFixed(1)}% dari teks).`,
        affectedIndices, word, count,
      });
    }
  });

  // Very long sentences (>35 words)
  const longIndices = lengths.reduce((acc,l,i) => { if (l>35) acc.push(i); return acc; }, []);
  if (longIndices.length > 0 && longIndices.length/sentences.length > 0.20) {
    problems.push({
      code: 'too_long',
      severity: longIndices.length/sentences.length,
      detail: `${longIndices.length} kalimat memiliki lebih dari 35 kata.`,
      affectedIndices: longIndices,
    });
  }

  return { cv, mean, problems };
}

/* ──────────────────────────────────────────────────────────────────
   REVISION STRATEGIES (A–J)
   Each is a pure function: sentence → revised sentence (or null if no change).
   ────────────────────────────────────────────────────────────────── */

/**
 * Strategy B — Split a genuinely long sentence at a natural syntactic boundary.
 * Returns [sentence] (unchanged) or [part1, part2].
 */
function strategySplitSentence(sentence) {
  const words = sentence.split(/\s+/);
  if (words.length <= 28) return [sentence];

  const midStart = Math.floor(words.length * 0.38);
  const midEnd   = Math.floor(words.length * 0.68);

  const clauseMarkers = /^(namun|tetapi|sedangkan|sehingga|karena|walaupun|meskipun|dan|but|however|although|therefore|because|while|whereas|so|yang|bahwa|agar|supaya)$/i;

  for (let i = midStart; i <= midEnd; i++) {
    const word = words[i].replace(/[,;]$/, '').toLowerCase();
    if (clauseMarkers.test(word)) {
      const first  = words.slice(0, i).join(' ').replace(/[,;]+$/, '').trim();
      const second = words.slice(i + 1).join(' ').trim();
      if (first.split(/\s+/).length >= 7 && second.split(/\s+/).length >= 7) {
        const f = first.endsWith('.') ? first : first + '.';
        const s = second.charAt(0).toUpperCase() + second.slice(1);
        return [f, s.endsWith('.') ? s : s + '.'];
      }
    }
  }

  // Try splitting at a mid-sentence comma
  for (let i = midStart; i <= midEnd; i++) {
    if (words[i].endsWith(',')) {
      const first  = words.slice(0, i+1).join(' ').trim();
      const second = words.slice(i+1).join(' ').trim();
      if (first.split(/\s+/).length >= 7 && second.split(/\s+/).length >= 7) {
        const f = first.replace(/,$/, '.').trim();
        const s = second.charAt(0).toUpperCase() + second.slice(1);
        return [f, s.endsWith('.') ? s : s + '.'];
      }
    }
  }
  return [sentence];
}

/**
 * Strategy C — Combine two short adjacent sentences.
 * Only applies when both are < 8 words, to avoid raising sentence-length uniformity.
 * Returns the combined string, or null if not appropriate.
 */
function strategyCombineSentences(s1, s2) {
  const w1 = s1.trim().split(/\s+/).length;
  const w2 = s2.trim().split(/\s+/).length;
  if (w1 > 8 || w2 > 8) return null;          // only combine genuinely short pairs
  if (w1 + w2 > 20) return null;               // combined must still be readable
  const base = s1.trim().replace(/[.!?]+$/, '');
  // Use a contextually neutral connector
  return base + ', sehingga ' + s2.trim().charAt(0).toLowerCase() + s2.trim().slice(1);
}

/**
 * Strategy D — Remove redundant occurrences.
 * Given the sentence and a set of overused words, reduce one occurrence per sentence
 * by substituting with a synonym (gap-checked).
 */
function strategyReduceRedundancy(sentence, wordFreq, lastReplacedAt, sentIdx, minFreq, minGap) {
  const tokens = sentence.split(/(\s+|(?=[.,;:!?()—–"'])|(?<=[.,;:!?()—–"']))/);
  let changeCount = 0;
  const maxPerSent = 2;

  const result = tokens.map(token => {
    if (changeCount >= maxPerSent) return token;
    const lower = token.toLowerCase();
    if (!lower.match(/^[a-zà-ÿ]{4,}$/) || STOP_WORDS.has(lower)) return token;
    const syns = SYNONYM_MAP[lower];
    if (!syns || syns.length === 0) return token;
    const freq = wordFreq[lower] || 0;
    if (freq < minFreq) return token;

    const lastIdx = lastReplacedAt[lower] ?? -999;
    if (sentIdx - lastIdx < minGap) return token;

    const useCount = (lastReplacedAt['__' + lower + '_count'] || 0);
    const syn = syns[useCount % syns.length];
    lastReplacedAt[lower]  = sentIdx;
    lastReplacedAt['__' + lower + '_count'] = useCount + 1;
    changeCount++;

    const isCap = token[0] === token[0].toUpperCase() && token[0].match(/[A-ZÀ-Ÿ]/);
    return isCap ? syn.charAt(0).toUpperCase() + syn.slice(1) : syn;
  });
  return result.join('');
}

/**
 * Strategy E — Change sentence opening.
 * Attempts to restructure the sentence so it begins differently.
 * Operates only on occurrences 2, 3, 4+ of a repeated opener.
 * Does NOT merely strip the first word — tries to invert clause order.
 */
function strategyChangeOpening(sentence, occurrenceNum) {
  if (occurrenceNum < 1) return sentence; // keep first occurrence unchanged
  const s = sentence.trim();
  const words = s.split(/\s+/);
  if (words.length < 6) return sentence;

  // Look for a comma-separated clause we can move to front
  const commaIdx = words.findIndex((w, i) => i >= 3 && i <= words.length - 4 && w.endsWith(','));
  if (commaIdx > 0) {
    const back   = words.slice(0, commaIdx + 1).join(' ');
    const front  = words.slice(commaIdx + 1).join(' ');
    if (front.split(/\s+/).length >= 4 && back.split(/\s+/).length >= 3) {
      // "X, Y" → "Y X"
      const newFront = front.trim().replace(/[.!?]+$/, '');
      const newBack  = back.trim().replace(/,$/, '');
      const combined = newFront.charAt(0).toUpperCase() + newFront.slice(1) + ', ' + newBack.charAt(0).toLowerCase() + newBack.slice(1);
      if (!combined.endsWith('.')) return combined + '.';
      return combined;
    }
  }

  // Fallback: remove only a known filler opener and capitalise the remainder
  const lc = s.toLowerCase();
  const fillerPhrases = [
    'hal ini menunjukkan bahwa ', 'hal ini mengindikasikan bahwa ', 'hal ini memperlihatkan bahwa ',
    'hal ini adalah ', 'hal ini merupakan ',
  ];
  for (const fp of fillerPhrases) {
    if (lc.startsWith(fp)) {
      const rest = s.slice(fp.length);
      if (rest.split(/\s+/).length >= 4) {
        return rest.charAt(0).toUpperCase() + rest.slice(1);
      }
    }
  }

  // Fallback 2: drop the first repeated-opener word if rest is meaningful
  const rest = s.replace(/^\S+\s+/, '');
  const restWords = rest.split(/\s+/).filter(w=>w);
  if (restWords.length >= 5) {
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  return sentence; // cannot safely restructure
}

/**
 * Strategy F — Remove an unnecessary transition opener.
 * "Selain itu, X" → "X" when the transition is redundant.
 * Only removes transitions that appear ≥2 times in the text.
 */
function strategyRemoveTransition(sentence, transitionLabel) {
  const s = sentence.trim();
  const lc = s.toLowerCase();
  const tp = TRANSITION_PATTERNS.find(t => lc.startsWith(t.re.source
    .replace('^','').replace(/\[,\\s\].*/,'').replace(/\\/g,'')));

  // Simpler: just match on the label text
  const labelLc = transitionLabel.toLowerCase();
  if (!lc.startsWith(labelLc)) return sentence;

  // Remove transition + following comma/space
  const afterTransition = s.slice(transitionLabel.length).replace(/^[,\s]+/, '');
  if (!afterTransition || afterTransition.split(/\s+/).length < 3) return sentence;

  return afterTransition.charAt(0).toUpperCase() + afterTransition.slice(1);
}

/**
 * Strategy G — Reorder clauses within a sentence while preserving meaning.
 * Moves a trailing participial or conditional clause to the front.
 */
function strategyReorderClauses(sentence) {
  const s = sentence.trim();
  const words = s.split(/\s+/);
  if (words.length < 10 || words.length > 40) return sentence;

  // Look for sentences with a trailing conditional: "... karena X" or "... meskipun X"
  const subordinators = ['karena','sehingga','meskipun','walaupun','agar','supaya','jika','apabila','although','because','since','if','so that'];
  for (const sub of subordinators) {
    const subIdx = words.map(w => w.toLowerCase().replace(/[,;]/,'')).lastIndexOf(sub);
    if (subIdx > Math.floor(words.length * 0.5) && subIdx < words.length - 4) {
      const main   = words.slice(0, subIdx).join(' ').replace(/[,;.]+$/, '');
      const clause = words.slice(subIdx).join(' ').replace(/[.!?]+$/, '');
      if (main.split(/\s+/).length >= 5 && clause.split(/\s+/).length >= 4) {
        const result = clause.charAt(0).toUpperCase() + clause.slice(1) + ', ' + main.charAt(0).toLowerCase() + main.slice(1) + '.';
        return result;
      }
    }
  }
  return sentence;
}

/* ──────────────────────────────────────────────────────────────────
   CANDIDATE GENERATION (3 meaningfully different strategies)
   ────────────────────────────────────────────────────────────────── */

/**
 * Candidate 1 — MINIMAL REVISION
 * Changes only the most obvious problems.
 * Default is KEEP for all sentences unless the issue is clear.
 * Strategies used: D (light redundancy), E (opening rotation 2nd+ only), F (transitions ≥3)
 */
function generateCandidateMinimal(sentences, classification, wordFreq, transitionCounts) {
  const lastReplacedAt = {};
  const changeLog = { synonymsReplaced: 0, transitionsRemoved: 0, openingsVaried: 0,
                      sentencesSplit: 0, sentencesCombined: 0, keptSentences: 0 };

  // Track opening occurrence counters
  const openingOccurrences = {};

  const result = [];
  let i = 0;
  while (i < sentences.length) {
    const cl = classification[i];
    const sentence = sentences[i];

    // Count opening occurrence
    const fw = sentence.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (!STOP_WORDS.has(fw)) openingOccurrences[fw] = (openingOccurrences[fw]||0) + 1;
    const occNum = (openingOccurrences[fw]||1) - 1; // 0-based

    let s = sentence;
    let changed = false;

    if (cl.tier === 'KEEP') {
      changeLog.keptSentences++;
    } else {
      // Strategy E: rotate opening ONLY if appears ≥3 times and this is occurrence ≥2
      if (cl.issues.includes('repeated_opening') && occNum >= 1) {
        const revised = strategyChangeOpening(s, occNum);
        if (revised !== s) { s = revised; changeLog.openingsVaried++; changed = true; }
      }

      // Strategy D: reduce ONE overused word per sentence (conservative: minFreq=5, gap=3)
      if (cl.issues.includes('overused_word') && !changed) {
        const revised = strategyReduceRedundancy(s, wordFreq, lastReplacedAt, i, 5, 3);
        if (revised !== s) { s = revised; changeLog.synonymsReplaced++; changed = true; }
      }

      // Strategy F: remove transition ONLY if used ≥3 times (very conservative)
      if (cl.issues.includes('overused_transition')) {
        const tp = TRANSITION_PATTERNS.find(p => p.re.test(s.toLowerCase().trim()));
        if (tp && (transitionCounts[tp.label]||0) >= 3) {
          const revised = strategyRemoveTransition(s, tp.label);
          if (revised !== s) { s = revised; changeLog.transitionsRemoved++; changed = true; }
        }
      }

      if (!changed) changeLog.keptSentences++;
    }

    result.push(s);
    i++;
  }

  return { text: result.join(' '), changeLog };
}

/**
 * Candidate 2 — BALANCED REVISION
 * Improves rhythm, repetition, and transitions while maintaining author voice.
 * Strategies: D (moderate), E (opening), F (transitions ≥2), B (very long sentences only)
 */
function generateCandidateBalanced(sentences, classification, wordFreq, transitionCounts) {
  const lastReplacedAt = {};
  const changeLog = { synonymsReplaced: 0, transitionsRemoved: 0, openingsVaried: 0,
                      sentencesSplit: 0, sentencesCombined: 0, keptSentences: 0 };

  const openingOccurrences = {};
  const result = [];
  let i = 0;

  while (i < sentences.length) {
    const cl = classification[i];
    const sentence = sentences[i];

    const fw = sentence.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (!STOP_WORDS.has(fw)) openingOccurrences[fw] = (openingOccurrences[fw]||0) + 1;
    const occNum = (openingOccurrences[fw]||1) - 1;

    let s = sentence;
    let changeCount = 0;

    if (cl.tier === 'KEEP' && !cl.issues.includes('overused_word')) {
      changeLog.keptSentences++;
      result.push(s);
      i++;
      continue;
    }

    // Strategy B: split very long sentences (>35 words)
    if (cl.issues.includes('too_long')) {
      const parts = strategySplitSentence(s);
      if (parts.length > 1) {
        result.push(...parts);
        changeLog.sentencesSplit++;
        i++;
        continue;
      }
    }

    // Strategy F: remove overused transitions (≥2 occurrences)
    if (cl.issues.includes('overused_transition')) {
      const tp = TRANSITION_PATTERNS.find(p => p.re.test(s.toLowerCase().trim()));
      if (tp && (transitionCounts[tp.label]||0) >= 2) {
        const revised = strategyRemoveTransition(s, tp.label);
        if (revised !== s) { s = revised; changeLog.transitionsRemoved++; changeCount++; }
      }
    }

    // Strategy E: vary repeated sentence opening
    if (cl.issues.includes('repeated_opening') && occNum >= 1) {
      const revised = strategyChangeOpening(s, occNum);
      if (revised !== s) { s = revised; changeLog.openingsVaried++; changeCount++; }
    }

    // Strategy D: reduce one overused word (moderate: minFreq=4, gap=2)
    if (cl.issues.includes('overused_word') || cl.issues.includes('redundant_phrase')) {
      const revised = strategyReduceRedundancy(s, wordFreq, lastReplacedAt, i, 4, 2);
      if (revised !== s) { s = revised; changeLog.synonymsReplaced++; changeCount++; }
    }

    if (changeCount === 0) changeLog.keptSentences++;
    result.push(s);
    i++;
  }

  return { text: result.join(' '), changeLog };
}

/**
 * Candidate 3 — STRUCTURAL REVISION
 * Allows sentence combining/splitting and clause reordering where genuinely useful.
 * Strategies: B (split), C (combine short pairs), E, F, G (reorder), D (active)
 */
function generateCandidateStructural(sentences, classification, wordFreq, transitionCounts) {
  const lastReplacedAt = {};
  const changeLog = { synonymsReplaced: 0, transitionsRemoved: 0, openingsVaried: 0,
                      sentencesSplit: 0, sentencesCombined: 0, keptSentences: 0 };

  const openingOccurrences = {};
  const result = [];
  let i = 0;

  while (i < sentences.length) {
    const cl   = classification[i];
    const cl2  = classification[i+1]; // may be undefined
    const sentence  = sentences[i];
    const sentence2 = sentences[i+1];

    const fw = sentence.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (!STOP_WORDS.has(fw)) openingOccurrences[fw] = (openingOccurrences[fw]||0) + 1;
    const occNum = (openingOccurrences[fw]||1) - 1;

    let s = sentence;
    let changeCount = 0;

    // Strategy C: combine two very short adjacent sentences
    if (cl.wc <= 7 && cl2 && cl2.wc <= 7 && cl.tier !== 'KEEP') {
      const combined = strategyCombineSentences(s, sentence2);
      if (combined) {
        result.push(combined);
        changeLog.sentencesCombined++;
        i += 2; // consume both
        continue;
      }
    }

    // Strategy B: split long sentences
    if (cl.issues.includes('too_long')) {
      const parts = strategySplitSentence(s);
      if (parts.length > 1) {
        result.push(...parts);
        changeLog.sentencesSplit++;
        i++;
        continue;
      }
    }

    // Strategy G: reorder clauses for moderate+ sentences
    if ((cl.tier === 'REVISE_MODERATE' || cl.tier === 'REVISE_STRONG') && cl.wc >= 12 && cl.wc <= 40) {
      const revised = strategyReorderClauses(s);
      if (revised !== s) { s = revised; changeCount++; }
    }

    // Strategy F: remove overused transitions
    if (cl.issues.includes('overused_transition')) {
      const tp = TRANSITION_PATTERNS.find(p => p.re.test(s.toLowerCase().trim()));
      if (tp && (transitionCounts[tp.label]||0) >= 2) {
        const revised = strategyRemoveTransition(s, tp.label);
        if (revised !== s) { s = revised; changeLog.transitionsRemoved++; changeCount++; }
      }
    }

    // Strategy E: vary repeated sentence opening
    if (cl.issues.includes('repeated_opening') && occNum >= 1) {
      const revised = strategyChangeOpening(s, occNum);
      if (revised !== s) { s = revised; changeLog.openingsVaried++; changeCount++; }
    }

    // Strategy D: reduce overused words (active: minFreq=3, gap=2)
    if (cl.issues.includes('overused_word') || cl.issues.includes('redundant_phrase')) {
      const revised = strategyReduceRedundancy(s, wordFreq, lastReplacedAt, i, 3, 2);
      if (revised !== s) { s = revised; changeLog.synonymsReplaced++; changeCount++; }
    }

    if (changeCount === 0) changeLog.keptSentences++;
    result.push(s);
    i++;
  }

  return { text: result.join(' '), changeLog };
}

/* ──────────────────────────────────────────────────────────────────
   SEMANTIC PRESERVATION VALIDATOR
   ────────────────────────────────────────────────────────────────── */

/**
 * Check that key semantic content (numbers, proper nouns, citations, quoted phrases)
 * is preserved between original and revised text.
 * Returns { preserved: boolean, loss: number 0-1 }
 */
function checkSemanticPreservation(origText, revisedText) {
  // Extract: numbers, capitalised sequences (names/titles), quoted strings
  const extractKeyTokens = text => {
    const numbers  = (text.match(/\b\d[\d.,%-]*\b/g) || []);
    const caps     = (text.match(/\b[A-ZÀÁÂÄÆÃÅĀÈÉÊËĒĖĘÎÏÍĪĮÌÔÖÒÓŒØŌÕÙÚÛÜŪÛÑĆČŚŠŽŁŹŻÝ][a-zàáâäæãåāèéêëēėęîïíīįìôöòóœøōõùúûüūûñćčśšžłźżý]+/g) || []);
    const quoted   = (text.match(/"[^"]+"|"[^"]+"/g) || []);
    return new Set([...numbers, ...caps, ...quoted]);
  };

  const origKeys    = extractKeyTokens(origText);
  const revisedKeys = extractKeyTokens(revisedText);

  let preserved = 0;
  origKeys.forEach(k => { if (revisedKeys.has(k)) preserved++; });

  if (origKeys.size === 0) return { preserved: true, loss: 0 };
  const lossRate = 1 - preserved / origKeys.size;
  return { preserved: lossRate < 0.15, loss: lossRate }; // allow up to 15% loss (tokenisation noise)
}

/* ──────────────────────────────────────────────────────────────────
   HOLISTIC WRITING QUALITY SCORE
   ────────────────────────────────────────────────────────────────── */

/**
 * Compute a Natural Writing Quality Score (0–100) for a candidate.
 *
 * This is NOT an AI probability. It is a multi-dimensional quality index
 * for COMPARING candidates. Higher = better holistic writing quality.
 *
 * Dimensions:
 *   25 pts — Repetition control (lex + phrase)
 *   20 pts — Sentence rhythm (variation + burstiness)
 *   15 pts — Word-count stability (95–105% of original = max)
 *   15 pts — Vocabulary diversity improvement
 *   15 pts — Semantic preservation
 *   10 pts — No score regression (overall risk didn't worsen)
 *
 * NOTE: overall risk score delta contributes only 10/100 pts.
 *       Writing quality is the primary signal.
 */
function computeWritingQualityScore(origAnalysis, candAnalysis, semanticResult) {
  const v = {
    lexDiff:    origAnalysis.features.lexicalRepetition.score  - candAnalysis.features.lexicalRepetition.score,
    phraseDiff: origAnalysis.features.phraseRepetition.score   - candAnalysis.features.phraseRepetition.score,
    unifDiff:   origAnalysis.features.sentenceUniformity.score - candAnalysis.features.sentenceUniformity.score,
    burstDiff:  origAnalysis.features.burstiness.score         - candAnalysis.features.burstiness.score,
    vocabDiff:  origAnalysis.features.vocabularyDiversity.score- candAnalysis.features.vocabularyDiversity.score,
    overallDiff: origAnalysis.finalScore - candAnalysis.finalScore,
  };
  const wordRatio = candAnalysis.wordCount / Math.max(1, origAnalysis.wordCount);

  // Dimension 1: Repetition control (25 pts)
  const lexPts   = Math.max(0, Math.min(15, v.lexDiff * 2.5));   // >6 pt reduction = full 15
  const phrasPts = Math.max(0, Math.min(10, v.phraseDiff * 2.0));
  const d1 = lexPts + phrasPts;

  // Dimension 2: Sentence rhythm (20 pts)
  const unifPts  = Math.max(0, Math.min(12, v.unifDiff * 2.0));
  const burstPts = Math.max(0, Math.min(8,  v.burstDiff * 1.5));
  const d2 = unifPts + burstPts;

  // Dimension 3: Word-count stability (15 pts)
  // 0.95-1.05 = 15; 0.90-0.95 or 1.05-1.10 = 10; outside = penalty
  let d3;
  if (wordRatio >= 0.95 && wordRatio <= 1.05) d3 = 15;
  else if (wordRatio >= 0.90 && wordRatio <= 1.10) d3 = 10;
  else if (wordRatio >= 0.85 && wordRatio <= 1.15) d3 = 5;
  else d3 = 0;

  // Dimension 4: Vocabulary diversity (15 pts)
  const d4 = Math.max(0, Math.min(15, v.vocabDiff * 2.5));

  // Dimension 5: Semantic preservation (15 pts)
  const d5 = semanticResult.preserved ? 15 : Math.round(15 * (1 - semanticResult.loss));

  // Dimension 6: Risk score stability — didn't worsen (10 pts)
  // Neutral = 5 pts (no change); improvement gives more; regression deducts
  const d6 = v.overallDiff >= 0
    ? Math.min(10, 5 + v.overallDiff * 0.5)
    : Math.max(0, 5 + v.overallDiff * 0.8); // penalise regression more steeply

  return Math.round(d1 + d2 + d3 + d4 + d5 + d6);
}

/* ──────────────────────────────────────────────────────────────────
   VALIDATION & SELECTION
   ────────────────────────────────────────────────────────────────── */

/**
 * Validate whether a candidate revision improved the writing profile.
 * Also incorporates semantic preservation check.
 * Returns a score (higher = better) and a boolean pass/fail.
 */
function validateImprovement(origAnalysis, candAnalysis) {
  let score = 0;
  const details = [];

  const lexDiff   = origAnalysis.features.lexicalRepetition.score  - candAnalysis.features.lexicalRepetition.score;
  const phraseDiff= origAnalysis.features.phraseRepetition.score   - candAnalysis.features.phraseRepetition.score;
  const unifDiff  = origAnalysis.features.sentenceUniformity.score - candAnalysis.features.sentenceUniformity.score;
  const burstDiff = origAnalysis.features.burstiness.score         - candAnalysis.features.burstiness.score;
  const vocabDiff = origAnalysis.features.vocabularyDiversity.score- candAnalysis.features.vocabularyDiversity.score;
  const overallDiff = origAnalysis.finalScore - candAnalysis.finalScore;
  const wordCountRatio = candAnalysis.wordCount / Math.max(1, origAnalysis.wordCount);

  if (lexDiff >= 2)    { score += 1;   details.push('Repetisi leksikal berkurang'); }
  if (phraseDiff >= 2) { score += 1;   details.push('Repetisi frasa berkurang'); }
  if (unifDiff >= 2)   { score += 1;   details.push('Keseragaman kalimat berkurang (variasi meningkat)'); }
  if (burstDiff >= 2)  { score += 1;   details.push('Variasi ritme kalimat meningkat'); }
  if (vocabDiff >= 2)  { score += 0.5; details.push('Keragaman kosakata meningkat'); }

  if (overallDiff < -3) { score -= 2; details.push('Skor risiko keseluruhan meningkat secara signifikan'); }
  if (wordCountRatio > 1.12) { score -= 1; details.push('Jumlah kata meningkat lebih dari 12%'); }
  if (lexDiff < -2)    { score -= 0.5; details.push('Repetisi leksikal meningkat'); }
  if (phraseDiff < -2) { score -= 0.5; details.push('Repetisi frasa meningkat'); }
  if (unifDiff < -2)   { score -= 0.5; details.push('Keseragaman kalimat meningkat (variasi berkurang)'); }

  const passes = score >= 0.5 && overallDiff >= -3;

  return { score, passes, details, overallDiff, lexDiff, phraseDiff, unifDiff, burstDiff, vocabDiff };
}

/**
 * Select the best candidate from a list of {text, analysis, validation} objects.
 * Prefers:
 *   1. Candidates that pass validation (validation.passes === true)
 *   2. Among passing candidates: highest holistic qualityIndex (NOT just risk score delta)
 *   3. If no candidate passes: return null (caller must show fail-safe)
 */
function selectBestRevision(candidates) {
  const passing = candidates.filter(c => c.validation.passes);
  if (passing.length === 0) return null;
  // Use qualityIndex (holistic Writing Quality Score) for selection
  return passing.sort((a, b) => (b.qualityIndex||0) - (a.qualityIndex||0))[0];
}

/**
 * Rank all 3 revision candidates by their holistic Writing Quality Index.
 *
 * qualityIndex is already computed by computeWritingQualityScore() during generation.
 * This function only assigns .candNum, .rankNum, and .qualityLabel.
 *
 * Returns annotated candidates in original order (candNum 1/2/3).
 */
function rankRevisionCandidates(candidates, origAnalysis) {
  const scored = candidates.map((c, i) => ({
    ...c,
    // qualityIndex already set by computeWritingQualityScore; fall back to 0 if missing
    qualityIndex: c.qualityIndex ?? 0,
    candNum: i + 1,
  }));

  // Sort descending by qualityIndex
  const sorted = [...scored].sort((a, b) => b.qualityIndex - a.qualityIndex);

  // Assign rank labels
  sorted.forEach((c, idx) => {
    c.rankNum = idx + 1;
    if (idx === 0)        c.qualityLabel = 'Kandidat Terbaik';
    else if (idx === 1)   c.qualityLabel = 'Cukup Baik';
    else                  c.qualityLabel = 'Perlu Ditinjau';
  });

  // Return in original order (candNum 1/2/3) with rank info attached
  return scored.map(c => {
    const rankInfo = sorted.find(s => s.candNum === c.candNum);
    return { ...c, rankNum: rankInfo.rankNum, qualityLabel: rankInfo.qualityLabel };
  });
}

/**
 * Determine the fail-safe state from the full candidate set.
 *
 * STATE A — 'validated'  : at least one candidate passes strict validation
 * STATE B — 'mixed'      : no candidate passes, but best qualityIndex > 35
 *                           AND at least one metric improved meaningfully
 * STATE C — 'none'       : all candidates are worse overall
 */
function determineFailsafeState(candidates, ranking) {
  if (candidates.some(c => c.validation.passes)) return 'validated';
  const best = ranking.find(c => c.rankNum === 1);
  if (!best) return 'none';
  const hasMeaningfulGain =
    best.validation.lexDiff   >= 2 ||
    best.validation.phraseDiff >= 2 ||
    best.validation.unifDiff  >= 2 ||
    best.validation.burstDiff >= 2;
  if (best.qualityIndex > 35 && hasMeaningfulGain) return 'mixed';
  return 'none';
}

/**
 * Build human-readable change log entries from a candidate's changeLog counters.
 */
function buildChangeMade(candidate) {
  const cl = candidate.changeLog;
  const out = [];
  if (cl.synonymsReplaced > 0)
    out.push(`${cl.synonymsReplaced} pengulangan kata dikurangi melalui variasi sinonim`);
  if (cl.transitionsRemoved > 0)
    out.push(`${cl.transitionsRemoved} transisi berulang yang tidak perlu dihapus`);
  if (cl.openingsVaried > 0)
    out.push(`${cl.openingsVaried} pembuka kalimat yang berulang divariasikan`);
  if (cl.sentencesSplit > 0)
    out.push(`${cl.sentencesSplit} kalimat terlalu panjang dipecah menjadi lebih pendek`);
  if (cl.sentencesCombined > 0)
    out.push(`${cl.sentencesCombined} kalimat sangat pendek yang berdekatan digabungkan`);
  if (cl.keptSentences > 0)
    out.push(`${cl.keptSentences} kalimat dipertahankan tanpa perubahan`);
  return out;
}

/**
 * Main entry point for the Writing Improver v4 workflow.
 *
 * Pipeline: DIAGNOSE → TARGET → REVISE → RECHECK → RANK → SELECT
 *
 * Returns:
 *   {
 *     improvedText, changeMade, validation, usedOriginal,
 *     allCandidates,   // ranked array — always present
 *     ranking,         // same array (alias)
 *     failsafeState,   // 'validated' | 'mixed' | 'none'
 *     bestCandidateIdx // 0-based index into allCandidates of the top-ranked candidate
 *   }
 *
 * API integration point (future):
 * Replace generateCandidateMinimal/Balanced/Structural with LLM calls.
 * The classify → validate → rank loop is API-agnostic.
 */
function generateImprovedText(text, settings) {
  // ── DOCUMENT STRUCTURE PRESERVATION ─────────────────────────────────────
  // Parse the full text into typed blocks BEFORE any rewriting.
  // Only "paragraph" blocks enter the revision pipeline.
  // title, author, heading, citation, quotation, bullet, numbered blocks are
  // passed through UNCHANGED and reassembled afterwards.
  const origDoc = parseDocument(text);

  // Extract only paragraph blocks for analysis (order-preserving)
  const paragraphBlocks = origDoc.blocks.filter(b => b.type === 'paragraph');

  // If no paragraph blocks were found, fall back to the full text as one paragraph
  const analysisText = paragraphBlocks.length > 0
    ? paragraphBlocks.map(b => b.content).join('\n\n')
    : text;

  // Build global word frequency from PROSE CONTENT ONLY
  const words    = getWords(analysisText);
  const wordFreq = {};
  words.forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });

  // analyzeText() operates on the full text so sentence/word stats are correct
  const origAnalysis = analyzeText(text);

  // ── DIAGNOSE: sentences across all paragraphs (for global classification) ─
  // getSentences() is called per-paragraph so newlines are NOT collapsed globally.
  const allSentences = paragraphBlocks.length > 0
    ? paragraphBlocks.flatMap(b => getSentences(b.content))
    : getSentences(text);

  const classification = classifySentences(allSentences, wordFreq);

  // ── Build transition count map (global, across all paragraphs) ───────────
  const transitionCounts = {};
  allSentences.forEach(s => {
    const s_lc = s.toLowerCase().trim();
    TRANSITION_PATTERNS.forEach(tp => {
      if (tp.re.test(s_lc)) transitionCounts[tp.label] = (transitionCounts[tp.label]||0) + 1;
    });
  });

  // ── Helper: rewrite paragraph blocks using a candidate generator ──────────
  // Each generator receives the per-paragraph sentence array.
  // Returns the full reconstructed document text (structure preserved).
  const rewriteWithGenerator = (genFn) => {
    let sentIdx = 0; // global sentence index into allSentences / classification
    const combinedChangeLog = { synonymsReplaced: 0, transitionsRemoved: 0,
      openingsVaried: 0, sentencesSplit: 0, sentencesCombined: 0, keptSentences: 0 };

    const newBlocks = origDoc.blocks.map(block => {
      // Non-paragraph blocks pass through unchanged
      if (block.type !== 'paragraph') return { ...block };

      // Get the sentences for THIS paragraph only
      const paraSentences    = getSentences(block.content);
      const paraClassif      = classification.slice(sentIdx, sentIdx + paraSentences.length);
      sentIdx += paraSentences.length;

      if (paraSentences.length === 0) return { ...block };

      // Run the generator on this paragraph's sentences
      const { text: revisedPara, changeLog } = genFn(
        paraSentences, paraClassif, wordFreq, transitionCounts
      );

      // Accumulate change log
      Object.keys(combinedChangeLog).forEach(k => {
        if (changeLog[k] !== undefined) combinedChangeLog[k] += changeLog[k];
      });

      return { type: 'paragraph', content: revisedPara };
    });

    // Reconstruct the full document text
    const candDoc  = { title: origDoc.title, author: origDoc.author, blocks: newBlocks };
    const candText = reconstructDocumentText(candDoc);
    return { text: candText, changeLog: combinedChangeLog, document: candDoc };
  };

  // ── REVISE: Generate 3 meaningfully different candidates ─────────────────
  const candidateGenerators = [
    { fn: generateCandidateMinimal,    label: 'minimal' },
    { fn: generateCandidateBalanced,   label: 'seimbang' },
    { fn: generateCandidateStructural, label: 'struktural' },
  ];

  const rawCandidates = candidateGenerators.map(gen => {
    const { text: candText, changeLog, document: candDoc } = rewriteWithGenerator(gen.fn);
    const candAnalysis = analyzeText(candText);
    const validation   = validateImprovement(origAnalysis, candAnalysis);
    const semantic     = checkSemanticPreservation(text, candText);
    const qualityIndex = computeWritingQualityScore(origAnalysis, candAnalysis, semantic);
    return {
      text: candText, document: candDoc, analysis: candAnalysis, validation,
      changeLog, strategy: gen.label, semantic, qualityIndex,
    };
  });

  // ── Rank ALL candidates (including those that failed validation) ──────────
  const ranking = rankRevisionCandidates(rawCandidates, origAnalysis);

  // ── Determine overall state ───────────────────────────────────────────────
  const failsafeState = determineFailsafeState(rawCandidates, ranking);

  // ── Find the best validated candidate (or null) ───────────────────────────
  const bestValidated = selectBestRevision(rawCandidates);

  // ── Find the best-ranked candidate (always exists) ───────────────────────
  const topRanked = ranking.find(c => c.rankNum === 1);

  if (!bestValidated) {
    const bestCandidateIdx = topRanked ? topRanked.candNum - 1 : 0;
    return {
      improvedText:     text,
      origDocument:     origDoc,
      changeMade:       [],
      validation:       null,
      usedOriginal:     true,
      allCandidates:    ranking,
      ranking,
      failsafeState,
      bestCandidateIdx,
    };
  }

  const validatedCandNum = rawCandidates.findIndex(c => c === bestValidated) + 1;
  const bestCandidateIdx = validatedCandNum - 1;
  const changeMade       = buildChangeMade(bestValidated);

  return {
    improvedText:     bestValidated.text,
    origDocument:     origDoc,
    changeMade,
    validation:       bestValidated.validation,
    usedOriginal:     false,
    allCandidates:    ranking,
    ranking,
    failsafeState,
    bestCandidateIdx,
  };
}

/* ============================================================
   MODULE: COMPARISON ENGINE
   Computes before/after metrics from actual text.
   Returns a structured comparison object.
   ============================================================ */

/**
 * Compare two analysis objects and produce a comparison table dataset.
 * @param {object} origAnalysis
 * @param {object} impAnalysis
 * @returns {Array<{metric, origVal, impVal, origNum, impNum, unit, higherIsBetter}>}
 */
function compareTexts(origAnalysis, impAnalysis) {
  const o = origAnalysis;
  const im = impAnalysis;

  return [
    {
      metric: 'AI Writing Risk Score',
      origNum: o.finalScore,
      impNum: im.finalScore,
      origVal: o.finalScore + '%',
      impVal: im.finalScore + '%',
      unit: '%',
      higherIsBetter: false, // lower risk is better
    },
    {
      metric: 'Keragaman Kosakata (TTR)',
      origNum: Math.round(o.features.vocabularyDiversity.ttr * 100),
      impNum:  Math.round(im.features.vocabularyDiversity.ttr * 100),
      origVal: Math.round(o.features.vocabularyDiversity.ttr * 100) + '%',
      impVal:  Math.round(im.features.vocabularyDiversity.ttr * 100) + '%',
      unit: '%',
      higherIsBetter: true,
    },
    {
      metric: 'Variasi Kalimat (CV)',
      origNum: Math.round(o.features.sentenceUniformity.raw.cv * 100),
      impNum:  Math.round(im.features.sentenceUniformity.raw.cv * 100),
      origVal: (o.features.sentenceUniformity.raw.cv * 100).toFixed(1) + '%',
      impVal:  (im.features.sentenceUniformity.raw.cv * 100).toFixed(1) + '%',
      unit: '%',
      higherIsBetter: true,
    },
    {
      metric: 'Repetisi Kata',
      origNum: Math.round(o.features.lexicalRepetition.score),
      impNum:  Math.round(im.features.lexicalRepetition.score),
      origVal: Math.round(o.features.lexicalRepetition.score) + '%',
      impVal:  Math.round(im.features.lexicalRepetition.score) + '%',
      unit: '%',
      higherIsBetter: false, // lower repetition is better
    },
    {
      metric: 'Rata-rata Panjang Kalimat',
      origNum: o.features.sentenceUniformity.raw.mean,
      impNum:  im.features.sentenceUniformity.raw.mean,
      origVal: o.features.sentenceUniformity.raw.mean + ' kata',
      impVal:  im.features.sentenceUniformity.raw.mean + ' kata',
      unit: 'kata',
      higherIsBetter: null, // neutral — just informational
    },
    {
      metric: 'Keseragaman Struktur',
      origNum: Math.round(o.features.structuralConsistency.score),
      impNum:  Math.round(im.features.structuralConsistency.score),
      origVal: Math.round(o.features.structuralConsistency.score) + '%',
      impVal:  Math.round(im.features.structuralConsistency.score) + '%',
      unit: '%',
      higherIsBetter: false, // less uniformity = more natural
    },
    {
      metric: 'Jumlah Kata',
      origNum: o.wordCount,
      impNum:  im.wordCount,
      origVal: o.wordCount.toLocaleString('id-ID'),
      impVal:  im.wordCount.toLocaleString('id-ID'),
      unit: 'kata',
      higherIsBetter: null,
    },
    {
      metric: 'Jumlah Paragraf',
      origNum: o.paragraphs.length,
      impNum:  im.paragraphs.length,
      origVal: String(o.paragraphs.length),
      impVal:  String(im.paragraphs.length),
      unit: '',
      higherIsBetter: null,
    },
  ];
}

/* ============================================================
   MODULE: COMPARISON RENDERING
   ============================================================ */

/**
 * Render the comparison table.
 */
function renderComparisonTable(rows) {
  const tbody = $('comparisonTableBody');
  tbody.innerHTML = rows.map(row => {
    const diff = row.impNum - row.origNum;
    let arrowHtml;
    if (row.higherIsBetter === null || Math.abs(diff) < 1) {
      arrowHtml = `<span class="cmp-arrow-same">—</span>`;
    } else {
      const isImprovement = row.higherIsBetter ? diff > 0 : diff < 0;
      const sign = diff > 0 ? '↑ +' : '↓ ';
      const cls  = isImprovement ? 'cmp-arrow-up' : 'cmp-arrow-down';
      const valStr = row.unit === '%' || row.unit === 'kata'
        ? `${Math.abs(diff).toFixed(row.unit === '%' ? 0 : 1)} ${row.unit}`
        : Math.abs(diff);
      arrowHtml = `<span class="${cls}">${sign}${valStr}</span>`;
    }
    return `<tr>
      <td style="font-weight:600;color:var(--text-primary);">${row.metric}</td>
      <td class="cmp-orig">${row.origVal}</td>
      <td class="cmp-impr">${row.impVal}</td>
      <td>${arrowHtml}</td>
    </tr>`;
  }).join('');
}

/**
 * Render comparison charts (Radar + Bar).
 * Uses real calculated values from both analyses.
 */
function renderComparisonCharts(origAnalysis, impAnalysis) {
  // ── Radar ──
  destroyChart('compareRadar');
  const ctxR = $('chartCompareRadar').getContext('2d');
  const oS = origAnalysis.rawScores;
  const iS = impAnalysis.rawScores;

  // For radar, convert to "positive = good" scale:
  // Vocabulary Diversity & Variation = 100 - riskScore (higher = better)
  // Repetition Control = 100 - repetitionScore (higher = less repetition)
  // Structural Variation = 100 - uniformityScore (higher = more varied)
  // Readability = burstiness interpreted as variation (100 - score)
  const toRadarOrig = [
    Math.round(100 - oS.vocabularyDiversity),
    Math.round(100 - oS.sentenceUniformity),
    Math.round(100 - oS.structuralConsistency),
    Math.round(100 - oS.lexicalRepetition),
    Math.round(100 - oS.burstiness),
  ];
  const toRadarImp = [
    Math.round(100 - iS.vocabularyDiversity),
    Math.round(100 - iS.sentenceUniformity),
    Math.round(100 - iS.structuralConsistency),
    Math.round(100 - iS.lexicalRepetition),
    Math.round(100 - iS.burstiness),
  ];

  charts.compareRadar = new Chart(ctxR, {
    type: 'radar',
    data: {
      labels: ['Keragaman\nKosakata','Variasi\nKalimat','Variasi\nStruktur','Kontrol\nRepetisi','Variasi\nRitme'],
      datasets: [
        {
          label: 'Teks Asli',
          data: toRadarOrig,
          backgroundColor: 'rgba(100,116,139,0.15)',
          borderColor: 'rgba(100,116,139,0.7)',
          borderWidth: 2,
          pointBackgroundColor: '#64748b',
          pointRadius: 4,
        },
        {
          label: 'Setelah Perbaikan',
          data: toRadarImp,
          backgroundColor: 'rgba(212,175,55,0.15)',
          borderColor: 'rgba(212,175,55,0.85)',
          borderWidth: 2,
          pointBackgroundColor: '#D4AF37',
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { stepSize: 25, color: CHART_DEFAULTS.tickColor, backdropColor: 'transparent', font: { size: 10 } },
          grid:  { color: CHART_DEFAULTS.gridColor },
          pointLabels: { color: CHART_DEFAULTS.color, font: { size: 10 } },
          angleLines: { color: CHART_DEFAULTS.gridColor },
        },
      },
      plugins: {
        legend: { labels: { color: CHART_DEFAULTS.color, font: { size: 11 }, boxWidth: 14 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.formattedValue}%` } },
      },
      animation: { duration: 700 },
    },
  });

  // ── Bar ──
  destroyChart('compareBar');
  const ctxB = $('chartCompareBar').getContext('2d');

  const barLabels = ['TTR\nKosakata', 'Variasi\nKalimat', 'Risk\nScore', 'Repetisi\nKata'];
  const origData  = [
    Math.round(origAnalysis.features.vocabularyDiversity.ttr * 100),
    Math.round(origAnalysis.features.sentenceUniformity.raw.cv * 100),
    origAnalysis.finalScore,
    Math.round(origAnalysis.features.lexicalRepetition.score),
  ];
  const impData   = [
    Math.round(impAnalysis.features.vocabularyDiversity.ttr * 100),
    Math.round(impAnalysis.features.sentenceUniformity.raw.cv * 100),
    impAnalysis.finalScore,
    Math.round(impAnalysis.features.lexicalRepetition.score),
  ];

  charts.compareBar = new Chart(ctxB, {
    type: 'bar',
    data: {
      labels: barLabels,
      datasets: [
        {
          label: 'Teks Asli',
          data: origData,
          backgroundColor: 'rgba(100,116,139,0.6)',
          borderRadius: 5,
          borderWidth: 0,
        },
        {
          label: 'Setelah Perbaikan',
          data: impData,
          backgroundColor: 'rgba(212,175,55,0.7)',
          borderRadius: 5,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: CHART_DEFAULTS.color, font: { size: 11 }, boxWidth: 14 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.formattedValue}` } },
      },
      scales: {
        x: { ticks: { color: CHART_DEFAULTS.tickColor }, grid: { color: CHART_DEFAULTS.gridColor } },
        y: {
          ticks: { color: CHART_DEFAULTS.tickColor },
          grid: { color: CHART_DEFAULTS.gridColor },
          beginAtZero: true, max: 100,
        },
      },
      animation: { duration: 600 },
    },
  });
}

/**
 * Build and display the change log from the improvement process.
 * changeMade is already an array of human-readable strings (from v3 engine).
 */
function renderChangeLog(changeMade) {
  // changeMade is a string[] from generateImprovedText() v3 — no key lookup needed.
  const allChanges = [
    ...changeMade,
    'Mempertahankan makna, argumen, dan terminologi akademik teks asli',
    'Tidak ada fakta, data, atau posisi penulis yang diubah',
  ];

  $('changeLogList').innerHTML = `<div class="change-log-list">${
    allChanges.map(c => `<div class="change-log-item">${escapeHtml(c)}</div>`).join('')
  }</div>`;

  $('changeLog').classList.remove('hidden');
}

/* ============================================================
   MODULE: WRITING IMPROVER UI CONTROLLER v3
   Adds full candidate transparency: rank, preview, accept/cancel.
   ============================================================ */

/** Current settings state */
const improverState = {
  goal:      'academic',
  intensity: 'moderate',
};

/** Last improved text — used as input for second pass */
let _lastImprovedText    = null;
let _lastImprovedAnalysis = null;

/**
 * Candidate state — populated by runImproverPass, consumed by the preview UI.
 * These are never cleared between passes so the user can always inspect them.
 */
let _allCandidates      = null;  // ranked array from rankRevisionCandidates
let _origAnalysisForCmp = null;  // original analysis at time of improvement run
let _chosenCandidateIdx = 0;     // 0-based index of currently previewed candidate
let _failsafeState      = null;  // 'validated' | 'mixed' | 'none'

/**
 * Document structure state — preserves typed blocks for panel rendering.
 * _origDocument     : parsed document from the original analyzed text.
 * _improvedDocument : parsed document from the current improved/accepted text.
 * _formatMode       : 'document' | 'plaintext' — controls panel render mode.
 */
let _origDocument     = null;
let _improvedDocument = null;
let _formatMode       = 'document'; // default to document view

/**
 * Switch all visible text panels between document-view and plaintext-view.
 * Called from the format toggle buttons.
 */
function applyFormatMode(mode) {
  _formatMode = mode;

  // Re-render original panel
  if (_origDocument) {
    renderPanel(_origDocument, $('originalTextPanel'));
    renderPanel(_origDocument, $('compareOrigPanel'));
  }
  // Re-render improved panel
  if (_improvedDocument) {
    renderPanel(_improvedDocument, $('improvedTextPanel'));
    renderPanel(_improvedDocument, $('compareImpPanel'));
  }
}

/**
 * Initialize button group toggle logic.
 */
function initBtnGroup(groupId, stateKey) {
  const group = $(groupId);
  if (!group) return;
  group.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.btn-toggle').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      improverState[stateKey] = btn.dataset.value;
    });
  });
}

/**
 * Animate loading steps sequentially.
 */
function animateLoadingSteps() {
  return new Promise(resolve => {
    const steps = [$('lstep1'), $('lstep2'), $('lstep3')];
    steps.forEach(s => { s.className = 'loading-step'; });
    let current = 0;
    function next() {
      if (current >= steps.length) { setTimeout(resolve, 200); return; }
      if (current > 0) steps[current - 1].className = 'loading-step done';
      steps[current].className = 'loading-step active';
      current++;
      setTimeout(next, 600);
    }
    next();
  });
}

/**
 * View tab switching inside the improver panels.
 */
function initViewTabs() {
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const viewName = tab.dataset.view;
      ['view-original', 'view-improved', 'view-compare'].forEach(id => {
        const el = $(id);
        if (el) el.classList.toggle('hidden', id !== 'view-' + viewName);
      });
    });
  });
}

/**
 * Evaluate how the improvement changed writing patterns.
 * Honest — reports even if score worsened.
 * Returns { statusClass, statusIcon, statusTitle, statusDetail }
 */
function evaluateImprovement(origAnalysis, impAnalysis) {
  const scoreDiff = impAnalysis.finalScore - origAnalysis.finalScore;

  // Count how many of the 5 key metrics improved
  const metrics = [
    { orig: origAnalysis.features.sentenceUniformity.score, imp: impAnalysis.features.sentenceUniformity.score, lowerIsBetter: true },
    { orig: origAnalysis.features.lexicalRepetition.score,  imp: impAnalysis.features.lexicalRepetition.score,  lowerIsBetter: true },
    { orig: origAnalysis.features.phraseRepetition.score,   imp: impAnalysis.features.phraseRepetition.score,   lowerIsBetter: true },
    { orig: origAnalysis.features.vocabularyDiversity.score,imp: impAnalysis.features.vocabularyDiversity.score, lowerIsBetter: true },
    { orig: origAnalysis.features.burstiness.score,         imp: impAnalysis.features.burstiness.score,         lowerIsBetter: true },
  ];

  const improved = metrics.filter(m => m.lowerIsBetter ? m.imp < m.orig - 1 : m.imp > m.orig + 1).length;
  const worsened = metrics.filter(m => m.lowerIsBetter ? m.imp > m.orig + 1 : m.imp < m.orig - 1).length;

  if (improved >= 3 && scoreDiff <= 0) {
    return {
      statusClass: 'improved',
      statusIcon: '✓',
      statusTitle: 'IMPROVED',
      statusDetail: 'Beberapa indikator variasi tulisan meningkat.',
    };
  } else if (improved >= 2 || (improved >= 1 && worsened <= 1)) {
    return {
      statusClass: 'mixed',
      statusIcon: '~',
      statusTitle: 'MIXED',
      statusDetail: 'Sebagian indikator membaik, tetapi beberapa indikator lainnya masih menunjukkan pola yang seragam.',
    };
  } else {
    return {
      statusClass: 'needs-review',
      statusIcon: '⚠',
      statusTitle: 'NEEDS REVIEW',
      statusDetail: scoreDiff > 0
        ? 'Beberapa pola menjadi lebih seragam. Silakan tinjau kembali hasil perbaikan atau gunakan "Perbaiki Lagi".'
        : 'Perubahan belum meningkatkan sebagian besar indikator yang diharapkan.',
    };
  }
}

/**
 * Render the "Evaluasi Hasil Perbaikan" section.
 */
function renderEvaluasi(origAnalysis, impAnalysis) {
  const card = $('evaluasiCard');
  const scoresEl = $('evaluasiScores');
  const statusEl = $('evaluasiStatus');
  if (!card || !scoresEl || !statusEl) return;

  const origScore = origAnalysis.finalScore;
  const impScore  = impAnalysis.finalScore;
  const delta     = impScore - origScore;
  const deltaStr  = delta === 0 ? '±0%' : (delta > 0 ? `↑ +${delta}%` : `↓ ${Math.abs(delta)}%`);
  const deltaClass = delta === 0 ? 'same' : delta > 0 ? 'up' : 'down';
  const impClass  = delta > 0 ? 'evaluasi-imp-up' : 'evaluasi-imp-down';

  scoresEl.innerHTML = `
    <span class="evaluasi-orig">${origScore}%</span>
    <span class="evaluasi-arrow">→</span>
    <span class="${impClass}">${impScore}%</span>
    <span class="evaluasi-delta ${deltaClass}">${deltaStr}</span>`;

  const ev = evaluateImprovement(origAnalysis, impAnalysis);
  statusEl.className = `evaluasi-status ${ev.statusClass}`;
  statusEl.innerHTML = `<span class="evaluasi-status-icon">${ev.statusIcon}</span>
    <span><strong>${ev.statusTitle}</strong> — ${ev.statusDetail}</span>`;

  card.classList.remove('hidden');
}

/**
 * Show/hide the "Perbaiki Lagi" button (only after first pass).
 */
function showImproveAgainBtn(show) {
  const btn = $('improveAgainBtn');
  if (btn) btn.style.display = show ? '' : 'none';
}

/* ============================================================
   MODULE: CANDIDATE PREVIEW SYSTEM
   ============================================================ */

/**
 * Build the metric comparison rows for a candidate vs original.
 * Reuses the same row structure as compareTexts() so we can share renderComparisonTable().
 */
function buildCandidateCompareRows(origAnalysis, candAnalysis) {
  const o = origAnalysis;
  const c = candAnalysis;
  return [
    {
      metric: 'AI Writing Risk Score',
      origNum: o.finalScore, impNum: c.finalScore,
      origVal: o.finalScore + '%', impVal: c.finalScore + '%',
      unit: '%', higherIsBetter: false,
    },
    {
      metric: 'Keragaman Kosakata (TTR)',
      origNum: Math.round(o.features.vocabularyDiversity.ttr * 100),
      impNum:  Math.round(c.features.vocabularyDiversity.ttr * 100),
      origVal: Math.round(o.features.vocabularyDiversity.ttr * 100) + '%',
      impVal:  Math.round(c.features.vocabularyDiversity.ttr * 100) + '%',
      unit: '%', higherIsBetter: true,
    },
    {
      metric: 'Variasi Kalimat (CV)',
      origNum: Math.round(o.features.sentenceUniformity.raw.cv * 100),
      impNum:  Math.round(c.features.sentenceUniformity.raw.cv * 100),
      origVal: (o.features.sentenceUniformity.raw.cv * 100).toFixed(1) + '%',
      impVal:  (c.features.sentenceUniformity.raw.cv * 100).toFixed(1) + '%',
      unit: '%', higherIsBetter: true,
    },
    {
      metric: 'Repetisi Kata',
      origNum: Math.round(o.features.lexicalRepetition.score),
      impNum:  Math.round(c.features.lexicalRepetition.score),
      origVal: Math.round(o.features.lexicalRepetition.score) + '%',
      impVal:  Math.round(c.features.lexicalRepetition.score) + '%',
      unit: '%', higherIsBetter: false,
    },
    {
      metric: 'Repetisi Frasa',
      origNum: Math.round(o.features.phraseRepetition.score),
      impNum:  Math.round(c.features.phraseRepetition.score),
      origVal: Math.round(o.features.phraseRepetition.score) + '%',
      impVal:  Math.round(c.features.phraseRepetition.score) + '%',
      unit: '%', higherIsBetter: false,
    },
    {
      metric: 'Keseragaman Struktur',
      origNum: Math.round(o.features.structuralConsistency.score),
      impNum:  Math.round(c.features.structuralConsistency.score),
      origVal: Math.round(o.features.structuralConsistency.score) + '%',
      impVal:  Math.round(c.features.structuralConsistency.score) + '%',
      unit: '%', higherIsBetter: false,
    },
    {
      metric: 'Variasi Tanda Baca',
      origNum: Math.round(o.features.punctuationVariation.score),
      impNum:  Math.round(c.features.punctuationVariation.score),
      origVal: Math.round(o.features.punctuationVariation.score) + '%',
      impVal:  Math.round(c.features.punctuationVariation.score) + '%',
      unit: '%', higherIsBetter: false,
    },
    {
      metric: 'Burstiness (Variasi Ritme)',
      origNum: Math.round(o.features.burstiness.score),
      impNum:  Math.round(c.features.burstiness.score),
      origVal: Math.round(o.features.burstiness.score) + '%',
      impVal:  Math.round(c.features.burstiness.score) + '%',
      unit: '%', higherIsBetter: false,
    },
    {
      metric: 'Rata-rata Panjang Kalimat',
      origNum: o.features.sentenceUniformity.raw.mean,
      impNum:  c.features.sentenceUniformity.raw.mean,
      origVal: o.features.sentenceUniformity.raw.mean + ' kata',
      impVal:  c.features.sentenceUniformity.raw.mean + ' kata',
      unit: 'kata', higherIsBetter: null,
    },
    {
      metric: 'Jumlah Kata',
      origNum: o.wordCount, impNum: c.wordCount,
      origVal: o.wordCount.toLocaleString('id-ID'),
      impVal:  c.wordCount.toLocaleString('id-ID'),
      unit: 'kata', higherIsBetter: null,
    },
  ];
}

/**
 * Render the candidate ranking summary table inside #candRankingTableBody.
 */
function renderCandidateRankingTable(ranking, activeCandNum) {
  const tbody = $('candRankingTableBody');
  if (!tbody) return;
  tbody.innerHTML = ranking.map(c => {
    const isActive  = c.candNum === activeCandNum;
    const rowClass  = isActive ? 'cand-row-active' : '';
    const labelCls  = c.rankNum === 1 ? 'cand-label-best' : c.rankNum === 2 ? 'cand-label-ok' : 'cand-label-review';
    const passedBadge = c.validation.passes
      ? '<span class="cand-badge-pass">✓ Tervalidasi</span>'
      : '<span class="cand-badge-fail">— Tidak Tervalidasi</span>';
    return `<tr class="${rowClass}" data-cand="${c.candNum - 1}" role="button" tabindex="0"
        aria-label="Pilih Kandidat ${c.candNum}">
      <td class="cand-num-cell">Kandidat ${c.candNum}</td>
      <td><span class="cand-qual-label ${labelCls}">${c.qualityLabel}</span></td>
      <td class="cand-qi-cell">${c.qualityIndex}<small>/100</small></td>
      <td>${passedBadge}</td>
    </tr>`;
  }).join('');

  // Row click handler — switch candidate
  tbody.querySelectorAll('tr[data-cand]').forEach(row => {
    const handler = () => {
      const idx = parseInt(row.dataset.cand, 10);
      if (_allCandidates && _origAnalysisForCmp) {
        _chosenCandidateIdx = idx;
        renderCandidatePreview(idx);
      }
    };
    row.addEventListener('click', handler);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
}

/**
 * Render the metric comparison table inside #candMetricTableBody.
 * Reuses renderComparisonTable logic but targets a different tbody.
 */
function renderCandidateMetricTable(rows) {
  const tbody = $('candMetricTableBody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(row => {
    const diff = row.impNum - row.origNum;
    let arrowHtml;
    if (row.higherIsBetter === null || Math.abs(diff) < 0.5) {
      arrowHtml = `<span class="cmp-arrow-same">—</span>`;
    } else {
      const isImprovement = row.higherIsBetter ? diff > 0 : diff < 0;
      const sign = diff > 0 ? '↑ +' : '↓ ';
      const cls  = isImprovement ? 'cmp-arrow-up' : 'cmp-arrow-down';
      const valStr = row.unit === '%' || row.unit === 'kata'
        ? `${Math.abs(diff).toFixed(row.unit === '%' ? 0 : 1)} ${row.unit}`
        : Math.abs(diff);
      const label = isImprovement ? 'Membaik' : 'Berubah';
      arrowHtml = `<span class="${cls}">${sign}${valStr} ${label}</span>`;
    }
    return `<tr>
      <td style="font-weight:600;color:var(--text-primary);white-space:nowrap;">${row.metric}</td>
      <td class="cmp-orig">${row.origVal}</td>
      <td class="cmp-impr">${row.impVal}</td>
      <td>${arrowHtml}</td>
    </tr>`;
  }).join('');
}

/**
 * Update the score summary strip at the top of the preview card.
 */
function renderCandidateScoreSummary(origAnalysis, candAnalysis, cand) {
  const el = $('candScoreSummary');
  if (!el) return;
  const delta    = candAnalysis.finalScore - origAnalysis.finalScore;
  const deltaStr = delta === 0 ? '±0%' : (delta > 0 ? `↑ +${delta}%` : `↓ ${Math.abs(delta)}%`);
  const deltaClass = delta > 0 ? 'cand-delta-up' : delta < 0 ? 'cand-delta-down' : 'cand-delta-same';
  el.innerHTML = `
    <div class="cand-score-block">
      <div class="cand-score-label">Teks Asli</div>
      <div class="cand-score-val">${origAnalysis.finalScore}%</div>
      <div class="cand-score-sub">AI Writing Risk Score</div>
    </div>
    <div class="cand-score-arrow">→</div>
    <div class="cand-score-block">
      <div class="cand-score-label">Kandidat ${cand.candNum}</div>
      <div class="cand-score-val">${candAnalysis.finalScore}%</div>
      <div class="cand-score-sub">Perubahan skor pola tulisan</div>
    </div>
    <div class="cand-score-block">
      <div class="cand-score-label">Perubahan</div>
      <div class="cand-score-val ${deltaClass}">${deltaStr}</div>
      <div class="cand-score-sub" style="font-size:0.72rem;max-width:140px;">Bukan ukuran keaslian tulisan</div>
    </div>`;
}

/**
 * Build the "Mengapa Kandidat Ini Dipilih?" explanation block.
 */
function renderCandidateWhyBlock(cand, origAnalysis) {
  const el = $('candWhyBlock');
  if (!el) return;
  const v = cand.validation;
  const reasons = [];
  if (v.lexDiff   >= 2) reasons.push(`pengurangan repetisi kata (−${Math.round(v.lexDiff)} poin)`);
  if (v.phraseDiff >= 2) reasons.push(`pengurangan repetisi frasa (−${Math.round(v.phraseDiff)} poin)`);
  if (v.unifDiff  >= 2) reasons.push(`variasi panjang kalimat meningkat (−${Math.round(v.unifDiff)} poin keseragaman)`);
  if (v.burstDiff >= 2) reasons.push(`variasi ritme kalimat meningkat (−${Math.round(v.burstDiff)} poin)`);
  if (v.vocabDiff >= 2) reasons.push(`keragaman kosakata meningkat (−${Math.round(v.vocabDiff)} poin)`);
  const wc = cand.analysis.wordCount / Math.max(1, origAnalysis.wordCount);
  if (wc >= 0.92 && wc <= 1.08) reasons.push(`jumlah kata tetap mendekati teks asli (${cand.analysis.wordCount} kata)`);

  const body = reasons.length > 0
    ? `<ul class="cand-why-list">${reasons.map(r => `<li>${r}</li>`).join('')}</ul>`
    : `<p style="color:var(--text-muted);font-size:0.82rem;">Tidak ada peningkatan signifikan yang terdeteksi pada kandidat ini.</p>`;

  el.innerHTML = `
    <p class="cand-why-intro">Kandidat ${cand.candNum} dari 3 — dipilih berdasarkan Writing Pattern Quality Index (${cand.qualityIndex}/100)</p>
    ${body}`;
}

/**
 * Render the full candidate preview card for a given 0-based candidate index.
 * Uses stored _allCandidates and _origAnalysisForCmp — no regeneration.
 */
function renderCandidatePreview(candIdx) {
  if (!_allCandidates || !_origAnalysisForCmp) return;
  const cand     = _allCandidates[candIdx];
  const origAna  = _origAnalysisForCmp;
  const candAna  = cand.analysis;

  // ── Candidate selector tabs ──────────────────────────────
  document.querySelectorAll('.cand-tab').forEach(tab => {
    const active = parseInt(tab.dataset.candIdx, 10) === candIdx;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  // ── Score summary ─────────────────────────────────────────
  renderCandidateScoreSummary(origAna, candAna, cand);

  // ── Text panels — use structured rendering ────────────────
  const origTxtEl = $('candOrigText');
  const candTxtEl = $('candImpText');
  if (origTxtEl) renderPanel(_origDocument || origAna.text, origTxtEl);
  if (candTxtEl) renderPanel(cand.document  || cand.text,   candTxtEl);

  // ── Metric table ──────────────────────────────────────────
  const rows = buildCandidateCompareRows(origAna, candAna);
  renderCandidateMetricTable(rows);

  // ── Why block ─────────────────────────────────────────────
  renderCandidateWhyBlock(cand, origAna);

  // ── Ranking table (highlights active row) ─────────────────
  renderCandidateRankingTable(_allCandidates, cand.candNum);

  // ── Accept button label update ────────────────────────────
  const acceptBtn = $('candAcceptBtn');
  if (acceptBtn) {
    const isExperimental = !cand.validation.passes;
    acceptBtn.textContent = isExperimental
      ? `⚠ Gunakan Kandidat ${cand.candNum} (Eksperimental)`
      : `✓ Gunakan Kandidat ${cand.candNum}`;
    acceptBtn.className = isExperimental
      ? 'btn btn-ghost cand-accept-experimental'
      : 'btn btn-primary';
  }

  // ── Experimental warning ──────────────────────────────────
  const warnEl = $('candExperimentalWarn');
  if (warnEl) {
    warnEl.classList.toggle('hidden', cand.validation.passes);
  }

  $('candidatePreviewCard').classList.remove('hidden');
  $('candidatePreviewCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Accept the currently previewed candidate — use its stored analysis without
 * regenerating any text. Updates the main Writing Improver panels + history.
 */
function acceptCandidate() {
  if (!_allCandidates || !_origAnalysisForCmp) return;
  const cand       = _allCandidates[_chosenCandidateIdx];
  const candText   = cand.text;
  const candAnalysis = cand.analysis;
  const origAnalysis = _origAnalysisForCmp;

  // Store as active improved result
  _lastImprovedText     = candText;
  _lastImprovedAnalysis = candAnalysis;

  // Resolve document objects
  const origDoc = _origDocument || parseDocument(origAnalysis.text);
  const impDoc  = cand.document  || parseDocument(candText);
  _improvedDocument = impDoc;

  // ── Structure validation microcopy ─────────────────────────
  const structCheck   = validateDocumentStructure(origDoc, impDoc);
  const structStatus  = $('structureStatus');
  if (structStatus) {
    structStatus.textContent  = structCheck.message;
    structStatus.className    = 'structure-status ' + (structCheck.ok ? 'ok' : 'warn');
    structStatus.style.display = '';
  }

  // Update main text panels using structured rendering
  renderPanel(origDoc, $('originalTextPanel'));
  renderPanel(origDoc, $('compareOrigPanel'));
  renderPanel(impDoc,  $('improvedTextPanel'));
  renderPanel(impDoc,  $('compareImpPanel'));

  // Show panels, switch to improved tab
  $('improverPanels').classList.remove('hidden');
  $('improverFailsafe').classList.add('hidden');
  $('candidatePreviewCard').classList.add('hidden');
  document.querySelectorAll('.view-tab').forEach(t => {
    t.classList.remove('active'); t.setAttribute('aria-selected', 'false');
  });
  const impTab = document.querySelector('.view-tab[data-view="improved"]');
  if (impTab) { impTab.classList.add('active'); impTab.setAttribute('aria-selected', 'true'); }
  ['view-original','view-improved','view-compare'].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('hidden', id !== 'view-improved');
  });

  // Evaluasi card
  renderEvaluasi(origAnalysis, candAnalysis);

  // Change log
  const changeMade = buildChangeMade(cand);
  renderChangeLog(changeMade);

  // Comparison
  const compareRows = compareTexts(origAnalysis, candAnalysis);
  renderComparisonTable(compareRows);
  renderComparisonCharts(origAnalysis, candAnalysis);
  $('comparisonCard').classList.remove('hidden');

  // Persist to history — includes all 3 candidates
  if (currentAnalysis) {
    updateHistoryWithImprovement(currentAnalysis.timestamp, {
      improvedText:     candText,
      improvedAnalysis: candAnalysis,
      changeMade,
      allCandidates:    _allCandidates,
      chosenCandidateIdx: _chosenCandidateIdx,
      failsafeState:    _failsafeState,
    });
  }

  showImproveAgainBtn(true);
  showToast(`Kandidat ${cand.candNum} diterima sebagai hasil perbaikan.`, 'success');
  $('evaluasiCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Render the state-aware fail-safe panel.
 * STATE A (validated) — never shown (flow goes directly to success path)
 * STATE B (mixed)     — "beberapa peningkatan" message + Lihat Kandidat Terbaik
 * STATE C (none)      — "tidak ada yang lebih baik" message + Lihat Kandidat Terbaik (Eksperimental)
 */
function renderFailsafePanel(state, ranking) {
  const panel  = $('improverFailsafe');
  const desc   = $('failsafeDesc');
  const btnRow = $('failsafeActions');
  if (!panel || !desc || !btnRow) return;

  const bestCand = ranking ? ranking.find(c => c.rankNum === 1) : null;

  if (state === 'mixed') {
    panel.className = 'improver-failsafe mixed';
    $('failsafeTitle').textContent = 'Tidak Ada Revisi yang Sepenuhnya Memenuhi Kriteria';
    desc.textContent = 'Tidak ada kandidat yang melewati semua ambang batas validasi, tetapi terdapat kandidat yang memiliki beberapa peningkatan terukur. Anda dapat memeriksa kandidat terbaik sebelum memutuskan.';
    const viewBtn = $('failsafeViewBest');
    if (viewBtn) viewBtn.textContent = `Lihat Kandidat Terbaik`;
  } else {
    panel.className = 'improver-failsafe';
    $('failsafeTitle').textContent = 'Tidak Ada Revisi yang Lebih Baik Ditemukan';
    desc.textContent = 'Ketiga kandidat tidak berhasil meningkatkan pola tulisan secara terukur. Anda masih dapat memeriksa kandidat terbaik sebagai bahan perbandingan.';
    const viewBtn = $('failsafeViewBest');
    if (viewBtn) viewBtn.textContent = `Lihat Kandidat Eksperimental`;
  }

  panel.classList.remove('hidden');
}

/**
 * Core improvement workflow — shared by first pass and "Perbaiki Lagi".
 * @param {string} inputText   — text to improve (original or last improved)
 * @param {object} origAnalysis — the ORIGINAL (first) analysis for comparison display
 * @param {boolean} isSecondPass — true when called from runImproverAgain
 */
async function runImproverPass(inputText, origAnalysis, isSecondPass) {
  const btn = isSecondPass ? $('improveAgainBtn') : $('improveBtn');
  if (btn) btn.disabled = true;

  // Hide all result panels before starting
  $('improverLoading').classList.remove('hidden');
  $('improverPanels').classList.add('hidden');
  $('changeLog').classList.add('hidden');
  $('comparisonCard').classList.add('hidden');
  $('evaluasiCard').classList.add('hidden');
  $('improverFailsafe').classList.add('hidden');
  $('candidatePreviewCard').classList.add('hidden');

  try {
    setStatus('analyzing', 'Memperbaiki tulisan...');
    await animateLoadingSteps();
    await new Promise(r => setTimeout(r, 300));

    // v3 engine — returns { improvedText, changeMade[], validation, usedOriginal,
    //                        allCandidates, ranking, failsafeState, bestCandidateIdx }
    const result = generateImprovedText(inputText, improverState);
    const { improvedText, changeMade, usedOriginal, allCandidates, ranking,
            failsafeState, bestCandidateIdx } = result;

    // ── Store candidate state (always, regardless of path) ──────────────────
    _allCandidates      = allCandidates;
    _origAnalysisForCmp = origAnalysis;
    _chosenCandidateIdx = bestCandidateIdx;
    _failsafeState      = failsafeState;

    // ── FAIL-SAFE PATH ───────────────────────────────────────────────────────
    // No candidate passed strict validation.
    // Show state-aware panel and preserve original text.
    if (usedOriginal) {
      renderFailsafePanel(failsafeState, ranking);
      $('improverFailsafe').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const msg = failsafeState === 'mixed'
        ? 'Tidak ada revisi yang sepenuhnya tervalidasi. Periksa kandidat terbaik.'
        : 'Tidak ada revisi yang terbukti lebih baik. Teks asli dipertahankan.';
      setStatus('done', failsafeState === 'mixed' ? 'Hasil campuran' : 'Tidak ada perbaikan terukur');
      showToast(msg, 'info');
      return;
    }

    // ── SUCCESS PATH ─────────────────────────────────────────────────────────
    // At least one candidate passed validation.

    // The improvedText is already the best validated candidate text from the engine.
    // The analysis is stored in allCandidates — re-use it to avoid double calculation.
    const bestCand       = allCandidates[bestCandidateIdx];
    const improvedAnalysis = bestCand.analysis;

    _lastImprovedText     = improvedText;
    _lastImprovedAnalysis = improvedAnalysis;

    // Resolve document objects and store for panel re-rendering
    const origDocForPanel = result.origDocument || _origDocument || parseDocument(origAnalysis.text);
    const impDocForPanel  = bestCand.document   || parseDocument(improvedText);
    _origDocument     = origDocForPanel;
    _improvedDocument = impDocForPanel;

    // ── Structure validation microcopy ─────────────────────
    const structCheck = validateDocumentStructure(origDocForPanel, impDocForPanel);
    const structStatus = $('structureStatus');
    if (structStatus) {
      structStatus.textContent  = structCheck.message;
      structStatus.className    = 'structure-status ' + (structCheck.ok ? 'ok' : 'warn');
      structStatus.style.display = '';
    }

    // Populate text panels with structured rendering
    renderPanel(origDocForPanel, $('originalTextPanel'));
    renderPanel(origDocForPanel, $('compareOrigPanel'));
    renderPanel(impDocForPanel,  $('improvedTextPanel'));
    renderPanel(impDocForPanel,  $('compareImpPanel'));

    // Show panels, default to "Hasil Perbaikan" tab
    $('improverPanels').classList.remove('hidden');
    document.querySelectorAll('.view-tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    const impTab = document.querySelector('.view-tab[data-view="improved"]');
    if (impTab) { impTab.classList.add('active'); impTab.setAttribute('aria-selected', 'true'); }
    ['view-original','view-improved','view-compare'].forEach(id => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', id !== 'view-improved');
    });

    // Evaluasi card — honest before/after scoring
    renderEvaluasi(origAnalysis, improvedAnalysis);

    // Change log
    renderChangeLog(changeMade);

    // Comparison section
    const compareRows = compareTexts(origAnalysis, improvedAnalysis);
    renderComparisonTable(compareRows);
    renderComparisonCharts(origAnalysis, improvedAnalysis);
    $('comparisonCard').classList.remove('hidden');

    // Persist to history — include all 3 candidates
    if (currentAnalysis) {
      updateHistoryWithImprovement(currentAnalysis.timestamp, {
        improvedText,
        improvedAnalysis,
        changeMade,
        allCandidates,
        chosenCandidateIdx: bestCandidateIdx,
        failsafeState,
      });
    }

    showImproveAgainBtn(!isSecondPass);
    setStatus('done', 'Selesai');
    showToast(isSecondPass ? 'Perbaikan tahap 2 selesai!' : 'Perbaikan tulisan selesai!', 'success');
    $('evaluasiCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (err) {
    console.error('Improver error:', err);
    showToast('Perbaikan tulisan gagal. Silakan coba lagi.', 'error');
    setStatus('error', 'Error');
  } finally {
    $('improverLoading').classList.add('hidden');
    if (btn) btn.disabled = false;
  }
}

/**
 * Run first improvement pass on the original analyzed text.
 */
async function runImprover() {
  if (!currentAnalysis) {
    showToast('Analisis teks dulu sebelum menggunakan Writing Improver.', 'error');
    return;
  }
  // Seed _origDocument from current analysis text on every fresh run
  _origDocument = parseDocument(currentAnalysis.text);
  await runImproverPass(currentAnalysis.text, currentAnalysis, false);
}

/**
 * Run a second improvement pass on the already-improved text.
 * Comparison always shows delta vs ORIGINAL for clarity.
 */
async function runImproverAgain() {
  if (!currentAnalysis || !_lastImprovedText) {
    showToast('Jalankan perbaikan pertama dulu.', 'error');
    return;
  }
  await runImproverPass(_lastImprovedText, currentAnalysis, true);
}

/**
 * Reset Writing Improver to initial state.
 */
function resetImprover() {
  $('improverPanels').classList.add('hidden');
  $('changeLog').classList.add('hidden');
  $('comparisonCard').classList.add('hidden');
  $('evaluasiCard').classList.add('hidden');
  $('improverFailsafe').classList.add('hidden');
  $('candidatePreviewCard').classList.add('hidden');
  showImproveAgainBtn(false);
  _lastImprovedText     = null;
  _lastImprovedAnalysis = null;
  _allCandidates        = null;
  _origAnalysisForCmp   = null;
  _chosenCandidateIdx   = 0;
  _failsafeState        = null;
  _origDocument         = null;
  _improvedDocument     = null;
  const structStatus = $('structureStatus');
  if (structStatus) structStatus.style.display = 'none';

  document.querySelectorAll('#writingGoalGroup .btn-toggle').forEach(b => {
    b.classList.toggle('active', b.dataset.value === 'academic');
  });
  document.querySelectorAll('#intensityGroup .btn-toggle').forEach(b => {
    b.classList.toggle('active', b.dataset.value === 'moderate');
  });
  improverState.goal      = 'academic';
  improverState.intensity = 'moderate';

  showToast('Writing Improver direset.', 'info');
}

/* ============================================================

/* ============================================================
   MODULE: EDITOR MODE
   Manual suggestion-by-suggestion interface.
   The user sees: Problem → Suggestion → Reason → [Terapkan] / [Lewati]
   ============================================================ */

/** State for the Editor Mode */
const _editorState = {
  suggestions: [],  // Array<{id, type, typeCls, label, problem, suggestion, reason, count, action, word?}>
  decisions:   {},  // id → 'applied' | 'skipped'
};

/**
 * Build editor suggestions from the writing diagnosis.
 * Each suggestion targets a specific named problem with a concrete action.
 */
function buildEditorSuggestions(sentences, wordFreq) {
  const totalWords = Object.values(wordFreq).reduce((a,b)=>a+b,0);
  const suggestions = [];

  // ── Transition overuse ───────────────────────────────────────────────────
  const transitionCounts = {};
  sentences.forEach(s => {
    const s_lc = s.toLowerCase().trim();
    TRANSITION_PATTERNS.forEach(tp => {
      if (tp.re.test(s_lc)) transitionCounts[tp.label] = (transitionCounts[tp.label]||0) + 1;
    });
  });
  Object.entries(transitionCounts).forEach(([label, count]) => {
    if (count >= 2) {
      const alts = `hapus ${Math.max(1,count-1)} penggunaan yang tidak esensial`;
      suggestions.push({
        id: `trans_${label.replace(/\s/g,'_')}`,
        type: 'transition', typeCls: 'sug-type-transition', label: 'Transisi Berulang',
        problem:    `"${label}" muncul ${count} kali sebagai pembuka kalimat.`,
        suggestion: `${alts.charAt(0).toUpperCase()+alts.slice(1)}. Hubungan antar ide sering lebih kuat tanpa penanda transisi yang eksplisit.`,
        reason:     'Transisi berulang membuat tulisan terdengar mekanik. Teks akademik yang baik mengalir secara logis tanpa penanda koneksi di setiap kalimat.',
        count, action: 'remove_transition', word: label,
      });
    }
  });

  // ── Repeated sentence openings ───────────────────────────────────────────
  const openingFreq = {};
  sentences.forEach(s => {
    const fw = s.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (fw && !STOP_WORDS.has(fw)) openingFreq[fw] = (openingFreq[fw]||0) + 1;
  });
  Object.entries(openingFreq).forEach(([word, count]) => {
    if (count >= 3) {
      suggestions.push({
        id: `opening_${word}`,
        type: 'opening', typeCls: 'sug-type-opening', label: 'Pembuka Berulang',
        problem:    `Kata pembuka "${word}" digunakan ${count} kali untuk memulai kalimat.`,
        suggestion: `Variasikan ${count-1} penggunaan selanjutnya — mulai dari klausa yang berbeda, atau susun ulang subjek-predikat.`,
        reason:     'Pembuka yang seragam menciptakan pola mekanik. Variasi pembuka mencerminkan keberagaman ekspresi.',
        count, action: 'change_opening', word,
      });
    }
  });

  // ── Overused non-technical words ─────────────────────────────────────────
  Object.entries(wordFreq).forEach(([word, count]) => {
    if (STOP_WORDS.has(word) || word.length <= 3 || !SYNONYM_MAP[word]) return;
    const rate = count / Math.max(1,totalWords) * 100;
    if (rate >= 2.5 && count >= 4) {
      const alts = SYNONYM_MAP[word].slice(0,2).join(', ');
      suggestions.push({
        id: `word_${word}`,
        type: 'repetition', typeCls: 'sug-type-repetition', label: 'Kata Berulang',
        problem:    `Kata "${word}" muncul ${count} kali (${rate.toFixed(1)}% dari teks).`,
        suggestion: `Kurangi sekitar setengah penggunaan dengan sinonim seperti "${alts}", atau susun ulang kalimat agar kata tidak diperlukan.`,
        reason:     'Pengulangan kata non-teknis yang berlebihan mengurangi kekayaan kosakata dan menciptakan pola yang terasa seragam.',
        count, action: 'reduce_word', word,
      });
    }
  });

  // ── Very long sentences ──────────────────────────────────────────────────
  const lengths = sentences.map(s => s.split(/\s+/).filter(w=>w).length);
  const longIdx = lengths.reduce((acc,l,i) => { if (l>35) acc.push(i); return acc; }, []);
  if (longIdx.length >= 2) {
    suggestions.push({
      id: 'long_sentences',
      type: 'length', typeCls: 'sug-type-length', label: 'Kalimat Terlalu Panjang',
      problem:    `${longIdx.length} kalimat memiliki lebih dari 35 kata.`,
      suggestion: `Pecah kalimat-kalimat tersebut di titik konjungsi (namun, karena, sehingga) atau di koma tengah.`,
      reason:     'Kalimat sangat panjang sulit diikuti dan sering memuat beberapa argumen yang lebih baik dipisahkan.',
      count: longIdx.length, action: 'split_sentences', indices: longIdx,
    });
  }

  return suggestions;
}

/**
 * Render the editor suggestion cards.
 */
function renderEditorSuggestions(suggestions) {
  const container = $('editorSuggestionsList');
  if (!container) return;

  if (suggestions.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:1rem 0;">
      <div class="empty-icon">✓</div>
      <p>Tidak ada masalah signifikan yang terdeteksi.</p>
    </div>`;
    const footer = $('editorModeFooter');
    if (footer) footer.classList.add('hidden');
    return;
  }

  container.innerHTML = suggestions.map(sug => `
    <div class="editor-suggestion" id="esug-${sug.id}" data-sug-id="${sug.id}">
      <div class="editor-sug-header">
        <div>
          <span class="editor-sug-type ${sug.typeCls}">${sug.label}</span>
          <p class="editor-sug-problem">${escapeHtml(sug.problem)}</p>
        </div>
        <span class="editor-sug-count">${sug.count}×</span>
      </div>
      <p class="editor-sug-reason"><em>Saran:</em> ${escapeHtml(sug.suggestion)}</p>
      <p class="editor-sug-reason"><em>Alasan:</em> ${escapeHtml(sug.reason)}</p>
      <div class="editor-sug-actions">
        <button class="btn btn-primary btn-sm" data-action="apply" data-sug-id="${sug.id}">Terapkan</button>
        <button class="btn btn-ghost btn-sm"   data-action="skip"  data-sug-id="${sug.id}">Lewati</button>
      </div>
    </div>`).join('');

  const footer = $('editorModeFooter');
  if (footer) footer.classList.remove('hidden');
  updateEditorAppliedCount();
}

/** Update the "N saran diterapkan" counter */
function updateEditorAppliedCount() {
  const applied = Object.values(_editorState.decisions).filter(d => d === 'applied').length;
  const el = $('editorAppliedCount');
  if (el) el.textContent = `${applied} saran diterapkan`;
}

/** Handle Terapkan / Lewati button click for a suggestion */
function handleEditorDecision(sugId, decision) {
  _editorState.decisions[sugId] = decision;
  const el = $(`esug-${sugId}`);
  if (!el) return;
  el.classList.remove('applied','skipped');
  el.classList.add(decision);
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.disabled = btn.dataset.action === decision;
    btn.style.opacity = btn.dataset.action === decision ? '0.5' : '';
  });
  updateEditorAppliedCount();
}

/**
 * Apply only the suggestions marked 'applied' to produce a revised text,
 * then display the result in the Writing Improver panels.
 */
function applyEditorSuggestions(sugIds) {
  if (!currentAnalysis) return;
  const sentences = getSentences(currentAnalysis.text);
  const wordFreq = {};
  getWords(currentAnalysis.text).forEach(w => { wordFreq[w] = (wordFreq[w]||0)+1; });
  const transitionCounts = {};
  sentences.forEach(s => {
    const s_lc = s.toLowerCase().trim();
    TRANSITION_PATTERNS.forEach(tp => {
      if (tp.re.test(s_lc)) transitionCounts[tp.label] = (transitionCounts[tp.label]||0)+1;
    });
  });

  const classification = classifySentences(sentences, wordFreq);
  const lastReplacedAt = {};
  const openingOccurrences = {};
  const changeLog = { synonymsReplaced:0, transitionsRemoved:0, openingsVaried:0,
                      sentencesSplit:0, sentencesCombined:0, keptSentences:0 };

  const activeSugs = _editorState.suggestions.filter(s => sugIds.includes(s.id));
  const hasTransition = activeSugs.some(s => s.action === 'remove_transition');
  const wordSugs      = activeSugs.filter(s => s.action === 'reduce_word');
  const hasSplit      = activeSugs.some(s => s.action === 'split_sentences');
  const hasOpening    = activeSugs.some(s => s.action === 'change_opening');

  const result = [];
  let i = 0;
  while (i < sentences.length) {
    const cl = classification[i];
    let s = sentences[i];

    const fw = s.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (!STOP_WORDS.has(fw)) openingOccurrences[fw] = (openingOccurrences[fw]||0)+1;
    const occNum = (openingOccurrences[fw]||1)-1;

    if (hasSplit && cl.issues.includes('too_long')) {
      const parts = strategySplitSentence(s);
      if (parts.length > 1) { result.push(...parts); changeLog.sentencesSplit++; i++; continue; }
    }
    if (hasTransition && cl.issues.includes('overused_transition')) {
      const tp = TRANSITION_PATTERNS.find(p => p.re.test(s.toLowerCase().trim()));
      if (tp) {
        const sug = activeSugs.find(s2 => s2.word === tp.label && s2.action === 'remove_transition');
        if (sug) {
          const rev = strategyRemoveTransition(s, tp.label);
          if (rev !== s) { s = rev; changeLog.transitionsRemoved++; }
        }
      }
    }
    if (hasOpening && cl.issues.includes('repeated_opening') && occNum >= 1) {
      const rev = strategyChangeOpening(s, occNum);
      if (rev !== s) { s = rev; changeLog.openingsVaried++; }
    }
    if (wordSugs.length > 0) {
      const rev = strategyReduceRedundancy(s, wordFreq, lastReplacedAt, i, 3, 2);
      if (rev !== s) { s = rev; changeLog.synonymsReplaced++; }
    }

    result.push(s);
    i++;
  }

  const revisedText     = result.join(' ');
  const revisedAnalysis = analyzeText(revisedText);

  // Use structured rendering for editor-mode results
  const origDoc = _origDocument || parseDocument(currentAnalysis.text);
  const revDoc  = parseDocument(revisedText);
  _origDocument     = origDoc;
  _improvedDocument = revDoc;

  renderPanel(origDoc, $('originalTextPanel'));
  renderPanel(origDoc, $('compareOrigPanel'));
  renderPanel(revDoc,  $('improvedTextPanel'));
  renderPanel(revDoc,  $('compareImpPanel'));

  $('editorModePanel').classList.add('hidden');
  $('improverPanels').classList.remove('hidden');
  document.querySelectorAll('.view-tab').forEach(t => {
    t.classList.remove('active'); t.setAttribute('aria-selected','false');
  });
  const impTab = document.querySelector('.view-tab[data-view="improved"]');
  if (impTab) { impTab.classList.add('active'); impTab.setAttribute('aria-selected','true'); }
  ['view-original','view-improved','view-compare'].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('hidden', id !== 'view-improved');
  });

  renderEvaluasi(currentAnalysis, revisedAnalysis);
  renderChangeLog(buildChangeMade({ changeLog }));
  const compareRows = compareTexts(currentAnalysis, revisedAnalysis);
  renderComparisonTable(compareRows);
  renderComparisonCharts(currentAnalysis, revisedAnalysis);
  $('comparisonCard').classList.remove('hidden');

  _lastImprovedText     = revisedText;
  _lastImprovedAnalysis = revisedAnalysis;
  showImproveAgainBtn(true);
  setStatus('done','Selesai');
  showToast('Saran editor diterapkan.','success');
  $('evaluasiCard').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

/** Open Editor Mode — run diagnosis and render suggestion list */
function openEditorMode() {
  if (!currentAnalysis) {
    showToast('Analisis teks dulu sebelum menggunakan Mode Editor.', 'error');
    return;
  }
  const sentences = getSentences(currentAnalysis.text);
  const wordFreq  = {};
  getWords(currentAnalysis.text).forEach(w => { wordFreq[w] = (wordFreq[w]||0)+1; });

  _editorState.suggestions = buildEditorSuggestions(sentences, wordFreq);
  _editorState.decisions   = {};

  renderEditorSuggestions(_editorState.suggestions);
  $('editorModePanel').classList.remove('hidden');
  $('editorModePanel').scrollIntoView({ behavior:'smooth', block:'nearest' });
}


/* ============================================================
   INIT EXTENSION — all new feature event handlers
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Writing Improver controls
  initBtnGroup('writingGoalGroup', 'goal');
  initBtnGroup('intensityGroup', 'intensity');
  initViewTabs();

  $('improveBtn')?.addEventListener('click', runImprover);
  $('improveAgainBtn')?.addEventListener('click', runImproverAgain);
  $('improveResetBtn')?.addEventListener('click', resetImprover);

  // Format toggle (Document View / Plain Text View)
  document.querySelectorAll('.format-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.format-toggle-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      applyFormatMode(btn.dataset.format);
    });
  });

  // Editor Mode
  $('editorModeBtn')?.addEventListener('click', openEditorMode);
  $('editorModeClose')?.addEventListener('click', () => {
    $('editorModePanel').classList.add('hidden');
  });

  // Editor suggestion decisions (event delegation on the suggestions list)
  $('editorSuggestionsList')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const sugId  = btn.dataset.sugId;
    if (action === 'apply' || action === 'skip') {
      handleEditorDecision(sugId, action === 'apply' ? 'applied' : 'skipped');
    }
  });

  // "Terapkan Semua" — applies all un-skipped suggestions
  $('editorApplyAllBtn')?.addEventListener('click', () => {
    const ids = _editorState.suggestions.map(s => s.id);
    // Mark all not-yet-decided as applied
    ids.forEach(id => {
      if (!_editorState.decisions[id]) handleEditorDecision(id, 'applied');
    });
    const appliedIds = Object.entries(_editorState.decisions)
      .filter(([,v]) => v === 'applied').map(([k]) => k);
    if (appliedIds.length === 0) {
      showToast('Tidak ada saran yang diterapkan.', 'error');
      return;
    }
    applyEditorSuggestions(appliedIds);
  });

  // "Lihat Hasil" — applies only marked suggestions
  $('editorPreviewBtn')?.addEventListener('click', () => {
    const appliedIds = Object.entries(_editorState.decisions)
      .filter(([,v]) => v === 'applied').map(([k]) => k);
    if (appliedIds.length === 0) {
      showToast('Tandai setidaknya satu saran sebagai "Terapkan" terlebih dahulu.', 'error');
      return;
    }
    applyEditorSuggestions(appliedIds);
  });

  // Fail-safe panel buttons
  $('failsafeUseOriginal')?.addEventListener('click', () => {
    if (!currentAnalysis) return;
    const origDoc = _origDocument || parseDocument(currentAnalysis.text);
    _origDocument     = origDoc;
    _improvedDocument = origDoc;
    renderPanel(origDoc, $('originalTextPanel'));
    renderPanel(origDoc, $('improvedTextPanel'));
    renderPanel(origDoc, $('compareOrigPanel'));
    renderPanel(origDoc, $('compareImpPanel'));
    $('improverFailsafe').classList.add('hidden');
    $('candidatePreviewCard').classList.add('hidden');
    $('improverPanels').classList.remove('hidden');
    document.querySelectorAll('.view-tab').forEach(t => {
      t.classList.remove('active'); t.setAttribute('aria-selected', 'false');
    });
    const origTab = document.querySelector('.view-tab[data-view="original"]');
    if (origTab) { origTab.classList.add('active'); origTab.setAttribute('aria-selected', 'true'); }
    ['view-original','view-improved','view-compare'].forEach(id => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', id !== 'view-original');
    });
    showToast('Teks asli ditampilkan.', 'info');
  });

  $('failsafeViewBest')?.addEventListener('click', () => {
    if (!_allCandidates || !_origAnalysisForCmp) return;
    $('improverFailsafe').classList.add('hidden');
    renderCandidatePreview(_chosenCandidateIdx);
  });

  $('failsafeTryManual')?.addEventListener('click', () => {
    $('improverFailsafe').classList.add('hidden');
    $('candidatePreviewCard').classList.add('hidden');
    const ta = $('textInput');
    if (ta) { ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); ta.focus(); }
    showToast('Edit teks secara manual di area input, lalu analisis kembali.', 'info');
  });

  // Candidate preview tab buttons (dynamically rendered — use event delegation)
  document.addEventListener('click', e => {
    const tab = e.target.closest('.cand-tab');
    if (tab && _allCandidates) {
      const idx = parseInt(tab.dataset.candIdx, 10);
      if (!isNaN(idx)) {
        _chosenCandidateIdx = idx;
        renderCandidatePreview(idx);
      }
    }
  });

  // Accept candidate button
  $('candAcceptBtn')?.addEventListener('click', acceptCandidate);

  // Cancel / close preview (both ✕ button and "Kembali" button)
  const closeCandPreview = () => {
    $('candidatePreviewCard').classList.add('hidden');
    if (_failsafeState && _failsafeState !== 'validated') {
      renderFailsafePanel(_failsafeState, _allCandidates);
    }
  };
  $('candCancelBtn')?.addEventListener('click',  closeCandPreview);
  $('candCancelBtn2')?.addEventListener('click', closeCandPreview);

  // Copy improved text — use structured document for proper line-break preservation
  $('copyImprovedBtn')?.addEventListener('click', () => {
    const copyText = _improvedDocument
      ? reconstructDocumentText(_improvedDocument)
      : ($('improvedTextPanel')?.textContent || '');
    if (!copyText.trim()) { showToast('Belum ada teks yang diperbaiki.', 'error'); return; }
    navigator.clipboard.writeText(copyText).then(() => {
      showToast('Teks hasil perbaikan berhasil disalin!', 'success');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = copyText; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      showToast('Teks berhasil disalin!', 'success');
    });
  });

  // History clear all
  $('clearHistoryBtn')?.addEventListener('click', deleteAllHistory);

  // History search & filter
  $('historySearch')?.addEventListener('input', e => {
    _historySearchTerm = e.target.value.trim();
    renderHistoryList();
  });
  $('historyFilter')?.addEventListener('change', e => {
    _historyFilter = e.target.value;
    renderHistoryList();
  });

  // History detail: back button
  $('backToHistoryBtn')?.addEventListener('click', () => {
    $('historyDetailView').classList.add('hidden');
    $('historyListView').classList.remove('hidden');
    renderHistoryList();
  });

  // History detail: re-analyze button
  $('reanalyzeBtn')?.addEventListener('click', () => {
    if (_openHistoryRecord) restoreAnalysisState(_openHistoryRecord);
  });
});
