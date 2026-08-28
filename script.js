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

      // Save to history
      addToHistory(analysis);

      setStatus('done', 'Selesai');
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
