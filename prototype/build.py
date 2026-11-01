"""Builds the recipe search prototype: merges the sample data, matches each
ingredient to a canonical name (a tiny stand-in for KitchenCatalog), and
writes index.html from template.html."""
import html, json, re
from pathlib import Path

ROOT = Path(__file__).parent
D = ROOT / 'data'

# canonical name -> other names it goes by. Longer, more specific names are
# matched first, so "green onion" wins over "onion" and "sesame oil" over "oil".
CATALOG = {
    'green onion': ['scallion', 'scallions', 'green onions', 'spring onion', 'spring onions'],
    'garlic chives': ['chinese chives'],
    'chives': [],
    'cilantro': ['coriander leaves', 'fresh coriander'],
    'eggplant': ['aubergine', 'japanese eggplant', 'chinese eggplant'],
    'thai chili': ['thai chilies', 'bird chilies', 'thai bird chilies', 'thai chili'],
    'red pepper flakes': ['chili flakes', 'crushed red pepper'],
    'tofu': ['silken tofu', 'soft tofu', 'firm tofu', 'soft/silken tofu', 'dubu', 'sundubu'],
    'rice': ['bowl of rice', 'cooked rice', 'jasmine rice', 'white rice', 'short-grain rice', 'short grain japanese rice', 'arborio', 'carnaroli'],
    'garlic': ['garlic cloves'],
    'ginger': [],
    'galangal': [],
    'lemongrass': [],
    'soy sauce': ['light soy sauce', 'dark soy sauce', 'japanese soy sauce', 'shoyu'],
    'fish sauce': [],
    'oyster sauce': [],
    'sesame oil': ['toasted sesame oil'],
    'chili oil': ['chili crisp', 'la-yu', 'lao gan ma'],
    'chicken': ['ground chicken', 'chicken thigh', 'chicken thighs', 'boneless chicken'],
    'pork': ['ground pork', 'pork belly', 'pork leg bones', 'bacon', 'ham'],
    'beef': ['ground beef'],
    'shrimp': ['prawns'],
    'seafood': ['mixed seafood'],
    'egg': ['eggs'],
    'mushrooms': ['shiitake', 'shimeji', 'chanterelle', 'chanterelles', 'sliced mushrooms', 'wood ear mushrooms', 'king oyster mushrooms'],
    'kabocha squash': ['kabocha'],
    'miso': [],
    'dashi': ['dashi packet', 'dashi powder'],
    'basil': ['thai basil', 'holy basil', 'basil leaves'],
    'mint': ['mint leaves'],
    'parsley': ['flat-leaf parsley'],
    'lime': ['limes', 'lime juice', 'kaffir lime leaves'],
    'lemon': [],
    'shallot': ['shallots'],
    'cabbage': ['napa cabbage', 'red cabbage', 'pickled sour cabbage'],
    'cucumber': ['cucumbers', 'persian-style cucumbers'],
    'tomato': ['tomatoes', 'cherry tomatoes', 'peeled tomatoes', 'crushed tomatoes', 'tomato puree'],
    'onion': ['yellow onion', 'red onion', 'onions'],
    'butter': ['unsalted butter'],
    'parmesan': ['parmesan cheese', 'romano'],
    'sour cream': [],
    'yogurt': ['greek-style yogurt'],
    'pasta': ['spaghetti', 'dried spaghetti'],
    'noodles': ['rice noodles', 'ramen noodles', 'egg noodles', 'instant ramen', 'sweet potato starch noodles', 'glass noodles', 'japchae'],
    'coconut milk': [],
    'curry paste': ['green curry paste'],
    'cornstarch': ['potato starch'],
    'mirin': [],
    'sake': [],
    'shaoxing wine': [],
    'rice vinegar': ['unseasoned rice vinegar'],
    'vinegar': ['white vinegar', 'red wine vinegar', 'black vinegar'],
    'peas': [],
    'carrot': ['carrots'],
    'pineapple': [],
    'avocado': [],
    'peaches': ['peach'],
    'tortillas': ['flour tortillas'],
    'white beans': [],
    'spinach': [],
    'cumin': ['ground cumin'],
    'cinnamon': ['ground cinnamon'],
    'flour': ['all-purpose flour'],
    'sugar': ['granulated sugar', 'brown sugar', 'palm sugar', 'powdered sugar'],
    'daikon': ['daikon radish'],
    'wakame': ['seaweed', 'nori'],
    'bean sprouts': [],
    'gochujang': ['korean hot pepper paste'],
    'gochugaru': ['gochu-garu', 'korean hot pepper flakes'],
    'kimchi': ['fermented kimchi'],
    'rice cakes': ['tteok', 'tteokbokki'],
    'cream': ['heavy cream'],
    'mozzarella': ['shredded mozzarella cheese'],
    'honey': ['rice syrup'],
}
TERMS = sorted(((alias, canon) for canon, al in CATALOG.items() for alias in [canon, *al]),
               key=lambda t: -len(t[0]))

def canon(s):
    s = s.lower()
    for alias, c in TERMS:
        if re.search(r'(?<![a-z])' + re.escape(alias) + r'(?![a-z])', s):
            return c
    return None

def clean(s):
    s = re.sub(r'\s*\)\s*$', '', s).strip()
    s = re.sub(r'^(qt|knob|servings?|serving|sized)\s+', '', s)
    return s

def minutes(t):
    if not t:
        return None
    if t.isdigit():
        return int(t)
    m = re.match(r'P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?', t)
    return (int(m[1] or 0) * 1440 + int(m[2] or 0) * 60 + int(m[3] or 0)) or None if m else None

SOURCES = {
    'woks': ('The Woks of Life', 'https://thewoksoflife.com', None),
    'joc': ('Just One Cookbook', 'https://www.justonecookbook.com', 'Japanese'),
    'htk': ('Hot Thai Kitchen', 'https://hot-thai-kitchen.com', 'Thai'),
    'sk': ('Smitten Kitchen', 'https://smittenkitchen.com', None),
    'maangchi': ('Maangchi', 'https://www.maangchi.com', 'Korean'),
}

items = []
for key, (name, base, default_cuisine) in SOURCES.items():
    for r in json.loads((D / f'{key}.json').read_text()):
        url = r['u'] if r['u'].startswith('http') else base + r['u']
        ings = [clean(i) for i in r['i'] if clean(i)]
        ci = []
        for i in ings:
            c = canon(i)
            if c and c not in ci:
                ci.append(c)
        items.append({
            'type': 'recipe', 'src': key, 'title': html.unescape(r['n']), 'url': url,
            'min': minutes(r.get('t', '')), 'cuisine': (r.get('c') or default_cuisine or '').split('/')[0],
            'course': (r.get('k') or '').split('/')[0], 'ing': ings, 'ci': ci,
        })

for v in json.loads((D / 'kenji.json').read_text()):
    ci = []
    c = canon(v['n'])
    if c:
        ci.append(c)
    items.append({
        'type': 'video', 'src': 'kenji', 'title': v['n'], 'url': f"https://www.youtube.com/watch?v={v['id']}",
        'date': v['p'], 'min': None, 'cuisine': '', 'course': '', 'ing': [], 'ci': ci,
    })

catalog = {c: al for c, al in CATALOG.items()}
page = (ROOT / 'template.html').read_text()
page = page.replace('/*DATA*/', 'const ITEMS = ' + json.dumps(items, ensure_ascii=False) + ';\nconst CATALOG = ' + json.dumps(catalog) + ';')
(ROOT / 'index.html').write_text(page)
recipes = sum(1 for i in items if i['type'] == 'recipe')
print(f'{recipes} recipes, {len(items) - recipes} videos, {len(page) // 1024} KB')
unmatched = sorted({i for it in items for i in it['ing'] if not canon(i)})
print('unmatched sample:', unmatched[:25])
