"""Sanitize HTML des notes (allowlist stricte via bleach)."""
from __future__ import annotations

import bleach
from bleach.css_sanitizer import CSSSanitizer

NOTE_HTML_MAX_LEN = 8000

ALLOWED_TAGS = frozenset({
    'b', 'strong', 'i', 'em', 'u', 's', 'strike',
    'p', 'br', 'div', 'span',
    'ul', 'ol', 'li',
    'h3', 'blockquote',
    'a',
})

ALLOWED_ATTRIBUTES = {
    'a': ['href', 'title', 'target', 'rel'],
}

ALLOWED_PROTOCOLS = frozenset({'http', 'https', 'mailto'})


def sanitize_note_html(value: str | None) -> str:
    """Nettoie le HTML d'une note avant persistance."""
    raw = str(value or '').strip()
    if not raw:
        return ''

    if '<' not in raw:
        return raw[:NOTE_HTML_MAX_LEN]

    cleaned = bleach.clean(
        raw,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
        css_sanitizer=CSSSanitizer(allowed_css_properties=[]),
    )
    return cleaned.strip()[:NOTE_HTML_MAX_LEN]


def sanitize_plain_text(value: str | None, max_len: int = 200) -> str:
    """Supprime toute balise (titres, etc.)."""
    raw = str(value or '').strip()
    if not raw:
        return ''
    return bleach.clean(raw, tags=[], strip=True).strip()[:max_len]
