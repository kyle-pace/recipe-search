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
  'cubes?', 'fillets?', 'scoops?', 'rounds?', 'ears?', 'bulbs?', 'cloves?',
];
const SIZES = ['large', 'medium', 'small', 'extra-large', 'extra large', 'jumbo', 'heaping', 'scant', 'level', 'generous', 'big', 'whole', 'about', 'approximately', 'roughly', 'plus', 'more'];

const NUM = "(?:\\d+(?:[.,/]\\d+)?|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|a few|few|several|half|a half)";
const QTY = new RegExp(`^(?:${NUM}(?:\\s*(?:-|–|to|or)\\s*${NUM})?\\s*)+`, 'i');
const UNIT_RE = new RegExp(`^(?:${UNITS.join('|')})(?=\\s|$)\\.?\\s*(?:of\\s+)?`, 'i');
const SIZE_RE = new RegExp(`^(?:${SIZES.join('|')})(?=\\s|$)\\s*`, 'i');

// Lines that are headings or notes, not ingredients.
const NOT_INGREDIENT = /^(for the|for serving|to serve|optional:|garnish:|equipment|notes?:)|:$/i;

export function ingredientName(line) {
  let s = clean(line).toLowerCase();
  if (!s || s.length > 200 || NOT_INGREDIENT.test(s)) return null;
  s = s.replace(/\([^)]*\)?/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = s.split(/,|;| – | — | - (?=[a-z])/)[0];
  s = s.replace(/\b(to taste|as needed|if needed|optional|for garnish|for serving|divided|plus more.*|or more.*)$/g, '');
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.trim().replace(QTY, '').trim();
    s = s.replace(/^[-–x×]\s*/, '');
    s = s.replace(UNIT_RE, '').replace(SIZE_RE, '');
    s = s.replace(/^of\s+/, '');
    if (s === before) break;
  }
  s = s.replace(/[*†:]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!s || /^\d/.test(s) || s.length < 2) return null;
  return s;
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
