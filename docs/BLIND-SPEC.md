# Blind holdout spec (written Nov 16, 2026, before the 60 requests)

This file was committed **before** any of the 60 blind requests were written, and the requests were committed **before** the tool was run on them. The tool is run on them once. Its rules are not changed in response, and what it gets wrong is reported, not fixed. A later round that fixes these misses must write a new blind set.

> All data is SYNTHETIC. Names are invented, phones use 555-01xx, emails use example domains, and no street address appears. Towns and ZIP codes are real places, used only to test the service-area rule.

**Honest limit.** The person who writes this set also wrote the v2 rules, earlier the same day. "Blind" here means the quotas and labelling rules below were fixed first, the requests were written to the spec and to real-world phrasing (not to the rules), and nothing was tuned afterwards. It is not an independent test. An independent test needs someone else to write the requests, or real leads.

## What the set must contain (60)

**By the correct action (the label):**

| Label | Count | What it means |
| --- | --- | --- |
| Book measure | 20 | In the measure area, with phone, place, timeline and budget all given somewhere in the request |
| Needs info | 10 | In the area (or not placeable), missing at least one of: place, phone, timeline, budget |
| Trade desk | 8 | 10+ units, or an investor or landlord with 2–9 units. At least one is outside the measure area |
| Order-taking | 8 | Outside Orange, Seminole, Osceola and Lake counties, or out of state |
| Spam | 6 | Not a customer: vendor pitch, scam, junk |
| Duplicate | 4 | The same person about the same job, again within 14 days, through any channel |
| Not a fit | 4 | Nothing for QBC to sell: installation only, countertops only, repair or painting of existing cabinets |

**By how it is written** (each request has exactly one style):

| Style | Count | What it looks like |
| --- | --- | --- |
| clean | 13 | A tidy web form, dropdowns used as intended |
| typos | 12 | Lowercase, misspellings, run-ons, text-speak, ZIP instead of city |
| spanish | 8 | Spanish or Spanish and English mixed, as typed by the customer |
| voicemail | 9 | A phone-system transcript in the message. Form fields blank except what caller ID gives |
| forwarded | 9 | An email forwarded into the inbox: forward headers, quoted text, a signature. Form fields blank |
| minimal | 9 | A one-line or near-empty submission |

**Also:** 6 leads are urgent (active water damage, or a dated closing, move-in or insurance deadline). At least 6 places are towns or neighborhoods chosen from a map of Central Florida, not from any list in the code. Two requests are the same household or company with a *different* job (not duplicates).

**Channels:** website form, Meta lead form, Google Business Profile message, voicemail, email. Requests arrive Tue Nov 10 to Fri Nov 13, 2026. The sample clock is Sat Nov 14, 08:00 ET.

## How each label is decided

The label is what QBC's written routing rules (settled Nov 11, 2026) require, read by a careful person who reads the **whole** request, including the message, the transcript and the email signature.

1. **Information anywhere counts.** A phone number in a voicemail transcript or an email signature is a phone number. A city in the message is a place. A ZIP is a place.
2. **Place:** use the real county of the town, neighborhood or ZIP. A request that names no place, or only a region ("Central Florida", "near Orlando"), cannot be placed.
3. **Missing:** place, phone, timeline and budget are the four details. "Not sure" for a budget, and "just planning" for a timeline, count as answers.
4. **Order of the rules:** Spam, then Duplicate, then Not a fit, then Trade desk, then Order-taking, then Needs info, then Book measure. The first that applies is the label.
5. **Ask list** (Needs info, and trade jobs of 10+ units with no plans): exactly the details that are missing, and nothing else.
6. **Urgent** is labelled only on leads, and only for active damage or a dated deadline. "ASAP" alone is not urgent.
7. **Duplicate:** same person (same phone, email or name with the same town) about the same job within 14 days, regardless of channel. Its label names the first request.
8. **Language does not change the label.** The reply's language is not scored.

## What is reported (once)

Lane accuracy with a 95% Wilson interval, harmful misses and false screen-outs with Wilson intervals, ask accuracy, urgent precision and recall, duplicates merged correctly, and accuracy by style. Every miss is listed with its severity. The run is recorded in `eval/BLIND.md` and `eval/blind-results.json`.
