#!/usr/bin/env python3
"""
Post-process existing fixture files to ensure complete anonymization.
This avoids re-calling the Azure API when anonymization gaps are found.
"""
import json
import re
from pathlib import Path
from typing import Any, Dict, List
import sys


def anon_url(url: str) -> str:
    """Replace Azure DevOps URLs with localhost equivalents."""
    if not url:
        return url
    s = str(url)
    # Replace Visual Studio URLs with localhost
    s = re.sub(r'https://[a-zA-Z0-9\-]+\.vssps\.visualstudio\.com/[A-Za-z0-9\-]+/', 'http://localhost:8002/', s)
    # Replace all dev.azure.com URLs
    s = re.sub(r'https://dev\.azure\.com/[^/]+/', 'http://localhost:8002/', s)
    return s


def anon_field_name(field_name: str) -> str:
    """Replace organization-specific field prefixes with generic ones."""
    if not field_name.startswith(('System.', 'Microsoft.')):
        # Match pattern like "WSA.Something" or "WEF_Something"
        field_name = re.sub(r'^[A-Z]{2,}[._]', 'ORG.', field_name)
    return field_name


def deep_anon(obj: Any) -> Any:
    """Recursively anonymize URLs, field names, and identities in nested data."""
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            # Anonymize field/key names
            new_k = anon_field_name(k) if isinstance(k, str) else k
            
            # Anonymize URL values
            if k == 'url' and isinstance(v, str):
                result[new_k] = anon_url(v)
            # Anonymize identity objects (displayName, uniqueName present)
            elif isinstance(v, dict) and ('displayName' in v or 'uniqueName' in v):
                identity = dict(v)
                if 'uniqueName' in identity and '@' in identity['uniqueName']:
                    identity['uniqueName'] = 'person@example.com'
                if 'url' in identity:
                    identity['url'] = anon_url(identity['url'])
                identity.pop('imageUrl', None)
                identity.pop('_links', None)
                result[new_k] = deep_anon(identity)
            # Special handling for reference_name and category_reference_name
            elif k in ('reference_name', 'category_reference_name', 'id') and isinstance(v, str):
                result[new_k] = anon_field_name(v)
            # Anonymize string values that are URLs
            elif isinstance(v, str) and ('http://' in v or 'https://' in v):
                result[new_k] = anon_url(v)
            # Anonymize string values that match org patterns (WSA.WIT., etc.)
            elif isinstance(v, str) and re.match(r'^[A-Z]{2,}\.[A-Z]', v):
                result[new_k] = anon_field_name(v)
            # Anonymize email addresses in strings (including "Name <email>" format)
            elif isinstance(v, str) and '@' in v:
                # Replace email patterns in strings
                v = re.sub(r'\b[a-zA-Z0-9._%+-]+@wsa\.com\b', 'person@example.com', v)
                v = re.sub(r'<[a-zA-Z0-9._%+-]+@wsa\.com>', '<person@example.com>', v)
                # Also anonymize org-specific field references within XML/strings
                v = re.sub(r'\bWSA\.WIT\.', 'ORG.WIT.', v)
                v = re.sub(r'\bWEF_', 'ORG_', v)
                result[new_k] = deep_anon(v) if isinstance(v, (dict, list)) else v
            # Recurse into nested structures
            else:
                result[new_k] = deep_anon(v)
        return result
    elif isinstance(obj, (list, tuple)):
        return [deep_anon(item) for item in obj]
    elif isinstance(obj, str):
        # Anonymize standalone strings (in arrays) if they're URLs or org patterns
        obj = obj if not ('http://' in obj or 'https://' in obj) else anon_url(obj)
        if re.match(r'^[A-Z]{2,}\.[A-Z]', obj):
            obj = anon_field_name(obj)
        # Anonymize emails in standalone strings
        if '@' in obj:
            obj = re.sub(r'\b[a-zA-Z0-9._%+-]+@wsa\.com\b', 'person@example.com', obj)
            obj = re.sub(r'<[a-zA-Z0-9._%+-]+@wsa\.com>', '<person@example.com>', obj)
        return obj
    else:
        return obj


def process_file(path: Path) -> int:
    """Process a single JSON file and return number of changes made."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            original = f.read()
        
        data = json.loads(original)
        anonymized = deep_anon(data)
        
        new_content = json.dumps(anonymized, indent=2, ensure_ascii=False) + '\n'
        
        if new_content != original:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            return 1
        return 0
    except Exception as e:
        print(f"Error processing {path.name}: {e}", file=sys.stderr)
        return 0


def main():
    fixture_dir = Path(__file__).parent.parent / 'data' / 'azure_mock'
    
    if not fixture_dir.exists():
        print(f"Fixture directory not found: {fixture_dir}", file=sys.stderr)
        sys.exit(1)
    
    json_files = sorted(fixture_dir.glob('*.json'))
    if not json_files:
        print(f"No JSON files found in {fixture_dir}", file=sys.stderr)
        sys.exit(1)
    
    print(f"Processing {len(json_files)} fixture files in {fixture_dir}...")
    
    changed = 0
    for path in json_files:
        if path.name == '_manifest.json':
            continue  # Skip manifest
        changed += process_file(path)
    
    print(f"✓ Complete: {changed} files updated, {len(json_files) - changed - 1} unchanged")


if __name__ == '__main__':
    main()
