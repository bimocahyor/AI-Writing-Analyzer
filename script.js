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

  const record = {
    id:           analysis.timestamp,
    num,
    label,
    date:         new Date(analysis.timestamp).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
    time:         new Date(analysis.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    // Original metrics (stored verbatim — never recalculated)
    originalText:     analysis.text,
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
   MODULE: WRITING IMPROVEMENT ENGINE v3
   ============================================================

   Architecture: Analyze → Revise → Re-analyze → Validate → Accept/Reject
   Principle: Minimum necessary intervention — only fix what is measurably broken.

   Key fixes vs v2:
   - Transitions are NEVER injected. They create new bigrams that raise phraseRepetition.
     Word count also expands, changing sentence-length distribution unpredictably.
   - Synonym substitution replaces only words with freq > THRESHOLD, and only a fraction
     of occurrences, never creating a new uniform replacement pattern.
   - Sentence splitting only happens when a sentence is genuinely too long (>32 words)
     AND sentences are documented to be too long across the whole text.
   - No sentence combining — always raises uniformity.
   - validateImprovement() enforces a minimum-improvement gate before accepting any candidate.
   - selectBestRevision() picks the candidate with the best validated score.
   - Up to 3 candidates are generated with different strategy parameters.
   - If no candidate passes validation, the original text is returned unchanged.

   API integration point (future):
   Replace generateOneCandidate() body with an async API call to a language model.
   The surrounding validation/selection loop is API-agnostic.
   DO NOT expose API keys in frontend code — all API keys must be handled server-side.
   ============================================================ */

/**
 * Synonym map.
 * Words are grouped by meaning similarity.
 * Only words that are genuinely interchangeable in academic context are included.
 * Important academic terminology (e.g. "penelitian", "analisis") is intentionally
 * kept with limited synonyms to avoid distorting meaning.
 */
const SYNONYM_MAP = {
  // Indonesian — high-frequency generic verbs
  'menunjukkan':  ['mengindikasikan','memperlihatkan','mencerminkan'],
  'merupakan':    ['adalah','menjadi'],
  'terdapat':     ['ditemukan','dijumpai'],
  'dilakukan':    ['dijalankan','dilaksanakan'],
  'diperoleh':    ['didapatkan','dihasilkan'],
  'dapat':        ['mampu','bisa'],
  'sangat':       ['amat','cukup'],
  'banyak':       ['sejumlah','berbagai'],
  'menggunakan':  ['memanfaatkan','menerapkan'],
  'memberikan':   ['menyediakan','menawarkan'],
  'penting':      ['signifikan','esensial'],
  'proses':       ['prosedur','mekanisme'],
  'faktor':       ['aspek','elemen'],
  'kegiatan':     ['aktivitas','upaya'],
  'masalah':      ['persoalan','tantangan'],
  'tujuan':       ['sasaran','maksud'],
  'kualitas':     ['mutu','standar'],
  'melalui':      ['lewat'],
  // English — high-frequency generic verbs
  'shows':    ['indicates','demonstrates'],
  'uses':     ['employs','applies'],
  'provides': ['offers','supplies'],
  'found':    ['identified','detected'],
  'many':     ['numerous','several'],
  'also':     ['additionally','moreover'],
  'however':  ['nevertheless','yet'],
  'therefore':['consequently','thus'],
  'because':  ['since','given that'],
};

/**
 * Detect whether a sentence already starts with a known transition marker.
 * Used to avoid double-transition injection.
 */
function hasLeadingTransition(sentence) {
  const s = sentence.toLowerCase().trim();
  const markers = ['selain','dengan demikian','oleh karena','berkaitan','lebih lanjut',
    'dalam konteks','sehubungan','sebagaimana','perlu dicatat','furthermore',
    'additionally','moreover','however','therefore','singkatnya','intinya',
    'terkait','selaras','sebagai tambahan','di samping','secara lebih'];
  return markers.some(m => s.startsWith(m));
}

/**
 * Detect measurable writing problems in a text.
 * Returns a structured report — not just a Set of codes.
 *
 * Each problem has:
 *   - code: identifier
 *   - severity: 0–1 (proportion of affected sentences)
 *   - detail: human-readable description
 *   - affectedIndices: which sentence indices are affected (for targeted editing)
 */
function analyzeWritingPatterns(sentences, wordFreq) {
  const lengths = sentences.map(s => s.split(/\s+/).filter(w => w).length);
  const mean = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const variance = lengths.length > 0 ? lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  const problems = [];

  // ── Problem A: Sentence-length uniformity ────────────────
  // Healthy academic text has cv roughly 0.35–0.65.
  // Below 0.25 = dangerously uniform.
  if (cv < 0.30) {
    problems.push({
      code: 'uniform_length',
      severity: Math.max(0, (0.30 - cv) / 0.30),
      detail: `Koefisien variasi panjang kalimat sangat rendah (${(cv * 100).toFixed(1)}%).`,
      affectedIndices: [], // not sentence-specific — text-level problem
    });
  }

  // ── Problem B: Repeated sentence openings ────────────────
  // Flag opening (first word) that appears 3+ times.
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

  // ── Problem C: Lexical repetition above threshold ────────
  // Only flag words that are genuinely over-repeated (not technical terms).
  const totalWords = Object.values(wordFreq).reduce((a, b) => a + b, 0);
  Object.entries(wordFreq).forEach(([word, count]) => {
    if (STOP_WORDS.has(word) || word.length <= 3) return;
    if (!SYNONYM_MAP[word]) return; // only target words we can actually substitute
    const rate = count / totalWords * 100;
    if (rate >= 2.5 && count >= 4) { // appears ≥4 times AND ≥2.5% of text
      const affectedIndices = sentences.reduce((acc, s, i) => {
        if (s.toLowerCase().includes(word)) acc.push(i);
        return acc;
      }, []);
      problems.push({
        code: 'repeated_word',
        severity: Math.min(1, (rate - 2.5) / 5),
        detail: `Kata "${word}" muncul ${count} kali (${rate.toFixed(1)}% dari teks).`,
        affectedIndices,
        word,
        count,
      });
    }
  });

  // ── Problem D: Very long sentences ──────────────────────
  // Only flag sentences genuinely too long for readability (>32 words).
  const longIndices = lengths.reduce((acc, l, i) => { if (l > 32) acc.push(i); return acc; }, []);
  if (longIndices.length > 0 && longIndices.length / sentences.length > 0.25) {
    problems.push({
      code: 'too_long',
      severity: longIndices.length / sentences.length,
      detail: `${longIndices.length} kalimat memiliki lebih dari 32 kata.`,
      affectedIndices: longIndices,
    });
  }

  return { cv, mean, problems };
}

/**
 * Split a long sentence into two at a natural break point.
 * Only splits if a genuine syntactic boundary is found.
 * Returns array of 1 sentence (original) or 2 sentences (split).
 */
function splitLongSentence(sentence) {
  const words = sentence.split(/\s+/);
  if (words.length <= 30) return [sentence];

  const midStart = Math.floor(words.length * 0.40);
  const midEnd   = Math.floor(words.length * 0.65);

  // Preferred split markers (conjunctions that begin a new clause)
  const clauseMarkers = /^(namun|tetapi|sedangkan|sehingga|karena|walaupun|meskipun|dan|but|however|although|therefore|because|while|whereas|so)$/i;

  for (let i = midStart; i <= midEnd; i++) {
    if (clauseMarkers.test(words[i])) {
      const first  = words.slice(0, i).join(' ').replace(/[,;]+$/, '').trim();
      const second = words.slice(i + 1).join(' ').trim();
      // Both halves must be at least 7 words to be meaningful
      if (first.split(/\s+/).length >= 7 && second.split(/\s+/).length >= 7) {
        const f = first.endsWith('.') ? first : first + '.';
        const s = second.charAt(0).toUpperCase() + second.slice(1);
        return [f, s.endsWith('.') ? s : s + '.'];
      }
    }
  }

  // Secondary: split at a comma mid-sentence if no conjunction found
  for (let i = midStart; i <= midEnd; i++) {
    if (words[i].endsWith(',')) {
      const first  = words.slice(0, i + 1).join(' ').trim();
      const second = words.slice(i + 1).join(' ').trim();
      if (second && first.split(/\s+/).length >= 7 && second.split(/\s+/).length >= 7) {
        const f = first.endsWith('.') ? first : first + '.';
        const s = second.charAt(0).toUpperCase() + second.slice(1);
        return [f, s.endsWith('.') ? s : s + '.'];
      }
    }
  }

  return [sentence]; // cannot safely split without distorting meaning
}

/**
 * Substitute repeated words in a sentence with synonyms.
 * Only replaces a word if:
 *   - it appears in SYNONYM_MAP
 *   - its global occurrence count exceeds minCount
 *   - we haven't replaced it in a recent sentence (tracked via usedAtSentence)
 *
 * This prevents creating a NEW uniform pattern of repeated synonyms.
 *
 * @param {string}  sentence
 * @param {object}  wordFreq         — global frequency map
 * @param {object}  lastReplacedAt   — mutable: word → last sentence index where it was replaced
 * @param {number}  sentIdx          — current sentence index
 * @param {number}  minGlobalCount   — only replace if freq >= this
 * @param {number}  minGapSentences  — must wait this many sentences before replacing same word again
 */
function substituteRepeatedWords(sentence, wordFreq, lastReplacedAt, sentIdx, minGlobalCount, minGapSentences) {
  // Per-sentence global synonym counter to pick from SYNONYM_MAP in order
  const tokens     = sentence.split(/(\s+|(?=[.,;:!?()—–"'])|(?<=[.,;:!?()—–"']))/);
  let changeCount  = 0;
  const maxPerSent = 2; // never replace more than 2 words per sentence

  const result = tokens.map(token => {
    if (changeCount >= maxPerSent) return token;
    const lower = token.toLowerCase();
    // Skip punctuation, whitespace, stop words, short words
    if (!lower.match(/^[a-zà-ÿ]{4,}$/) || STOP_WORDS.has(lower)) return token;
    const syns = SYNONYM_MAP[lower];
    if (!syns || syns.length === 0) return token;
    const freq = wordFreq[lower] || 0;
    if (freq < minGlobalCount) return token;

    // Gap check: don't replace the same word in adjacent sentences
    const lastIdx = lastReplacedAt[lower] ?? -999;
    if (sentIdx - lastIdx < minGapSentences) return token;

    // Pick synonym by cycling: each word rotates independently
    const useCount = (lastReplacedAt['__' + lower + '_count'] || 0);
    const syn = syns[useCount % syns.length];
    lastReplacedAt[lower] = sentIdx;
    lastReplacedAt['__' + lower + '_count'] = useCount + 1;

    changeCount++;
    const isCapitalized = token[0] === token[0].toUpperCase() && token[0].match(/[A-ZÀ-Ÿ]/);
    return isCapitalized ? syn.charAt(0).toUpperCase() + syn.slice(1) : syn;
  });

  return result.join('');
}

/**
 * Generate one candidate revision.
 *
 * Accepts a strategy object to control which operations are applied
 * and at what threshold — this allows generating multiple diverse candidates.
 *
 * Strategy parameters:
 *   - synonymMinFreq: minimum global word frequency before substitution
 *   - synonymGap: min sentence gap between substituting the same word
 *   - splitThreshold: sentence word-count at which to attempt splitting
 *   - openingVariationMode: 'none' | 'rotate' — whether to vary repeated openings
 *
 * This function NEVER:
 *   - injects filler transitions
 *   - combines sentences
 *   - adds words not in the original
 *   - expands paragraphs
 */
function generateOneCandidate(text, analysis, strategy) {
  const sentences = getSentences(text);
  const { problems } = analysis;
  const wordFreq = {};
  getWords(text).forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });

  const lastReplacedAt = {}; // tracks synonym replacement position per word
  const changeLog = {
    synonymsReplaced:  0,
    sentencesSplit:    0,
    openingsVaried:    0,
  };

  // Determine which problems are active
  const hasUniformLength   = problems.some(p => p.code === 'uniform_length');
  const repeatedWords      = problems.filter(p => p.code === 'repeated_word');
  const tooLongProblem     = problems.find(p => p.code === 'too_long');
  const repeatedOpenings   = problems.filter(p => p.code === 'repeated_opening');

  // Build per-sentence problem index for targeted editing
  const sentenceProblems = {}; // sentIdx → Set of problem codes
  problems.forEach(prob => {
    (prob.affectedIndices || []).forEach(i => {
      if (!sentenceProblems[i]) sentenceProblems[i] = new Set();
      sentenceProblems[i].add(prob.code);
    });
  });

  // Opening variation: for each repeated opening word, prepare a rotation list
  // We rotate the opening pattern across its occurrences
  const openingRotations = {}; // word → array of seen indices, for rotation tracking
  if (strategy.openingVariationMode === 'rotate' && repeatedOpenings.length > 0) {
    repeatedOpenings.forEach(prob => {
      openingRotations[prob.word] = { indices: prob.affectedIndices, cursor: 0 };
    });
  }

  const newSentences = sentences.map((sentence, idx) => {
    const probs = sentenceProblems[idx] || new Set();
    let s = sentence;
    let modified = false;

    // ── A. Split genuinely long sentences ───────────────────
    if (tooLongProblem && probs.has('too_long')) {
      const wCount = s.split(/\s+/).filter(w => w).length;
      if (wCount > strategy.splitThreshold) {
        const parts = splitLongSentence(s);
        if (parts.length > 1) {
          changeLog.sentencesSplit++;
          // Return both parts joined by newline marker; we'll flatten at the end
          return '\x00SPLIT\x00' + parts.join('\x00SEP\x00');
        }
      }
    }

    // ── B. Reduce lexical repetition ────────────────────────
    if (repeatedWords.length > 0 && (probs.has('repeated_word') || repeatedWords.some(p => p.affectedIndices.includes(idx)))) {
      const revised = substituteRepeatedWords(
        s, wordFreq, lastReplacedAt, idx,
        strategy.synonymMinFreq, strategy.synonymGap
      );
      if (revised !== s) {
        s = revised;
        modified = true;
        changeLog.synonymsReplaced++;
      }
    }

    // ── C. Vary repeated sentence openings ──────────────────
    // Only alter the 2nd, 3rd, 4th+ occurrence of a repeated opener.
    // The first occurrence keeps the original opening.
    if (strategy.openingVariationMode === 'rotate') {
      const firstWord = s.trim().split(/\s+/)[0]?.toLowerCase() || '';
      const rot = openingRotations[firstWord];
      if (rot) {
        const occurrenceNum = rot.indices.indexOf(idx); // 0-based position in repetition list
        if (occurrenceNum >= 1) {
          // Rearrange: move the subject/verb pair or prepend a short phrase
          // Strategy: for the Nth repeat (N>=1), try omitting the redundant opening word
          // and restructuring if the sentence allows it.
          // We do this by checking if removing the first word still yields a grammatical sentence.
          // We only do this if the first word is not a necessary subject.
          const rest = s.trim().replace(/^\S+\s*/, '');
          const restWords = rest.split(/\s+/).filter(w => w);
          if (restWords.length >= 5) {
            // Check the next word isn't also a repeated opener (avoid double-removal)
            const nextFirstWord = restWords[0]?.toLowerCase();
            if (!openingRotations[nextFirstWord]) {
              s = rest.charAt(0).toUpperCase() + rest.slice(1);
              changeLog.openingsVaried++;
              modified = true;
            }
          }
        }
      }
    }

    return s;
  });

  // Flatten split sentences
  const flatSentences = [];
  newSentences.forEach(s => {
    if (s.startsWith('\x00SPLIT\x00')) {
      flatSentences.push(...s.replace('\x00SPLIT\x00', '').split('\x00SEP\x00'));
    } else {
      flatSentences.push(s);
    }
  });

  return {
    text:      flatSentences.join(' '),
    changeLog,
  };
}

/**
 * Validate whether a candidate revision improved the writing profile.
 * Returns a score (higher = better improvement) and a boolean pass/fail.
 *
 * Scoring rules (each worth up to 1 point):
 *   +1  if lexical repetition score decreased by ≥2 points
 *   +1  if phrase repetition score decreased by ≥2 points
 *   +1  if sentence uniformity score decreased by ≥2 points (lower = more varied)
 *   +1  if burstiness score decreased by ≥2 points (lower = more natural)
 *   +0.5 if vocabulary diversity score decreased (= diversity increased, lower risk = better)
 *   -2  if OVERALL final score INCREASED (writing got objectively worse)
 *   -1  if word count expanded by >12% (unnecessary inflation)
 *   -0.5 for each metric that worsened beyond a noise threshold
 *
 * A candidate PASSES validation if validationScore >= 0.5
 * AND finalScore did not increase beyond a 3-point noise threshold.
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
 *   2. Among passing candidates: highest validation score
 *   3. If no candidate passes: return null (caller must use original text)
 */
function selectBestRevision(candidates) {
  const passing = candidates.filter(c => c.validation.passes);
  if (passing.length === 0) return null;
  return passing.sort((a, b) => b.validation.score - a.validation.score)[0];
}

/**
 * Main entry point for the improvement workflow.
 * Generates up to 3 candidates with different strategy parameters,
 * analyzes all of them, validates each, and selects the best.
 *
 * Returns:
 *   { improvedText, changeMade, validation, usedOriginal }
 *
 * If usedOriginal === true, no candidate passed validation and the original
 * text was preserved.
 *
 * API integration point (future):
 * Replace generateOneCandidate() with a call to a language model API.
 * The validation and selection loop below is API-agnostic.
 */
function generateImprovedText(text, settings) {
  const sentences = getSentences(text);
  const words     = getWords(text);
  const wordFreq  = {};
  words.forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });

  const origAnalysis = analyzeText(text);
  const patternReport = analyzeWritingPatterns(sentences, wordFreq);

  // Define 3 strategy configurations — each attempts a different balance
  const strategies = [
    // Strategy 1: Conservative — only touch words repeated ≥5 times, large gap, no opening variation
    { synonymMinFreq: 5, synonymGap: 3, splitThreshold: 32, openingVariationMode: 'none',   label: 'konservatif' },
    // Strategy 2: Moderate — touch words repeated ≥4 times, medium gap, rotate openings
    { synonymMinFreq: 4, synonymGap: 2, splitThreshold: 30, openingVariationMode: 'rotate', label: 'sedang' },
    // Strategy 3: Active — touch words repeated ≥3 times, shorter gap, rotate openings + split shorter sentences
    { synonymMinFreq: 3, synonymGap: 2, splitThreshold: 28, openingVariationMode: 'rotate', label: 'aktif' },
  ];

  const candidates = [];

  strategies.forEach(strategy => {
    const { text: candText, changeLog } = generateOneCandidate(text, patternReport, strategy);

    // Re-analyze the candidate using the same full analysis engine
    const candAnalysis = analyzeText(candText);

    // Validate the candidate
    const validation = validateImprovement(origAnalysis, candAnalysis);

    candidates.push({
      text:       candText,
      analysis:   candAnalysis,
      validation,
      changeLog,
      strategy:   strategy.label,
    });
  });

  const best = selectBestRevision(candidates);

  if (!best) {
    // No candidate passed validation — return original text unchanged
    return {
      improvedText:  text,
      changeMade:    [],
      validation:    null,
      usedOriginal:  true,
    };
  }

  // Build human-readable change log from actual changeLog counts
  const changeMade = [];
  if (best.changeLog.synonymsReplaced > 0)
    changeMade.push(`${best.changeLog.synonymsReplaced} pengulangan kata dikurangi melalui variasi sinonim`);
  if (best.changeLog.sentencesSplit > 0)
    changeMade.push(`${best.changeLog.sentencesSplit} kalimat terlalu panjang dipecah menjadi lebih pendek`);
  if (best.changeLog.openingsVaried > 0)
    changeMade.push(`${best.changeLog.openingsVaried} pembuka kalimat yang berulang divariasikan`);

  return {
    improvedText:  best.text,
    changeMade,
    validation:    best.validation,
    usedOriginal:  false,
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
   MODULE: WRITING IMPROVER UI CONTROLLER v2
   ============================================================ */

/** Current settings state */
const improverState = {
  goal:      'academic',
  intensity: 'moderate',
};

/** Last improved text — used as input for second pass */
let _lastImprovedText = null;
let _lastImprovedAnalysis = null;

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

  try {
    setStatus('analyzing', 'Memperbaiki tulisan...');
    await animateLoadingSteps();
    await new Promise(r => setTimeout(r, 300));

    // v3 engine — returns { improvedText, changeMade[], validation, usedOriginal }
    const result = generateImprovedText(inputText, improverState);
    const { improvedText, changeMade, usedOriginal } = result;

    // ── FAIL-SAFE PATH ──────────────────────────────────────
    // All 3 candidates failed validation — preserve the original text and
    // show an honest message instead of silently accepting a degraded result.
    if (usedOriginal) {
      $('improverFailsafe').classList.remove('hidden');
      $('improverFailsafe').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setStatus('done', 'Tidak ada perbaikan terukur');
      showToast('Tidak ada revisi yang terbukti lebih baik. Teks asli dipertahankan.', 'info');
      return;
    }

    // ── SUCCESS PATH ─────────────────────────────────────────
    // A candidate passed validation — display the improvement.

    // Analyze the improved text — independent recalculation, not reuse
    const improvedAnalysis = analyzeText(improvedText);

    // Store for "Perbaiki Lagi"
    _lastImprovedText     = improvedText;
    _lastImprovedAnalysis = improvedAnalysis;

    // Populate text panels
    $('originalTextPanel').textContent = origAnalysis.text;
    $('compareOrigPanel').textContent  = origAnalysis.text;
    $('improvedTextPanel').textContent = improvedText;
    $('compareImpPanel').textContent   = improvedText;

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

    // Change log — changeMade is already a human-readable string[] from v3 engine
    renderChangeLog(changeMade);

    // Comparison section
    const compareRows = compareTexts(origAnalysis, improvedAnalysis);
    renderComparisonTable(compareRows);
    renderComparisonCharts(origAnalysis, improvedAnalysis);
    $('comparisonCard').classList.remove('hidden');

    // Persist improvement data to history
    if (currentAnalysis) {
      updateHistoryWithImprovement(currentAnalysis.timestamp, {
        improvedText,
        improvedAnalysis,
        changeMade,
      });
    }

    // Show "Perbaiki Lagi" only after the first pass
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
  showImproveAgainBtn(false);
  _lastImprovedText     = null;
  _lastImprovedAnalysis = null;

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

  // Fail-safe panel buttons
  $('failsafeUseOriginal')?.addEventListener('click', () => {
    // Copy the original analyzed text to the "Hasil Perbaikan" panel so the user
    // can still use the copy button, and show the panel in original-tab mode.
    if (!currentAnalysis) return;
    $('originalTextPanel').textContent = currentAnalysis.text;
    $('improvedTextPanel').textContent = currentAnalysis.text;
    $('compareOrigPanel').textContent  = currentAnalysis.text;
    $('compareImpPanel').textContent   = currentAnalysis.text;
    $('improverFailsafe').classList.add('hidden');
    $('improverPanels').classList.remove('hidden');
    // Switch to Original tab so the label is honest
    document.querySelectorAll('.view-tab').forEach(t => {
      t.classList.remove('active'); t.setAttribute('aria-selected', 'false');
    });
    const origTab = document.querySelector('.view-tab[data-view="original"]');
    if (origTab) { origTab.classList.add('active'); origTab.setAttribute('aria-selected', 'true'); }
    ['view-original','view-improved','view-compare'].forEach(id => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', id !== 'view-original');
    });
    showToast('Teks asli ditampilkan. Salin teks dari panel di bawah.', 'info');
  });

  $('failsafeTryManual')?.addEventListener('click', () => {
    // Scroll back to the input textarea so the user can edit manually
    $('improverFailsafe').classList.add('hidden');
    const ta = $('textInput');
    if (ta) {
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ta.focus();
    }
    showToast('Edit teks secara manual di area input, lalu analisis kembali.', 'info');
  });

  // Copy improved text
  $('copyImprovedBtn')?.addEventListener('click', () => {
    const text = $('improvedTextPanel')?.textContent;
    if (!text) { showToast('Belum ada teks yang diperbaiki.', 'error'); return; }
    navigator.clipboard.writeText(text).then(() => {
      showToast('Teks hasil perbaikan berhasil disalin!', 'success');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
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
