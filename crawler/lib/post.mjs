// Decides whether a newsletter post holds a recipe, and if so keeps the same few
// facts we keep from recipe sites. Newsletters have no recipe data to read (no
// schema.org), so this looks for what a written recipe looks like: a run of lines
// that start with an amount ("150 g butter", "2 eggs"), plus something that says
// "this is a recipe" (an Ingredients or Method label, a "Serves 4" line, or steps
// that start with cooking verbs). Essays, interviews, link roundups and travel
// notes have none of that and are skipped. Only names leave this file, never the
// amounts, the method or the writing.

import { clean, toMinutes } from './text.mjs';
import { ingredientNames, QTY, UNIT_RE } from './ingredients.mjs';

const KEEP = ['n', 'u', 't', 'c', 'y', 'i', 'img', 'kw'];

const INGREDIENTS_LABEL = /^(ingredients?|what you(?:'|’)?ll need|you(?:'|’)?ll need|you will need|shopping list)\b.{0,30}$/i;
const PART_LABEL = /^(for |to (?:serve|finish|garnish|decorate|assemble)\b).{0,40}$|^.{2,40}:$/i;
// "To assemble" and "Make the dough" are left out on purpose: they head ingredient parts as often as steps.
const METHOD_LABEL = /^(method|instructions?|directions?|preparation|procedure|steps?|how to make(?: it| them)?|what to do)\s*:?$/i;
const YIELD = /^(?:serves?|makes?|yields?|servings?|feeds)\b\s*:?\s*(?:a |an |about |approximately |around )?\d.{0,40}$/i;
const TIME = /\b(total|prep(?:aration)?|cook(?:ing)?|bak(?:e|ing))\s*(?:time)?\s*[:–-]\s*([^.;|]{2,40})/gi;
// Words that follow a number in ordinary prose ("3 days in Rome", "40 people came").
const NOT_FOOD = /^(?:minutes?|mins?|hours?|hrs?|days?|nights?|weeks?|months?|years?|people|guests|friends|readers|subscribers|recipes?|things?|ways?|reasons?|tips?|steps?|times?|places?|spots?|rooms?|books?|questions?|a\.?m\.?|p\.?m\.?|january|february|march|april|may|june|july|august|september|october|november|december|°|degrees?|percent|%|euros?|dollars?|pounds? (?:each|per))\b/i;
const RECIPE_PREFIX = /^(?:here(?:'|’)?s|here is|and now,?|today(?:'|’)?s)?\s*(?:the |a |my )?(?:first |second |third |new )?recipe(?: (?:one|two|three|\d))?(?: for)?\s*[.:–-]?\s*(?:the )?/i;
const COOKING_VERB = /^(?:pre-?heat|heat|mix|whisk|stir|combine|add|place|bring|boil|bake|cook|chop|slice|dice|pour|melt|knead|roll|season|drain|fry|saut[eé]|simmer|roast|cream|beat|meanwhile|line|cut|peel|soak|toast|blend|grate|spread|arrange|transfer|remove|put|wash|rinse|fill|fold|sift|cover|mash|grill|sprinkle|dissolve|warm|toss|marinate|grease|blanch|steam|trim|divide|shape|rub|in a (?:large |small |medium |heavy |deep |wide |separate )*(?:pan|bowl|pot|saucepan|skillet|frying pan|wok|jug|dish|casserole|mixer|blender))\b/i;

export function recipeFromPost(post, { defaultCuisine } = {}) {
  const lines = toLines(post.html);
  const groups = recipeGroups(lines);
  if (!groups.length) return null;

  const names = groups.map((g) => g.name).filter(Boolean);
  const title = clean(post.title);
  // One recipe in the post: show the dish's own name (when it has a clear one) and keep the
  // post's title findable. Several: the post is the result, and the dishes are its keywords.
  const single = groups.length === 1;
  const name = (single && names[0]) || title;
  const recipe = {
    n: name,
    u: post.link,
    t: single ? groups[0].minutes : null,
    c: defaultCuisine || null,
    y: single ? groups[0].yield : null,
    i: ingredientNames(groups.flatMap((g) => g.ingredients)),
    img: post.image || null,
    kw: [title, ...names].filter((k, n, all) => k.toLowerCase() !== name.toLowerCase() && all.indexOf(k) === n).slice(0, 8),
  };
  if (recipe.i.length < 3) return null;
  const out = {};
  for (const key of KEEP) {
    const v = recipe[key];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[key] = v;
  }
  return out;
}

// ---- The post as lines

// Headings, paragraphs and list items, in order, split at line breaks. A paragraph that
// opens with a bold label ("<strong>For the sauce</strong> 2 tomatoes") becomes two lines.
export function toLines(html) {
  const s = String(html || '');
  const out = [];
  let list = 0;
  let lists = 0;
  const re = /<(h[1-6]|p|li)\b[^>]*>|<(ul|ol)\b[^>]*>|<\/(ul|ol)>/gi;
  let m;
  while ((m = re.exec(s))) {
    if (m[2]) { list = ++lists; continue; }
    if (m[3]) { list = 0; continue; }
    const tag = m[1].toLowerCase();
    const end = s.indexOf(`</${tag}`, re.lastIndex);
    if (end < 0) continue;
    const inner = s.slice(re.lastIndex, end);
    if (tag === 'li' && /<p\b/i.test(inner)) continue; // Substack wraps list text in <p>; read those
    re.lastIndex = end;
    for (const piece of inner.split(/<br\s*\/?>/i)) {
      const bold = piece.match(/^\s*<(strong|b)>([\s\S]*?)<\/\1>([\s\S]*)$/i);
      const label = bold ? clean(bold[2]) : '';
      const rest = bold ? clean(bold[3]) : clean(piece);
      const heading = tag[0] === 'h';
      if (label && rest.replace(/^[:.\s]+/, '')) {
        out.push({ text: label, strong: true, list });
        out.push({ text: rest.replace(/^[:.\s]+/, ''), strong: false, list });
      } else if (label || rest) {
        out.push({ text: label ? label + rest : rest, strong: heading || Boolean(label), heading, list });
      }
    }
  }
  return out;
}

// 2: an amount and a unit ("150g butter"). 1: an amount and a thing ("2 eggs"). 0: neither.
export function amountLine(text) {
  const t = text.trim().replace(/^(\d+)\s*[x×]\s+/i, '$1 '); // "2x tin of tomatoes"
  if (t.length > 140 || /^\d+\s*[.)]\s/.test(t) || /^\d{4}\b/.test(t)) return 0;
  const q = t.match(QTY);
  if (!q) return 0;
  const rest = t.slice(q[0].length);
  if (UNIT_RE.test(rest) && /[a-z]/i.test(rest.replace(UNIT_RE, ''))) return 2;
  // No unit: the amount must stand alone ("2 eggs", not "1st" or "2027"), and the line
  // must be short and not read like a sentence.
  if (!/\s$/.test(q[0]) || !/^[a-z(]/i.test(rest) || NOT_FOOD.test(rest)) return 0;
  if (t.length > 80 || /[.!?]$/.test(t) || /[.!?]\s+[A-Z]/.test(t)) return 0;
  return 1;
}

const short = (t) => t.length <= 45 && !/[.!?]$/.test(t) && !/[.!?]\s/.test(t);

// ---- Finding the recipes

function recipeGroups(lines) {
  // Runs of amount lines, with part labels ("For the filling") and the odd
  // amount-less ingredient ("olive oil, for frying") allowed inside a run.
  const runs = [];
  let run = null;
  const close = (i, endedByMethod) => {
    if (!run) return;
    while (run.items.length && !run.items.at(-1).amount && !endedByMethod) run.items.pop();
    run.end = i;
    run.methodLabel = endedByMethod;
    if (run.items.some((x) => x.amount)) runs.push(run);
    run = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const { text, strong, list } = lines[i];
    const amount = amountLine(text);
    if (METHOD_LABEL.test(text)) { close(i, true); continue; }
    if (amount) {
      if (run && run.list !== list && run.items.at(-1)?.index !== i - 1 && !run.pending) close(i, false);
      run ||= { start: i, list, items: [], pending: 0 };
      run.items.push({ text, amount, index: i });
      run.pending = 0;
    } else if (run && (PART_LABEL.test(text) || INGREDIENTS_LABEL.test(text) || (strong && short(text)))) {
      if (++run.pending > 2) close(i, false);
    } else if (run && short(text) && (list ? list === run.list : true) && run.items.filter((x) => x.amount).length >= 2) {
      run.items.push({ text, amount: 0, index: i });
      if (++run.pending > 2) close(i, false);
    } else {
      close(i, false);
    }
  }
  close(lines.length, false);

  // Runs close together are one recipe's parts (cake, then icing).
  const groups = [];
  for (const r of runs) {
    const last = groups.at(-1);
    if (last && !last.methodLabel && r.start - last.end <= 2) {
      last.items.push(...r.items);
      last.end = r.end;
      last.methodLabel = r.methodLabel;
    } else groups.push({ ...r, items: [...r.items] });
  }

  const found = [];
  for (const g of groups) {
    const amounts = g.items.filter((x) => x.amount);
    const withUnits = amounts.filter((x) => x.amount === 2).length;
    if (amounts.length < 4 || withUnits < 2) continue;
    const before = lines.slice(Math.max(0, g.start - 6), g.start);
    const after = lines.slice(g.end, g.end + 10);
    const labelled = before.some((l) => INGREDIENTS_LABEL.test(l.text) || YIELD.test(l.text));
    const steps = g.methodLabel || after.filter((l) => COOKING_VERB.test(l.text)).length >= 2;
    if (!labelled && !steps && amounts.length < 6) continue;
    const around = lines.slice(Math.max(0, g.start - 8), g.end + 3).map((l) => l.text);
    found.push({
      name: nameBefore(lines, g.start),
      ingredients: g.items.map((x) => x.text),
      yield: around.find((t) => YIELD.test(t)) || null,
      minutes: minutesIn(around),
    });
  }
  return found;
}

// The dish's name: the nearest heading or bold line above the ingredients that isn't
// itself a label. Null when there isn't a clear one (the post's title is used instead).
function nameBefore(lines, start) {
  let plain = 0;
  let headnotes = 0;
  for (let i = start - 1; i >= Math.max(0, start - 10); i--) {
    const { text, strong } = lines[i];
    if (INGREDIENTS_LABEL.test(text) || YIELD.test(text) || PART_LABEL.test(text) || /\btime\b/i.test(text)) continue;
    if (strong && !amountLine(text) && !/^\d/.test(text)) {
      // "RECIPE. Peperonata", "Here is the recipe for the apricot cake": the word itself is a strong hint.
      const stripped = text.replace(RECIPE_PREFIX, '').replace(/[.:]\s*recipe$/i, '');
      const flagged = stripped !== text;
      const name = stripped.replace(/[.,:]$/, '').trim();
      const sentence = /[.!?]$/.test(text) || /[.!?]\s/.test(text);
      if (name.length < 3 || name.length > (flagged ? 120 : 90) || /[!?;…]$/.test(name) || (sentence && !flagged)) return null;
      // Past a headnote, only a heading that says "recipe" is trusted to be the dish.
      if (headnotes && !flagged) return null;
      return name[0].toUpperCase() + name.slice(1);
    }
    if (!strong && short(text) && ++plain <= 2) continue; // a subtitle, like the dish's name in its own language
    if (!strong && ++headnotes <= 3) continue; // a few lines introducing the dish
    return null;
  }
  return null;
}

function minutesIn(texts) {
  const found = {};
  for (const t of texts) {
    for (const m of t.matchAll(TIME)) {
      const kind = m[1].toLowerCase().slice(0, 4);
      found[kind] ??= toMinutes(m[2]);
    }
  }
  if (found.tota) return found.tota;
  const sum = (found.prep || 0) + (found.cook || found.bak || found.baki || 0);
  return sum || null;
}
