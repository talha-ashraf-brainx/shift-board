#!/usr/bin/env bash
# Creates a tiny plain-Node sample repo with a few obvious bugs for Agent Board demos.
#
# Usage: scripts/seed-sample-repo.sh [--force] [path]
#   path     target directory (default: $HOME/agent-board-sample)
#   --force  delete and recreate the directory if it already exists and is not empty
set -euo pipefail

FORCE=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    -h|--help)
      sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *)
      if [[ -n "$TARGET" ]]; then echo "Only one path may be given" >&2; exit 2; fi
      TARGET="$arg"
      ;;
  esac
done
TARGET="${TARGET:-$HOME/agent-board-sample}"

if [[ -e "$TARGET" && ! -d "$TARGET" ]]; then
  echo "Error: $TARGET exists and is not a directory." >&2
  exit 1
fi
if [[ -d "$TARGET" && -n "$(ls -A "$TARGET" 2>/dev/null)" ]]; then
  if [[ "$FORCE" -ne 1 ]]; then
    echo "Error: $TARGET already exists and is not empty. Re-run with --force to replace it." >&2
    exit 1
  fi
  case "$(cd "$TARGET" && pwd -P)" in
    /|"$HOME"|"$(cd "$HOME" && pwd -P)") echo "Error: refusing to delete $TARGET" >&2; exit 1 ;;
  esac
  rm -rf "$TARGET"
fi

mkdir -p "$TARGET/src" "$TARGET/test"
cd "$TARGET"

cat > package.json <<'EOF'
{
  "name": "agent-board-sample",
  "version": "1.0.0",
  "private": true,
  "description": "Tiny checkout library with a few deliberate bugs, used to demo Agent Board.",
  "main": "src/index.js",
  "scripts": {
    "test": "node --test"
  },
  "license": "MIT"
}
EOF

cat > .gitignore <<'EOF'
node_modules/
.DS_Store
EOF

cat > src/config.js <<'EOF'
'use strict';

// Shop-wide settings. Several features read from here, so two tickets touching
// this file at the same time is a good way to demo a merge conflict.
module.exports = {
  currency: 'USD',
  pageSize: 3,
  freeShippingThreshold: 50,
  shippingCost: 5,
  shopName: 'Sample Shop',
};
EOF

cat > src/cart.js <<'EOF'
'use strict';

const config = require('./config');

/** Total number of units in the cart (sum of quantities). */
function itemCount(items) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Number of pages needed to show `totalItems` items, `pageSize` per page. */
function pageCount(totalItems, pageSize = config.pageSize) {
  if (totalItems <= 0) return 0;
  // BUG (off-by-one): drops the last partial page.
  return Math.floor(totalItems / pageSize);
}

/** Items shown on a 1-based page. */
function pageItems(items, page, pageSize = config.pageSize) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/** Cart subtotal in dollars. */
function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

module.exports = { itemCount, pageCount, pageItems, subtotal };
EOF

cat > src/discount.js <<'EOF'
'use strict';

const config = require('./config');

/** Orders at or above the threshold ship for free. */
function qualifiesForFreeShipping(subtotal) {
  // BUG (wrong comparison): an order of exactly the threshold should qualify.
  return subtotal > config.freeShippingThreshold;
}

function shippingFor(subtotal) {
  return qualifiesForFreeShipping(subtotal) ? 0 : config.shippingCost;
}

module.exports = { qualifiesForFreeShipping, shippingFor };
EOF

cat > src/greet.js <<'EOF'
'use strict';

const config = require('./config');

function greeting(name) {
  // BUG (typo): "Welcom" should be "Welcome".
  return `Welcom back, ${name}!`;
}

function storeBanner() {
  return `${config.shopName}: free shipping over $${config.freeShippingThreshold}`;
}

module.exports = { greeting, storeBanner };
EOF

cat > src/index.js <<'EOF'
'use strict';

const cart = require('./cart');
const { shippingFor } = require('./discount');
const { greeting } = require('./greet');

/** Builds a plain-text checkout summary. */
function checkoutSummary(customer, items) {
  const sub = cart.subtotal(items);
  const ship = shippingFor(sub);
  return [
    greeting(customer),
    `Items: ${cart.itemCount(items)}`,
    `Subtotal: $${sub.toFixed(2)}`,
    `Shipping: $${ship.toFixed(2)}`,
    `Total: $${(sub + ship).toFixed(2)}`,
  ].join('\n');
}

module.exports = { checkoutSummary };

if (require.main === module) {
  console.log(
    checkoutSummary('Ada', [
      { name: 'Mug', price: 12.5, quantity: 2 },
      { name: 'Tea', price: 25, quantity: 1 },
    ]),
  );
}
EOF

cat > test/cart.test.js <<'EOF'
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { itemCount, pageCount, pageItems } = require('../src/cart');

test('itemCount sums quantities', () => {
  assert.equal(itemCount([{ quantity: 2 }, { quantity: 3 }]), 5);
});

test('pageCount includes the last partial page', () => {
  assert.equal(pageCount(0, 3), 0);
  assert.equal(pageCount(3, 3), 1);
  assert.equal(pageCount(7, 3), 3);
  assert.equal(pageCount(1, 3), 1);
});

test('pageItems returns the right slice', () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(pageItems(items, 3, 3), [7]);
});
EOF

cat > test/discount.test.js <<'EOF'
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { qualifiesForFreeShipping, shippingFor } = require('../src/discount');

test('orders above the threshold ship free', () => {
  assert.equal(qualifiesForFreeShipping(80), true);
});

test('an order of exactly the threshold ships free', () => {
  assert.equal(qualifiesForFreeShipping(50), true);
  assert.equal(shippingFor(50), 0);
});

test('orders below the threshold pay shipping', () => {
  assert.equal(shippingFor(49.99), 5);
});
EOF

cat > test/greet.test.js <<'EOF'
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { greeting } = require('../src/greet');

test('greeting welcomes the customer back', () => {
  assert.equal(greeting('Ada'), 'Welcome back, Ada!');
});
EOF

cat > CLAUDE.md <<'EOF'
# Agent notes for this repo

- This is a tiny plain-JavaScript (CommonJS) project. There are **no dependencies**: do not run
  `npm install` and do not add packages.
- Run the tests with `npm test` (uses the built-in `node --test` runner). Make sure they pass
  before you finish.
- Keep changes minimal and focused on the ticket. Do not reformat or refactor unrelated code.
- Use plain JS only: no TypeScript, no build step, no new tooling.
- Prefer fixing the source over changing tests, unless the ticket says the test is wrong.
EOF

cat > README.md <<'EOF'
# agent-board-sample

A tiny checkout library used to demo Agent Board. It has a few deliberate bugs, and the test
suite fails until they are fixed.

```sh
npm test                # node --test, no dependencies needed
node src/index.js       # prints a sample checkout summary
```

Files:

- `src/cart.js`: item counts and pagination
- `src/discount.js`: free-shipping rule
- `src/greet.js`: customer-facing strings
- `src/config.js`: shared shop settings
- `test/*.test.js`: `node:test` tests
EOF

git init -q -b main
git add -A
IDENTITY=()
git config --get user.name >/dev/null 2>&1 || IDENTITY+=(-c "user.name=Agent Board")
git config --get user.email >/dev/null 2>&1 || IDENTITY+=(-c "user.email=agent-board@localhost")
git ${IDENTITY[@]+"${IDENTITY[@]}"} commit -q -m "Initial commit: sample checkout library"

cat <<EOF

Created sample repo at: $TARGET  (branch main, 1 commit)

  package.json        "test": "node --test" (no dependencies)
  src/cart.js         off-by-one in pageCount()
  src/discount.js     '>' instead of '>=' for the free-shipping threshold
  src/greet.js        typo "Welcom back"
  src/config.js       shared settings (good for a merge-conflict demo)
  src/index.js        checkoutSummary()
  test/*.test.js      node:test tests that currently FAIL
  CLAUDE.md, README.md

Point Agent Board at it:
  TARGET_REPO_PATH=$TARGET
  BASE_BRANCH=main

Ticket ideas:
  1. [high]   "Pagination drops the last page": pageCount(7, 3) returns 2, expected 3 (src/cart.js).
  2. [medium] "Free shipping not applied at exactly \$50": orders of exactly the threshold should
              ship free (src/discount.js).
  3. [low]    "Typo in returning-customer greeting": shows "Welcom back", should be "Welcome back"
              (src/greet.js).
  4. [vague]  "make checkout better" (should end in Needs context with questions).
  5. [conflict demo] Two tickets that both edit the same line of src/config.js, e.g.
              "Show 5 items per page" and "Show 10 items per page". Let both reach Review,
              approve one, then approving the other hits a merge conflict.
EOF
