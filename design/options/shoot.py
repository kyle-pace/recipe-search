"""Screenshot the local recipe search build with each design option injected.
Usage: python3 shoot.py [option ...]   (options: current a b c)"""
import asyncio, sys, pathlib
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).parent
OUT = HERE / "shots"; OUT.mkdir(exist_ok=True)
BASE = "http://localhost:4420/recipe-search/"
CSS = {"a": "a-hushed.css", "b": "b-index.css", "c": "c-sheet.css"}

# Small markup changes the options need, applied after results render.
JS = {
  "b": """() => {
    const q = new URLSearchParams(location.search).get('q');
    if (q && !document.querySelector('.index-head')) {
      const h = document.createElement('p'); h.className = 'index-head'; h.textContent = q;
      document.getElementById('status').before(h);
    }
    document.querySelectorAll('.row .meta').forEach(m => {
      if (m.dataset.done) return; m.dataset.done = 1;
      const t = m.textContent.match(/^([\\d\\s\\w]*?(?:minutes?|hours?)[\\d\\s\\w]*?), (.*)$/);
      const time = document.createElement('span'); time.className = 'time';
      if (t) { time.textContent = t[1].replace(/ minutes?/, ' min').replace(/ hours?/, ' hr'); m.textContent = t[2].replace(/^from /, ''); }
      else m.textContent = m.textContent.replace(/^From /, '');
      m.textContent = m.textContent.replace(/, from /, ', ');
      m.parentElement.insertBefore(time, m);
    });
  }""",
  "c": """() => {
    document.querySelectorAll('.row .meta').forEach(m => {
      if (m.dataset.done) return; m.dataset.done = 1;
      const parts = m.textContent.split(', ');
      const from = parts.pop().replace(/^[Ff]rom /, '');
      const time = parts.find(p => /minute|hour/.test(p));
      m.textContent = [time && time.replace(/ minutes?/, ' min').replace(/ hours?/, ' hr'), from].filter(Boolean).join(', ');
    });
  }""",
}

SHOTS = [  # name, width, height, scheme, query, full page
  ("results-dark-390", 390, 844, "dark", "?q=tofu", False),
  ("home-dark-390", 390, 844, "dark", "", False),
  ("results-dark-1280", 1280, 900, "dark", "?q=tofu", False),
  ("results-light-1280", 1280, 900, "light", "?q=tofu", False),
  ("results-light-390", 390, 844, "light", "?q=tofu", False),
]

async def main(opts):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        for opt in opts:
            for name, w, h, scheme, q, full in SHOTS:
                ctx = await b.new_context(viewport={"width": w, "height": h}, color_scheme=scheme,
                                          device_scale_factor=2 if w < 500 else 1, reduced_motion="reduce")
                pg = await ctx.new_page()
                await pg.route("**/*", lambda r: r.abort() if not r.request.url.startswith("http://localhost") and r.request.resource_type == "image" and False else r.continue_())
                await pg.goto(BASE + q, wait_until="networkidle", timeout=90000)
                if opt in CSS:
                    await pg.add_style_tag(path=str(HERE / CSS[opt]))
                if opt in JS:
                    await pg.evaluate(JS[opt])
                await pg.evaluate("() => document.querySelectorAll('body *').forEach(e => { if (getComputedStyle(e).position === 'fixed') e.style.visibility = 'hidden'; })")
                await pg.wait_for_timeout(2500)
                await pg.screenshot(path=str(OUT / f"{opt}-{name}.png"), full_page=full)
                await ctx.close()
        await b.close()

asyncio.run(main(sys.argv[1:] or ["current", "a", "b", "c"]))
