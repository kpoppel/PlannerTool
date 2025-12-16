import re

def slugify(text, prefix: str = "") -> str:
    """Create a URL-safe slug optionally prefixed.

    Ensures consistent IDs across API responses. When `prefix` is provided,
    it will be prepended to the slug (e.g., prefix="project-" -> "project-alpha").
    """
    text = str(text).lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    base = text.strip('-')
    return (prefix + base) if prefix else base
