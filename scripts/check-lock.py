#!/usr/bin/env python3
"""
Fails when backend/requirements.lock no longer matches backend/requirements.txt.

The Docker image installs requirements.lock (exact versions + hashes). If somebody changes a version in
requirements.txt and forgets to regenerate the lock, the image would silently keep the old version.

Run from the backend directory:   python ../scripts/check-lock.py
"""
import re
import sys
from pathlib import Path

PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9_.\-]*)(\[[^\]]*\])?==([^\s;\\]+)")


def pins(path: Path) -> dict:
    found = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = PIN.match(line.strip())
        if match:
            found[re.sub(r"[-_.]+", "-", match.group(1)).lower()] = match.group(3)
    return found


def main() -> int:
    wanted, locked = pins(Path("requirements.txt")), pins(Path("requirements.lock"))
    if not wanted or not locked:
        print("requirements.txt or requirements.lock could not be read (run this from the backend directory).")
        return 1
    problems = [f"{name}=={version}   (lock has: {locked.get(name, 'nothing')})"
                for name, version in sorted(wanted.items()) if locked.get(name) != version]
    if problems:
        print("requirements.lock is out of date:\n  " + "\n  ".join(problems))
        print("\nRegenerate it in the backend directory:\n"
              "  uv pip compile requirements.txt --python-version 3.11 --generate-hashes -o requirements.lock")
        return 1
    print(f"requirements.lock matches requirements.txt ({len(wanted)} direct packages, {len(locked)} locked in total).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
