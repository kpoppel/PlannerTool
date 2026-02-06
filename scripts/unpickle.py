#!/usr/bin/env python3
"""Small CLI to unpickle a file and print or save its content.

Warning: unpickling untrusted data is UNSAFE and can execute arbitrary code.
Use only on files you trust.
"""

from __future__ import annotations

import argparse
import json
import os
import pickle
import pprint
import sys


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Unpickle a file and show its contents")
    p.add_argument("path", help="Path to the pickle file")
    p.add_argument("-o", "--output", help="Write textual representation to file instead of stdout")
    p.add_argument("-j", "--json", action="store_true", help="Try to dump the object as JSON (fallbacks to repr on failure)")
    p.add_argument("-q", "--quiet", action="store_true", help="Do not print warnings/summary to stderr")
    return p.parse_args()


def safe_json_dumps(obj):
    try:
        return json.dumps(obj, indent=2, default=str)
    except Exception:
        # Fallback: JSON can't represent this object; use repr
        return json.dumps({"repr": repr(obj)}, indent=2)


def main() -> int:
    args = parse_args()
    path = args.path

    if not os.path.exists(path):
        print(f"Error: file not found: {path}", file=sys.stderr)
        return 2

    if not args.quiet:
        print("WARNING: Unpickling arbitrary files is unsafe. Only unpickle trusted files.", file=sys.stderr)

    try:
        with open(path, "rb") as fh:
            obj = pickle.load(fh)
    except Exception as exc:
        print(f"Failed to unpickle '{path}': {exc}", file=sys.stderr)
        return 3

    # Prepare textual output
    if args.json:
        out_text = safe_json_dumps(obj)
    else:
        out_text = pprint.pformat(obj, width=120)

    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8") as of:
                of.write(out_text)
        except Exception as exc:
            print(f"Failed to write output file '{args.output}': {exc}", file=sys.stderr)
            return 4
    else:
        print(out_text)

    if not args.quiet:
        t = type(obj)
        summary = f"Unpickled object type: {t.__module__}.{t.__name__}"
        try:
            length = len(obj)
            summary += f", length: {length}"
        except Exception:
            pass
        print(summary, file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
