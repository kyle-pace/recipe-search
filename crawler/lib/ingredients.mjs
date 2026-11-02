// Turns an ingredient line ("2 tablespoons vegetable oil, divided") into just
// the ingredient's name ("vegetable oil"). Quantities, units, sizes, prep notes
// and parentheticals are dropped: we keep names only, never the recipe itself.
// Matching names to KitchenCatalog ids is phase 3.

import { clean } from './text.mjs';

const UNITS = [
  'cups?', 'c\\.', 'tablespoons?', 'tbsps?\\.?', 'tbs\\.?', 'tb\\.?', 'teaspoons?', 'tsps?\\.?',
  'grams?', 'g', 'gr', 'kilograms?', 'kg', 'milligrams?', 'mg', 'millilit(?:er|re)s?', 'ml', 'lit(?:er|re)s?', 'l',
  'ounces?', 'oz\\.?', 'fl\\.? oz\\.?', 'fluid ounces?', 'pounds?', 'lbs?\\.?', 'pints?', 'quarts?', 'qts?\\.?', 'gallons?',
  'cans?', 'jars?', 'packages?', 'pkgs?\\.?', 'packets?', 'bags?', 'boxes', 'box', 'bottles?', 'containers?', 'cartons?', 'blocks?',
  'pinch(?:es)?', 'dash(?:es)?', 'drops?', 'handfuls?', 'bunch(?:es)?', 'sprigs?', 'stalks?', 'sticks?', 'slices?',
  'pieces?', 'pcs?\\.?', 'heads?', 'inch(?:es)?', 'in\\.', 'cm', 'sheets?', 'leaves', 'knobs?', 'thumbs?', 'strips?',
  'cubes?', 'fillets?', 'scoops?', 'rounds?', 'ears?', 'bulbs?', 'cloves?', 'squeezes?', 'splash(?:es)?', 'glugs?',
];
const SIZES = ['thin', 'thick', 'large', 'medium', 'small', 'extra-large', 'extra large', 'jumbo', 'heaping', 'scant', 'level', 'generous', 'big', 'whole', 'about', 'approximately', 'roughly', 'plus', 'more'];

// Word quantities must end at a word boundary, so "a" never eats the start of
// "all-purpose"; digits may touch their unit ("100g").
const NUM = "(?:\\d+(?:[.,/]\\d+)?|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|(?:a few|a half|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|few|several|half)(?![a-z-]))";
const QTY = new RegExp(`^(?:${NUM}(?:\\s*(?:-|–|to|or)\\s*${NUM})?\\s*)+`, 'i');
const UNIT_RE = new RegExp(`^(?:${UNITS.join('|')})(?=\\s|$)\\.?\\s*(?:of\\s+)?`, 'i');
const SIZE_RE = new RegExp(`^(?:${SIZES.join('|')})(?=\\s|$)\\s*`, 'i');

// Lines that are headings or notes, not ingredients.
const NOT_INGREDIENT = /^(for the|for serving|to serve|optional:|garnish:|equipment|notes?:|tips?:|serving suggestions?:|suggestions?:)|:$/i;

export function ingredientName(line) {
  let s = clean(line).toLowerCase();
  if (!s || s.length > 200 || NOT_INGREDIENT.test(s)) return null;
  s = s.replace(/\([^)]*\)?/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/[()]/g, ' ');
  s = firstPart(s);
  s = s.replace(/\b(to taste|as needed|if needed|optional|for garnish|for serving|divided|plus more.*|or more.*)$/g, '');
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.trim().replace(QTY, '').trim();
    s = s.replace(/^[-–x×]\s*/, '');
    s = s.replace(UNIT_RE, '').replace(SIZE_RE, '');
    s = s.replace(/^(?:of|or|and)\s+/, '');
    if (s === before) break;
  }
  s = s.replace(/[*†:]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!s || /^\d/.test(s) || s.length < 2) return null;
  return s;
}

// Prep notes after a comma ("garlic, minced") go. But a comma after a single
// word usually starts a list ("beef, chicken or vegetable broth") or another
// adjective ("fine, fresh breadcrumbs"), so that text stays.
const PREP = /^(?:finely |roughly |coarsely |thinly |very |freshly |lightly |well )?(chopped|minced|sliced|diced|grated|shredded|peeled|seeded|halved|quartered|cubed|crushed|beaten|softened|melted|divided|drained|rinsed|trimmed|torn|julienned|cut|at|room|cold|warm|hot|cooked|toasted|plus|or more|to taste|optional|for|as|if|about|packed|sifted|smashed|juiced|zested|cored|stemmed|pitted|thawed|separated|whisked|lightly|loosely|firmly)\b/;

function firstPart(s) {
  const parts = s.split(/,|;| – | — | - (?=[a-z])/).map((p) => p.trim());
  const head = parts[0].replace(QTY, '').trim().replace(UNIT_RE, '').replace(SIZE_RE, '').trim();
  if (parts.length > 1 && /^[a-z-]+$/.test(head) && parts[1] && !PREP.test(parts[1])) {
    return `${parts[0]}, ${parts[1]}`;
  }
  return parts[0];
}

export function ingredientNames(lines) {
  const out = [];
  const seen = new Set();
  for (const line of lines || []) {
    const name = ingredientName(line);
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
