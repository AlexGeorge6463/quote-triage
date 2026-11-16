#!/usr/bin/env python3
"""Browser smoke test for index.html. Needs Python Playwright (pip install playwright; playwright install chromium).
Run: python3 test/ui_smoke.py   (exit code 0 = pass). Opens the file directly; no server needed."""
import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'index.html').as_uri()
RESULTS = json.loads((ROOT / 'eval' / 'results.json').read_text())
BLIND = json.loads((ROOT / 'eval' / 'blind-results.json').read_text())
fails = []
def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        await ctx.route('https://fonts.*/**', lambda r: r.abort())  # fonts are cosmetic; keep the test offline
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(500)
        check('22 open' in await pg.inner_text('#tab-review'), 'the Monday inbox opens with 22 requests')
        check(await pg.evaluate("document.querySelector('.group-h').textContent.startsWith('Urgent')"), 'urgent requests are grouped first')
        await pg.click('#row-QR-1062')
        check('Trade desk' in await pg.inner_text('#suggest'), 'QR-1062 (ZIP only, two rentals) is suggested for the trade desk')
        check('34741' in await pg.inner_text('.rawf'), 'the card shows the location exactly as typed')
        before = await pg.evaluate('QT.app.state.selected')
        await pg.keyboard.press('a'); await pg.wait_for_timeout(100)
        check(await pg.evaluate("QT.app.state.status['QR-1062'] && QT.app.state.status['QR-1062'].verdict") == 'approved', 'A approves the selected request')
        check(await pg.evaluate('QT.app.state.selected') != before, 'approving opens the next request')
        check('QR-1062' in await pg.inner_text('#log'), 'the approval writes a log row')
        await pg.click('#undo'); await pg.wait_for_timeout(100)
        check(await pg.evaluate("!QT.app.state.status['QR-1062']"), 'Undo reverses the approval')
        await pg.click('#row-QR-1061'); await pg.click('#approve'); await pg.wait_for_timeout(100)
        log = await pg.inner_text('#log')
        check('re-triaged: Needs info → Book measure' in log, 'approving the merge re-triages the first request')
        await pg.click('#row-QR-1046')
        check('Book measure' in await pg.inner_text('#suggest') and 'Merged in from QR-1061' in await pg.inner_text('.came'), 'the merged request shows where its new details came from')
        check('PHONE' in (await pg.inner_text('.rawf')).upper() and 'blank' in await pg.inner_text('.rawf'), 'what came in still shows the blanks she left')
        await pg.click('#row-QR-1053'); await pg.keyboard.press('e')
        await pg.select_option('#lane-sel', 'book'); await pg.click('#save-approve'); await pg.wait_for_timeout(100)
        check('override: rules said Order-taking' in await pg.inner_text('#log'), 'a changed action is logged as an override')
        await pg.click('#row-QR-1041'); await pg.keyboard.press('a'); await pg.wait_for_timeout(100)
        check('your pace' in await pg.inner_text('#stats'), 'after three decisions the pace counter shows a measured rate')
        await pg.click('#tab-eval'); await pg.wait_for_timeout(200)
        hero = await pg.inner_text('.hero')
        blind_pct = f"{round(100 * BLIND['v2']['lane']['x'] / BLIND['v2']['lane']['n'])}%"
        check(blind_pct in hero and f"{round(RESULTS['after']['lanePct'])}%" in hero, 'the Evaluation tab leads with the blind result and matches the recorded reports')
        check('business kpis' in (await pg.inner_text('#p-eval')).lower(), 'the Evaluation tab shows the business KPIs')
        await pg.click('[data-eng="blind"]'); await pg.wait_for_timeout(100)
        check('B-' in await pg.inner_text('table.misses:last-of-type') or 'B-' in await pg.inner_text('#p-eval'), 'the blind run can be shown in the matrix and the miss list')
        check(await pg.evaluate("document.querySelectorAll('table.mx td').length") == 49, 'the confusion matrix is 7 by 7')
        await pg.click('#tab-how'); await pg.wait_for_timeout(100)
        check('duplicate of' in await pg.inner_text('#p-how'), 'How it works lists the duplicate-of link')
        t = await ctx.new_page(); t.on('pageerror', lambda e: errs.append(str(e)))
        await t.goto(URL + '#tour'); await t.wait_for_timeout(300)
        for _ in range(6):
            await t.click('#t-next'); await t.wait_for_timeout(150)
        check(await t.evaluate("!document.querySelector('.tour-card') && QT.app.state.tab === 'eval'"), 'the 60-second tour runs to the end and lands on Evaluation')
        m = await b.new_context(viewport={'width': 390, 'height': 844})
        await m.route('https://fonts.*/**', lambda r: r.abort())
        mp = await m.new_page(); await mp.goto(URL); await mp.wait_for_timeout(300)
        check(await mp.evaluate('document.documentElement.scrollWidth') <= 390, 'no horizontal scroll at 390px')
        check(not errs, 'no page errors ' + '; '.join(errs))
        await b.close()

asyncio.run(main())
sys.exit(1 if fails else 0)
