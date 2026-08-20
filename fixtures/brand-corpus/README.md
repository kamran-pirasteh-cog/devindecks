# Brand conversion corpus

Drop real `.pptx` files in here. `npm run validate:brand` parses each one with the
production importer, converts it with the brand engine, and **exits non-zero on any
error-severity diagnostic**.

This is the gate that makes "converted decks are defect free" a property of the
system rather than a claim about it. The unit tests in `src/brand` prove each rule
against slides written to exercise that rule; a corpus deck is where an untested
*combination* of rules breaks something.

With no `.pptx` here the script falls back to the three bundled reference decks.
That still exercises the whole pipeline end to end, but those decks are already
on-brand — so it is a regression check, not a real test of the conversion. Seed
this directory with decks that came from somewhere else.

Files here are not committed (see `.gitignore`); client decks should not live in
the repo.
