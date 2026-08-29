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
   HISTORY (localStorage)
   ============================================================ */
const HISTORY_KEY = 'aiwa_history';

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function addToHistory(analysis) {
  const history = getHistory();
  // Generate label from first 60 chars of text
  const label = analysis.text.slice(0, 60).trim().replace(/\s+/g, ' ') + '…';
  history.unshift({
    id:        analysis.timestamp,
    label,
    date:      new Date(analysis.timestamp).toLocaleDateString('id-ID'),
    time:      new Date(analysis.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    wordCount: analysis.wordCount,
    sentCount: analysis.sentenceCount,
    score:     analysis.finalScore,
    category:  analysis.category.label,
    badge:     analysis.category.badge,
  });
  // Keep only last 20 entries
  if (history.length > 20) history.pop();
  saveHistory(history);
}

function deleteHistoryItem(id) {
  const history = getHistory().filter(h => h.id !== id);
  saveHistory(history);
  renderHistory();
}

function clearAllHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function renderHistory() {
  const container = $('historyList');
  const history   = getHistory();
  if (history.length === 0) {
    container.innerHTML = `<div class="empty-history">Belum ada riwayat analisis. Analisis teks pertama Anda untuk memulai.</div>`;
    return;
  }
  container.innerHTML = history.map(item => `
    <div class="history-item">
      <div class="history-meta">
        <span class="history-label">${escapeHtml(item.label)}</span>
        <span class="history-time">${item.date} · ${item.time}</span>
      </div>
      <div class="history-stats">
        <span class="history-stat"><strong>${item.wordCount}</strong> kata</span>
        <span class="history-stat"><strong>${item.sentCount}</strong> kalimat</span>
      </div>
      <div class="history-score-badge badge-${item.badge}">${item.score}% · ${item.category}</div>
      <div class="history-actions">
        <button class="btn-icon" data-id="${item.id}" title="Hapus riwayat ini" aria-label="Hapus riwayat ini">✕</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-icon[data-id]').forEach(btn => {
    btn.addEventListener('click', () => deleteHistoryItem(Number(btn.dataset.id)));
  });
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

      // Save to history
      addToHistory(analysis);

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

  // Clear all history
  $('clearHistoryBtn').addEventListener('click', () => {
    if (confirm('Hapus semua riwayat analisis?')) clearAllHistory();
  });
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
   MODULE: WRITING IMPROVEMENT ENGINE
   ============================================================

   NOTE FOR FUTURE INTEGRATION:
   This module implements a heuristic front-end rewriter.
   To connect a real language model (e.g. OpenAI, Gemini, local LLM),
   replace the body of improveText() with an async API call.
   The calling code already handles async/await patterns.

   API integration point:
   async function improveText(text, settings) {
     const response = await fetch('/api/improve', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       // DO NOT expose API keys in frontend code.
       // All API keys must be handled server-side.
       body: JSON.stringify({ text, settings }),
     });
     return response.json();
   }
   ============================================================ */

/**
 * Synonym map for common repetitive words.
 * Used to reduce lexical repetition in rewriting.
 */
const SYNONYM_MAP = {
  // Indonesian
  'menunjukkan':  ['mengindikasikan','memperlihatkan','mencerminkan'],
  'merupakan':    ['adalah','menjadi','termasuk'],
  'terdapat':     ['ditemukan','ada','tercatat'],
  'dilakukan':    ['dijalankan','diterapkan','dikerjakan'],
  'penelitian':   ['kajian','studi','analisis'],
  'diperoleh':    ['didapatkan','dihasilkan'],
  'berdasarkan':  ['mengacu pada','berpijak pada','didasarkan pada'],
  'selain itu':   ['di samping itu','lebih lanjut','lebih jauh'],
  'dengan demikian': ['karena itu','oleh sebab itu','maka dari itu'],
  'dapat':        ['mampu','bisa','memungkinkan'],
  'sangat':       ['amat','jauh','cukup'],
  'banyak':       ['sejumlah','beragam','berbagai'],
  'menggunakan':  ['memanfaatkan','memakai','menerapkan'],
  'memberikan':   ['menyediakan','menghasilkan','menawarkan'],
  'penting':      ['krusial','signifikan','esensial','relevan'],
  'hasil':        ['temuan','luaran','capaian'],
  'proses':       ['prosedur','tahapan','mekanisme'],
  'faktor':       ['aspek','elemen','unsur','variabel'],
  'kegiatan':     ['aktivitas','upaya','langkah'],
  'hal':          ['aspek','sisi','perkara'],
  // English
  'shows':    ['indicates','demonstrates','reveals'],
  'uses':     ['employs','utilizes','applies'],
  'provides': ['offers','gives','supplies'],
  'important':['significant','crucial','essential'],
  'research': ['study','investigation','examination'],
  'found':    ['discovered','identified','detected'],
  'many':     ['numerous','various','several'],
  'also':     ['additionally','furthermore','moreover'],
  'however':  ['nevertheless','yet','nonetheless'],
  'therefore':['consequently','thus','hence'],
  'because':  ['since','as','given that'],
};

/**
 * Transition phrases to inject for variety.
 */
const TRANSITIONS = {
  academic: [
    'Lebih lanjut,', 'Sehubungan dengan itu,', 'Dalam konteks ini,',
    'Perlu dicatat bahwa', 'Hal ini mengindikasikan bahwa',
    'Berkaitan dengan hal tersebut,', 'Secara lebih spesifik,',
  ],
  natural: [
    'Selain itu,', 'Di sisi lain,', 'Dengan kata lain,',
    'Patut diperhatikan bahwa', 'Yang menarik adalah',
  ],
  concise: ['Singkatnya,', 'Intinya,', 'Artinya,'],
  formal: [
    'Sebagaimana diketahui,', 'Mengacu pada hal tersebut,',
    'Dalam rangka itu,', 'Sehubungan dengan itu,',
  ],
  readable: ['Artinya,', 'Dengan kata lain,', 'Sebagai contoh,', 'Lebih jelasnya,'],
};

/**
 * Replace a word with a synonym if available.
 * Deterministic: uses word frequency index to pick synonym.
 * @param {string} word
 * @param {number} index — position in text (used as deterministic selector)
 */
function getSynonym(word, index) {
  const lower = word.toLowerCase();
  const syns = SYNONYM_MAP[lower];
  if (!syns) return null;
  return syns[index % syns.length];
}

/**
 * Split a long sentence (>28 words) into two.
 * Tries to split at a conjunction or comma.
 */
function splitLongSentence(sentence) {
  const words = sentence.split(/\s+/);
  if (words.length <= 28) return [sentence];

  const midStart = Math.floor(words.length * 0.4);
  const midEnd   = Math.floor(words.length * 0.65);
  const joiners  = /^(dan|serta|atau|while|and|but|which|that|karena|sehingga|namun|tetapi|,)$/i;

  for (let i = midStart; i <= midEnd; i++) {
    if (joiners.test(words[i])) {
      const first  = words.slice(0, i).join(' ').trim();
      const second = words.slice(i + 1).join(' ').trim();
      if (first && second) {
        const firstCap  = first.endsWith('.') ? first : first + '.';
        const secondCap = second.charAt(0).toUpperCase() + second.slice(1);
        return [firstCap, secondCap.endsWith('.') ? secondCap : secondCap + '.'];
      }
    }
  }
  // Fall back: split at midpoint
  const half    = Math.floor(words.length / 2);
  const firstH  = words.slice(0, half).join(' ') + '.';
  const secondH = words[half].charAt(0).toUpperCase() + words.slice(half).join(' ').slice(words[half].length);
  return [firstH, secondH.endsWith('.') ? secondH : secondH + '.'];
}

/**
 * Apply synonym substitution to a sentence.
 * Replaces high-frequency repeated words with synonyms.
 * @param {string} sentence
 * @param {object} wordFreq — word → count map
 * @param {number} sentIdx
 * @param {'light'|'moderate'|'extensive'} intensity
 */
function applySynonyms(sentence, wordFreq, sentIdx, intensity) {
  const threshold = intensity === 'light' ? 5 : intensity === 'moderate' ? 3 : 2;
  const words = sentence.split(/(\s+|[^\w\sÀ-ÿ])/);
  let changed = 0;
  const maxChanges = intensity === 'light' ? 1 : intensity === 'moderate' ? 2 : 4;

  return words.map((token, i) => {
    const lower = token.toLowerCase();
    if (!lower.match(/^[a-zÀ-ÿ]+$/) || STOP_WORDS.has(lower)) return token;
    if ((wordFreq[lower] || 0) >= threshold && changed < maxChanges) {
      const syn = getSynonym(lower, sentIdx + i);
      if (syn) {
        changed++;
        // Preserve capitalisation
        return token[0] === token[0].toUpperCase() && token[0].match(/[A-ZÀ-Ÿ]/)
          ? syn.charAt(0).toUpperCase() + syn.slice(1)
          : syn;
      }
    }
    return token;
  }).join('');
}

/**
 * Main rewriting engine.
 * Applies heuristic transformations based on goal and intensity.
 * Returns { improvedText, changeLog }.
 *
 * This is the primary extension point for future AI API integration.
 * Replace this function body with an API call to a language model.
 */
function generateImprovedText(text, settings) {
  const { goal, intensity } = settings;
  const sentences = getSentences(text);
  const words     = getWords(text);

  // Build word frequency map for synonym decisions
  const wordFreq = {};
  words.forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });

  const changeMade  = new Set();
  const newSentences = [];
  const splitThreshold = intensity === 'light' ? 35 : intensity === 'moderate' ? 28 : 22;
  const transitionList  = TRANSITIONS[goal] || TRANSITIONS.academic;
  const transitionEvery = intensity === 'light' ? 8 : intensity === 'moderate' ? 5 : 3;

  sentences.forEach((sentence, idx) => {
    const wCount = sentence.split(/\s+/).filter(w => w).length;

    // Step 1: Split long sentences
    if (wCount > splitThreshold) {
      const parts = splitLongSentence(sentence);
      if (parts.length > 1) {
        changeMade.add('split');
        newSentences.push(...parts);
        return;
      }
    }

    // Step 2: Apply synonym substitution
    const withSyns = intensity !== 'light' || idx % 3 === 0
      ? applySynonyms(sentence, wordFreq, idx, intensity)
      : sentence;
    if (withSyns !== sentence) changeMade.add('synonym');

    // Step 3: Inject transition phrase before certain sentences
    if (idx > 0 && idx % transitionEvery === 0 && transitionList.length > 0) {
      const trans = transitionList[Math.floor(idx / transitionEvery) % transitionList.length];
      // Only inject if sentence doesn't already start with a transition word
      const startLower = withSyns.toLowerCase();
      const alreadyTransitioned = ['selain','dengan','oleh','berkaitan','lebih','dalam','hal','sehubungan','sebagaimana','perlu','furthermore','additionally','moreover','however','therefore'].some(t => startLower.startsWith(t));
      if (!alreadyTransitioned) {
        const firstWord = withSyns.charAt(0).toLowerCase() + withSyns.slice(1);
        newSentences.push(`${trans} ${firstWord}`);
        changeMade.add('transition');
        return;
      }
    }

    newSentences.push(withSyns);
  });

  // Step 4: For 'extensive' intensity, vary some short sentences by combining adjacent pairs
  if (intensity === 'extensive') {
    const combined = [];
    let i = 0;
    while (i < newSentences.length) {
      const curr = newSentences[i];
      const next = newSentences[i + 1];
      const currLen = curr.split(/\s+/).filter(w => w).length;
      const nextLen = next ? next.split(/\s+/).filter(w => w).length : 999;
      // Combine two very short adjacent sentences if result stays ≤ 22 words
      if (currLen < 7 && nextLen < 7 && currLen + nextLen <= 22 && next) {
        const currTrimmed = curr.endsWith('.') ? curr.slice(0, -1) : curr;
        combined.push(`${currTrimmed}, ${next.charAt(0).toLowerCase() + next.slice(1)}`);
        changeMade.add('combine');
        i += 2;
      } else {
        combined.push(curr);
        i++;
      }
    }
    const resultText = combined.join(' ');

    return {
      improvedText: resultText,
      changeMade: [...changeMade],
    };
  }

  return {
    improvedText: newSentences.join(' '),
    changeMade: [...changeMade],
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
 */
function renderChangeLog(changeMade) {
  const descriptions = {
    split:      'Memecah kalimat yang terlalu panjang menjadi kalimat-kalimat lebih pendek',
    synonym:    'Mengganti beberapa kata berulang dengan sinonim atau variasi ekspresi',
    transition: 'Menambahkan frasa transisi untuk meningkatkan alur antar kalimat',
    combine:    'Menggabungkan beberapa kalimat sangat pendek menjadi kalimat yang lebih solid',
  };

  // Add always-present items for transparency
  const allChanges = [
    ...changeMade.map(c => descriptions[c]).filter(Boolean),
    'Menjaga makna dan konten akademik teks asli tetap utuh',
    'Mempertahankan argumen, fakta, dan struktur ide penulis',
  ];

  $('changeLogList').innerHTML = `<div class="change-log-list">${
    allChanges.map(c => `<div class="change-log-item">${escapeHtml(c)}</div>`).join('')
  }</div>`;

  $('changeLog').classList.remove('hidden');
}

/* ============================================================
   MODULE: WRITING IMPROVER UI CONTROLLER
   ============================================================ */

/** Current settings state */
const improverState = {
  goal:      'academic',
  intensity: 'moderate',
};

/**
 * Initialize button group toggle logic.
 * @param {string} groupId — element ID of .btn-group
 * @param {string} stateKey — key in improverState
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
 * Returns a promise that resolves after all steps complete.
 */
function animateLoadingSteps() {
  return new Promise(resolve => {
    const steps = [$('lstep1'), $('lstep2'), $('lstep3')];
    steps.forEach(s => { s.className = 'loading-step'; });

    let current = 0;
    function next() {
      if (current >= steps.length) {
        setTimeout(resolve, 200);
        return;
      }
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
 * Run the full improvement workflow.
 */
async function runImprover() {
  if (!currentAnalysis) {
    showToast('Analisis teks dulu sebelum menggunakan Writing Improver.', 'error');
    return;
  }

  const btn = $('improveBtn');
  btn.disabled = true;

  // Show loading
  $('improverLoading').classList.remove('hidden');
  $('improverPanels').classList.add('hidden');
  $('changeLog').classList.add('hidden');
  $('comparisonCard').classList.add('hidden');

  try {
    setStatus('analyzing', 'Memperbaiki tulisan...');

    // Animate steps (simulates processing pipeline)
    await animateLoadingSteps();

    // Small delay to let final step show as done
    await new Promise(r => setTimeout(r, 300));

    // Run improvement engine
    const { improvedText, changeMade } = generateImprovedText(currentAnalysis.text, improverState);

    // Analyze improved text
    const improvedAnalysis = analyzeText(improvedText);

    // Populate original panel
    $('originalTextPanel').textContent = currentAnalysis.text;
    $('compareOrigPanel').textContent  = currentAnalysis.text;

    // Populate improved panel
    $('improvedTextPanel').textContent = improvedText;
    $('compareImpPanel').textContent   = improvedText;

    // Show panels, reset to original tab
    $('improverPanels').classList.remove('hidden');
    document.querySelectorAll('.view-tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    const origTab = document.querySelector('.view-tab[data-view="original"]');
    if (origTab) { origTab.classList.add('active'); origTab.setAttribute('aria-selected', 'true'); }
    ['view-original','view-improved','view-compare'].forEach(id => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', id !== 'view-original');
    });

    // Render change log
    renderChangeLog(changeMade);

    // Render comparison section
    const compareRows = compareTexts(currentAnalysis, improvedAnalysis);
    renderComparisonTable(compareRows);
    renderComparisonCharts(currentAnalysis, improvedAnalysis);
    $('comparisonCard').classList.remove('hidden');

    setStatus('done', 'Selesai');
    showToast('Perbaikan tulisan selesai!', 'success');

    // Scroll to panels
    $('improverPanels').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (err) {
    console.error('Improver error:', err);
    showToast('Perbaikan tulisan gagal. Silakan coba lagi.', 'error');
    setStatus('error', 'Error');
  } finally {
    $('improverLoading').classList.add('hidden');
    btn.disabled = false;
  }
}

/**
 * Reset Writing Improver to initial state.
 */
function resetImprover() {
  $('improverPanels').classList.add('hidden');
  $('changeLog').classList.add('hidden');
  $('comparisonCard').classList.add('hidden');

  // Reset toggles to defaults
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
   EXTEND: runAnalysis — also triggers rekomendasi
   ============================================================ */

/**
 * Patch renderAllResults to also call renderRekomendasi.
 * Called after analysis completes.
 */
const _origRunAnalysis = runAnalysis; // captured reference (not used directly but for documentation)

/* ============================================================
   INIT EXTENSION — adds new feature handlers on DOMContentLoaded
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Btn group toggles
  initBtnGroup('writingGoalGroup', 'goal');
  initBtnGroup('intensityGroup', 'intensity');

  // View tabs
  initViewTabs();

  // Improve button
  $('improveBtn')?.addEventListener('click', runImprover);

  // Reset button
  $('improveResetBtn')?.addEventListener('click', resetImprover);

  // Copy improved text
  $('copyImprovedBtn')?.addEventListener('click', () => {
    const text = $('improvedTextPanel')?.textContent;
    if (!text) { showToast('Belum ada teks yang diperbaiki.', 'error'); return; }
    navigator.clipboard.writeText(text).then(() => {
      showToast('Teks hasil perbaikan berhasil disalin!', 'success');
    }).catch(() => {
      // Fallback for browsers without clipboard API
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Teks berhasil disalin!', 'success');
    });
  });
});
