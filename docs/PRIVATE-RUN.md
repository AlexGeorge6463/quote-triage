# Running real leads privately

Everything in this repository is SYNTHETIC. To see how the rules do on real leads without putting anyone's details at risk, use `scripts/private-run.js`. It reads a file you keep **outside any git repository**, runs the same rules, and prints **counts only**.

```
node scripts/private-run.js ~/private/leads.csv          # readable summary
node scripts/private-run.js ~/private/leads.csv --json   # the same counts as JSON
```

## Guarantees

- **It refuses any file inside a git repository.** Real leads cannot land in a commit through this tool.
- **It writes nothing to disk.**
- **It prints aggregates only:** how many leads, what the tool would suggest, what the team actually did, how often they agree, which way they disagree, whether any disagreement would have been harmful, which details the drafts would ask for, and the team's minutes from arrival to first action.
- **It checks its own output** for every name, name part, email, phone number, town and four-word run of message text in the input. If any would appear, it prints nothing and exits with code 4.

## Input

One of:

1. **A CSV with these columns:** `received, source, name, phone, email, location, role, project, units, budget, timeline, plans, message, team_action, team_action_at, exclude`.
2. **A Meta Leads Center export** (comma or tab separated, UTF-8 or UTF-16) with two columns added by hand: `team_action` and `team_action_at`. Custom form questions are folded into the message.
3. **A `.txt` file of pasted website lead emails**, one after another, separated by a line of five or more dashes, each with a `Team action:` line and a `Team action at:` line added at the end.

`team_action` is what the team actually did **first**: `book`, `info`, `trade`, `order`, `decline`, `spam`, `duplicate` or `none`. Times without an offset (`2026-11-15T14:10`) are read as US Eastern. A row is skipped if its `exclude` column says yes, or if its name or message contains the word `TEST`.

## Reading the result

With a handful of leads, read the output as individual cases, not as rates. A 95% interval on 4 leads spans most of the range from 0 to 100%. The run is worth doing anyway: it shows where the written rules and the team's real first move differ, and that is a policy question, not a scoring one.
