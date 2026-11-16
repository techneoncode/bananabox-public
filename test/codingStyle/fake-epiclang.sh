#!/bin/sh
# Fake epiclang: logs its arguments and prints Banana-style diagnostics for the last argument.
echo "$@" > "${FAKE_LOG:-/dev/null}"
if [ -n "$FAKE_SLEEP" ]; then sleep "$FAKE_SLEEP"; fi
for last; do :; done
echo "$last:3:5: warning: [Banana] [Major] nested while statement at depth 3 (C-C1)" >&2
echo "   3 |     while (x) {" >&2
echo "     |     ^~~~~~~~~" >&2
exit 1
