import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Word → number mapping
_WORD_NUMBERS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "ninety": 90,
    "half": 0,  # handled specially
}

# Pattern: digit or word number followed by time unit
_UNIT_PATTERN = re.compile(
    r"(\d+(?:\.\d+)?|" + "|".join(sorted(_WORD_NUMBERS.keys(), key=len, reverse=True)) + r")"
    r"\s*(?:and\s+a?\s*)?"
    r"(hours?|hrs?|minutes?|mins?|seconds?|secs?)",
    re.IGNORECASE,
)

# "half an hour" / "half a minute"
_HALF_PATTERN = re.compile(r"half\s+an?\s+(hour|minute|min)", re.IGNORECASE)


def _parse_value(token: str) -> float:
    token = token.lower().strip()
    try:
        return float(token)
    except ValueError:
        return float(_WORD_NUMBERS.get(token, 0))


def extract_duration_seconds(text: str) -> Optional[int]:
    """Extract total duration in seconds from text. Handles digits and word numbers."""
    total = 0.0
    found = False

    # Handle "half an hour" / "half a minute"
    for m in _HALF_PATTERN.finditer(text):
        unit = m.group(1).lower()
        if unit.startswith("hour"):
            total += 1800
        else:
            total += 30
        found = True

    # Handle numeric and word-form durations
    for m in _UNIT_PATTERN.finditer(text):
        value = _parse_value(m.group(1))
        unit = m.group(2).lower()
        if unit.startswith("hour") or unit.startswith("hr"):
            total += value * 3600
        elif unit.startswith("min"):
            total += value * 60
        elif unit.startswith("sec"):
            total += value
        if value > 0:
            found = True

    return int(total) if found and total > 0 else None
