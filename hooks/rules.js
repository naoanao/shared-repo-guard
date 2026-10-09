// Pure decision functions. No engine calls here, so the tests can call them directly.

// Split a shell line on ; && || and newlines. Quotes are not parsed: rough, but it errs toward stopping.
function splitCommands(cmd) {
  return String(cmd || '').split(/;|&&|\|\||\n/)
}

// "word" and 'word' become word; quoted text with spaces is left as it is.
function unquoteWords(s) {
  return String(s || '').replace(/(["'])([^"'\s]+)\1/g, '$2')
}

// Comma or whitespace separated list from a userConfig string.
export function parseList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// git push to a remote the user marked public, or push --all / --mirror.
export function pushToPublic(cmd, publicRemotes) {
  for (const raw of splitCommands(cmd)) {
    // The shell drops quotes, so "public" and 'public' push to the same remote as public.
    // Only single quoted words are unwrapped, so a message like -m "push to public" stays a message.
    const part = unquoteWords(raw)
    if (!/\bgit\b/.test(part) || !/\bpush\b/.test(part)) continue
    for (const r of publicRemotes || []) {
      const esc = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp('\\bpush\\b.*(^|\\s)' + esc + '(\\s|$|:)').test(part)) {
        return 'This pushes to "' + r + '", which is marked as a public remote. Push to your private remote instead.'
      }
    }
    if (/\s--(all|mirror)\b/.test(part)) return 'git push --all / --mirror sends every branch at once. Push the current branch only.'
  }
  return null
}

// git add -A / --all / . / ./ / :/ / * (stages everything, including other agents' work)
export function addAll(cmd) {
  for (const part of splitCommands(cmd)) {
    const m = part.match(/\bgit\s+add\b(.*)$/)
    if (!m) continue
    const args = ' ' + unquoteWords(m[1]) + ' '
    if (/\s(-A|--all|\.\/?|:\/|\*|-[a-zA-Z]*A[a-zA-Z]*)\s/.test(args)) return 'git add -A'
  }
  return null
}

// git commands that throw away uncommitted work with no way back.
export function destructiveGit(cmd) {
  for (const part of splitCommands(cmd)) {
    if (!/\bgit\b/.test(part)) continue
    if (/\bgit\s+reset\b.*\s--hard\b/.test(part)) return 'git reset --hard'
    if (/\bgit\s+checkout\b.*\s--(\s|$)/.test(part)) return 'git checkout -- <file>'
    if (/\bgit\s+checkout\s+\.(\s|$)/.test(part)) return 'git checkout .'
    if (/\bgit\s+restore\b/.test(part) && (!/\s--staged\b/.test(part) || /\s--worktree\b/.test(part))) return 'git restore'
    if (/\bgit\s+stash\b/.test(part) && !/\bgit\s+stash\s+(list|show)\b/.test(part)) return 'git stash'
    if (/\bgit\s+clean\b.*\s-[a-zA-Z]*f/.test(part)) return 'git clean -f'
  }
  return null
}

// A shell command that prints a .env file to the screen.
export function printsEnvFile(cmd) {
  const reader = /\b(cat|type|Get-Content|gc|more|less|head|tail|bat|nl|strings|xxd|od)\b[^|;&\n]*?[\\/\s'"]\.env(\.[\w.-]*)?\b/i
  return reader.test(String(cmd || ''))
    ? 'This prints a .env file. Read the value inside a script and never print it.'
    : null
}

// The Read tool opening a .env file (.env.example is a template, so it passes).
export function readsEnvFile(path) {
  if (typeof path !== 'string') return null
  const name = path.split(/[\\/]/).pop() || ''
  if (!/^\.env(\..+)?$/.test(name)) return null
  if (/\.(example|sample|template)$/.test(name)) return null
  return 'Opening a .env file puts its secrets into the conversation. Use the variable names only.'
}

// Key names that hold secrets. Public build-time variables are skipped.
const SECRET_NAME = /(SECRET|KEY|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|WEBHOOK|SIGNING|AUTH|DSN|DATABASE_URL)/i
const PUBLIC_NAME = /^(NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_|REACT_APP_)/

// Secret values from a .env body. Short values are skipped to avoid matching ordinary words.
export function secretValuesFrom(text) {
  const out = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (PUBLIC_NAME.test(key) || !SECRET_NAME.test(key)) continue
    if (val.length < 12) continue
    out.push(val)
  }
  return out
}

export function containsSecret(text, secrets) {
  if (!text || !secrets || secrets.length === 0) return false
  for (const s of secrets) if (text.includes(s)) return true
  return false
}

// Copy of a tool result with secret values masked (frozen input is never touched).
export function redact(value, secrets) {
  if (!secrets || secrets.length === 0) return value
  if (typeof value === 'string') {
    let v = value
    for (const s of secrets) if (v.includes(s)) v = v.split(s).join('[shared-repo-guard: secret hidden]')
    return v
  }
  if (Array.isArray(value)) return value.map((x) => redact(x, secrets))
  if (value && typeof value === 'object') {
    const o = {}
    for (const k of Object.keys(value)) o[k] = redact(value[k], secrets)
    return o
  }
  return value
}

// Paths from `git status --porcelain=v1 -z --untracked-files=all`. Renames give two entries; both count.
export function statusPaths(z) {
  const parts = String(z || '').split('\0').filter(Boolean)
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    out.push(normPath(entry.slice(3)))
    if (entry[0] === 'R' || entry[0] === 'C') {
      if (parts[i + 1]) out.push(normPath(parts[i + 1]))
      i++
    }
  }
  return out
}

// Forward slashes and lower case, so Windows and git spellings compare equal.
export function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

// A file path from a tool call, relative to the repository root, or null when it lies outside.
export function relativeToRoot(filePath, root) {
  const f = normPath(filePath)
  const r = normPath(root).replace(/\/$/, '')
  if (!r) return null
  if (f.startsWith(r + '/')) return f.slice(r.length + 1)
  return null
}

// Uncommitted paths this session did not write: another agent's or a person's work.
export function foreignChanges(currentPaths, writtenBySession) {
  const mine = new Set((writtenBySession || []).map(normPath))
  return [...new Set((currentPaths || []).map(normPath))].filter((p) => !mine.has(p))
}

// Known secret formats in the added lines of a diff.
export function secretPatternHits(diffText) {
  const pats = {
    'Stripe live key': /sk_live_[A-Za-z0-9]{8,}/g,
    'Stripe test key': /sk_test_[A-Za-z0-9]{8,}/g,
    'JWT': /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
    'GitHub token': /gh[pousr]_[A-Za-z0-9]{20,}/g,
    'OpenAI / Anthropic key': /sk-(ant-)?[A-Za-z0-9_-]{20,}/g,
    'Google API key': /AIza[0-9A-Za-z_-]{30,}/g,
    'AWS access key': /AKIA[0-9A-Z]{16}/g,
    'Private key block': /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  }
  const added = String(diffText || '')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .join('\n')
  const out = []
  for (const [name, re] of Object.entries(pats)) {
    const n = (added.match(re) || []).length
    if (n > 0) out.push(name + ' x' + n)
  }
  return out
}

// Inserted plus deleted lines from `git diff --shortstat`.
export function shortstatLines(s) {
  const ins = Number((String(s).match(/(\d+) insertion/) || [])[1] || 0)
  const del = Number((String(s).match(/(\d+) deletion/) || [])[1] || 0)
  return ins + del
}

// A diff that is much bigger than its content once line endings are ignored.
export function lineEndingChurn(plain, ignoringCr) {
  const a = shortstatLines(plain)
  const b = shortstatLines(ignoringCr)
  return a !== b ? { shown: a, real: b } : null
}
