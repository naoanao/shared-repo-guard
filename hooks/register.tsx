import {
  parseList, pushToPublic, addAll, destructiveGit, printsEnvFile, readsEnvFile,
  secretValuesFrom, containsSecret, redact, statusPaths, relativeToRoot, foreignChanges,
  secretPatternHits, lineEndingChurn,
} from './rules.js'

// Held only inside this module. Never written to the screen, a log or a file.
let secrets = []
let blocked = 0
let root = ''
let written = []
let foreign = []
let publicRemotes = []
let extraEnvFiles = []

async function git($, args) {
  try {
    const r = await $.process.run(['git', ...args], { cwd: root || undefined, timeoutMs: 20000 })
    return r.exitCode === 0 ? String(r.stdout || '') : ''
  } catch {
    return ''
  }
}

async function findRoot($) {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 10000 })
    root = r.exitCode === 0 ? String(r.stdout || '').trim() : ''
  } catch {
    root = ''
  }
}

async function loadSecrets($) {
  const found = new Set()
  const base = root || (await $.session.cwd())
  const files = new Set(extraEnvFiles.map((f) => base + '/' + f))
  try {
    for (const entry of await $.fs.list(base)) {
      const n = String(entry?.name || '')
      if (/^\.env(\.|$)/.test(n) && !/\.(example|sample|template)$/.test(n)) files.add(base + '/' + n)
    }
  } catch {
    // an unreadable folder adds nothing
  }
  for (const f of files) {
    try {
      if (!(await $.fs.exists(f))) continue
      for (const v of secretValuesFrom(await $.fs.read(f))) found.add(v)
    } catch {
      // an unreadable file is skipped
    }
  }
  secrets = [...found]
}

async function refreshForeign($) {
  if (!root) {
    foreign = []
    return
  }
  foreign = foreignChanges(statusPaths(await git($, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])), written)
  $.ui.invalidate('ui.render')
}

function listFew(paths) {
  const head = paths.slice(0, 10).join('\n  ')
  return '  ' + head + (paths.length > 10 ? '\n  ...and ' + (paths.length - 10) + ' more' : '')
}

function deny($, reason) {
  blocked += 1
  $.ui.toast('shared-repo-guard stopped: ' + reason.split('.')[0])
  return { deny: 'shared-repo-guard: ' + reason }
}

async function preflight($) {
  if (!root) return 'Not inside a git repository.'
  const out = []
  const upstream = (await git($, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim()
  if (!upstream) {
    out.push('No upstream branch, so there is nothing to compare against.')
  } else {
    const log = (await git($, ['log', upstream + '..HEAD', '--format=%h %ad %an %s', '--date=short'])).trim()
    out.push('Unpushed commits on top of ' + upstream + ': ' + (log ? log.split('\n').length : 0))
    if (log) {
      out.push(log)
      const churn = lineEndingChurn(
        await git($, ['diff', '--shortstat', upstream, 'HEAD']),
        await git($, ['diff', '--ignore-cr-at-eol', '--shortstat', upstream, 'HEAD']),
      )
      out.push('Line endings: ' + (churn ? 'CHANGED (diff shows ' + churn.shown + ' lines, real content ' + churn.real + ')' : 'unchanged'))
      const hits = secretPatternHits(await git($, ['diff', upstream, 'HEAD']))
      out.push('Secret-looking strings: ' + (hits.length ? hits.join(', ') : 'none'))
      const files = (await git($, ['diff', '--name-only', upstream, 'HEAD'])).trim()
      const envs = files.split('\n').filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.(example|sample|template)$/.test(f))
      if (envs.length) out.push('.env files in the commits: ' + envs.join(', '))
    }
  }
  await refreshForeign($)
  out.push('Uncommitted files this session did not write: ' + foreign.length + (foreign.length ? '\n' + listFew(foreign) : ''))
  return out.join('\n')
}

export function register(on, options) {
  publicRemotes = parseList(options?.publicRemotes)
  extraEnvFiles = parseList(options?.envFiles)

  on('session.start', async ($, e, next) => {
    await findRoot($)
    await loadSecrets($)
    await $.command.register({ name: 'guard', description: 'shared-repo-guard: what it watches and what it stopped' })
    await $.command.register({ name: 'preflight', description: 'Check unpushed commits: line endings, secrets, .env files, other agents\' changes' })
    await refreshForeign($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refreshForeign($)
    return next(e)
  })

  on('command.run', { command: 'guard' }, async ($) => {
    await loadSecrets($)
    await refreshForeign($)
    return {
      text: [
        'Secret values watched: ' + secrets.length,
        'Public remotes: ' + (publicRemotes.length ? publicRemotes.join(', ') : 'none set'),
        'Stopped this session: ' + blocked,
        'Uncommitted files this session did not write (protected): ' + foreign.length + (foreign.length ? '\n' + listFew(foreign) : ''),
      ].join('\n'),
    }
  })

  on('command.run', { command: 'preflight' }, async ($) => ({ text: await preflight($) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || foreign.length === 0) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>shared-repo-guard: {foreign.length} uncommitted file(s) from outside this session are protected (/guard)</Text>
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const cmd = String(e.command || '')
    const r = pushToPublic(cmd, publicRemotes) || printsEnvFile(cmd)
    if (r) return deny($, r)
    if (containsSecret(cmd, secrets)) return deny($, 'The command contains a secret value from your .env. Read it from the environment instead of writing it out.')
    if (addAll(cmd)) {
      await refreshForeign($)
      if (foreign.length) return deny($, 'git add -A would stage ' + foreign.length + ' file(s) this session did not write. Add your own files by name.\n' + listFew(foreign))
    }
    const d = destructiveGit(cmd)
    if (d) {
      await refreshForeign($)
      // Refused without asking: in a desktop session in auto mode, $.ui.ask was seen to return an answer
      // without showing any dialog (measured 2026-10-10), so a question cannot stand in for the user.
      if (foreign.length) {
        return deny($, d + ' was stopped because it would discard uncommitted work this session did not write (' + foreign.length + ' file(s)). Leave those files alone, or run the command yourself in your own terminal.\n' + listFew(foreign))
      }
    }
    return redact(await next(e), secrets)
  }).catch(async () => ({ deny: 'shared-repo-guard could not check this command, so it did not run.' }))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const r = readsEnvFile(e.file_path)
    if (r) return deny($, r)
    return redact(await next(e), secrets)
  })

  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const text = String(e.content || '') + '\n' + String(e.new_string || '')
    if (containsSecret(text, secrets)) return deny($, 'This writes a secret value into a file. Refer to the variable name instead.')
    const result = await next(e)
    const rel = relativeToRoot(String(e.file_path || ''), root)
    if (rel && !written.includes(rel)) written.push(rel)
    return result
  })

  on('tool.call', { tool: /^(?!(Bash|PowerShell|Read|Write|Edit)$)/ }, async ($, e, next) => {
    let text = ''
    try { text = JSON.stringify(e) } catch { text = '' }
    if (containsSecret(text, secrets)) return deny($, 'This passes a secret value to ' + e.tool + '.')
    return next(e)
  })
}
