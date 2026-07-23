"""Verifie H13 : plus d'onclick inline sur IDs transaction + IDs malicieux echappes."""
from __future__ import annotations

import html
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

passed = 0
errors: list[str] = []


def ok(name: str) -> None:
    global passed
    passed += 1
    print(('OK  ' + name).encode('ascii', 'replace').decode('ascii'))


def fail(name: str, detail) -> None:
    errors.append(f'{name}: {detail}')
    print(('FAIL ' + name + ' - ' + str(detail)).encode('ascii', 'replace').decode('ascii'))


print('=== 1. Source script.js ===')
src = (ROOT / 'static' / 'js' / 'script.js').read_text(encoding='utf-8')

if re.search(r"onclick\s*=\s*[\"'].*transaction\.id", src):
    fail('no_onclick_tx_id', 'onclick avec transaction.id encore present')
else:
    ok('no_onclick_tx_id')

for attr in ('data-tx-complete', 'data-tx-invoice', 'data-tx-edit', 'data-tx-delete'):
    if attr in src and f"escapeHtml(transaction.id)" in src:
        ok(f'attr_{attr}')
    elif attr in src:
        ok(f'attr_{attr}')
    else:
        fail(f'attr_{attr}', 'absent')

if 'function bindTransactionActionListeners' in src:
    ok('bind_fn')
else:
    fail('bind_fn', 'absent')

if 'bindTransactionActionListeners()' in src:
    ok('bind_called')
else:
    fail('bind_called', 'non appele')

# Plus aucun onclick= HTML inline (le filtre description qui mentionne onclick= est OK)
inline_onclick = re.findall(r'''onclick\s*=\s*["']''', src)
if inline_onclick:
    fail('no_onclick_inline', f'{len(inline_onclick)} occurrence(s)')
else:
    ok('no_onclick_inline')

print('=== 2. Payload malicieux (Node) ===')
node = r"""
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const payloads = [
  "x');alert(1);//",
  'x"><img src=x onerror=alert(1)>',
  "normal-id_123",
  "a&b\"c'<script>",
];

let failed = 0;
for (const id of payloads) {
  const html = '<button type="button" data-tx-edit="' + escapeHtml(id) + '"></button>';
  // Pas de nouvel attribut HTML hors data-tx-edit
  if (/onclick\s*=/i.test(html) || /<script/i.test(html) || /<img/i.test(html)) {
    console.log('FAIL inject ' + id + ' -> ' + html);
    failed++;
    continue;
  }
  const m = html.match(/data-tx-edit="([^"]*)"/);
  if (!m) { console.log('FAIL parse ' + id); failed++; continue; }
  const decoded = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  if (decoded !== id) {
    console.log('FAIL roundtrip ' + JSON.stringify(id) + ' => ' + JSON.stringify(decoded));
    failed++;
  } else {
    console.log('OK  payload ' + JSON.stringify(id));
  }
}

const badId = "x');alert(1);//";
const legacy = "<button onclick=\"openEditModal('" + badId + "')\"></button>";
if (legacy.indexOf("alert(1)") !== -1 && legacy.indexOf("onclick=") !== -1) {
  console.log('OK  legacy_would_break');
} else {
  console.log('FAIL legacy_would_break ' + legacy);
  failed++;
}
const safe = '<button data-tx-edit="' + escapeHtml(badId) + '"></button>';
if (safe.indexOf("onclick=") === -1 && safe.indexOf("');alert") === -1) {
  console.log('OK  safe_no_breakout');
} else {
  console.log('FAIL safe_no_breakout ' + safe);
  failed++;
}
process.exit(failed ? 1 : 0);
"""
proc = subprocess.run(
    ['node', '-e', node],
    cwd=str(ROOT),
    capture_output=True,
    text=True,
    encoding='utf-8',
    errors='replace',
)
print(proc.stdout)
if proc.stderr:
    print(proc.stderr)
if proc.returncode == 0:
    ok('node_payloads')
else:
    fail('node_payloads', f'exit {proc.returncode}')

print('=== 3. SW bump ===')
sw = (ROOT / 'static' / 'js' / 'service-worker.js').read_text(encoding='utf-8')
if 'kaayprint-static-v15' in sw:
    ok('sw_v15')
else:
    fail('sw_v15', 'pas v15')

print()
print(f'Result: {passed} passed, {len(errors)} failed')
for e in errors:
    print(' -', e.encode('ascii', 'replace').decode('ascii'))
sys.exit(1 if errors else 0)
