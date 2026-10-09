import { expect, test } from 'claude-code/testing'

const SECRET = 'sk_' + 'test_abcdefghijklmnop'

// A fake repository: git answers from `status`, the root holds one .env with one secret.
function fakeRepo(on, status: string) {
  const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } })
  on('process.run', async ($, e) => {
    const a = e.argv.join(' ')
    if (a.includes('rev-parse --show-toplevel')) return out('/repo\n')
    if (a.includes('status --porcelain')) return out(status)
    return out('')
  })
  on('fs.list', async () => ({ value: [{ name: '.env', kind: 'file' }, { name: 'src', kind: 'dir' }] }))
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: 'STRIPE_SECRET_KEY=' + SECRET + '\n' }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
}

// The engine's own tool: records what really ran. AskUserQuestion is dismissed (nobody answers).
function fakeTools(on, ran: string[]) {
  on('tool.call', async ($, e) => {
    if (e.tool === 'AskUserQuestion') return { deny: 'dismissed' }
    ran.push(e.tool + ': ' + String(e.command || e.file_path || ''))
    return { result: { stdout: 'printed ' + SECRET }, text: 'printed ' + SECRET }
  })
}

async function start($) {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
}

test('git reset --hard is stopped while another agent has uncommitted work', async ($, on) => {
  const ran: string[] = []
  fakeRepo(on, ' M src/theirs.ts\0')
  fakeTools(on, ran)
  await start($)
  const r = await $.tool.call({ tool: 'Bash', command: 'git reset --hard HEAD' })
  expect(ran).toEqual([])
  expect(String(r.text || r.deny)).toContain('git reset --hard')
})

test('git reset --hard passes when every change was written by this session', async ($, on) => {
  const ran: string[] = []
  fakeRepo(on, '')
  fakeTools(on, ran)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git reset --hard HEAD' })
  expect(ran).toEqual(['Bash: git reset --hard HEAD'])
})

test('git add -A is stopped only when it would sweep in foreign files', async ($, on) => {
  const ran: string[] = []
  fakeRepo(on, '?? notes/theirs.md\0')
  fakeTools(on, ran)
  await start($)
  const r = await $.tool.call({ tool: 'Bash', command: 'git add -A' })
  expect(ran).toEqual([])
  expect(String(r.text || r.deny)).toContain('notes/theirs.md')
  await $.tool.call({ tool: 'Bash', command: 'git add src/mine.ts' })
  expect(ran).toEqual(['Bash: git add src/mine.ts'])
})

test('a secret value from .env is stopped in commands and files, and hidden in output', async ($, on) => {
  const ran: string[] = []
  fakeRepo(on, '')
  fakeTools(on, ran)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer ' + SECRET + '" https://api.example.com' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/notes.md', content: 'key: ' + SECRET })
  expect(ran).toEqual([])
  const out = await $.tool.call({ tool: 'Bash', command: 'node print-config.js' })
  expect(ran).toEqual(['Bash: node print-config.js'])
  expect(String(out.text)).not.toContain(SECRET)
  expect(String(out.text)).toContain('secret hidden')
})

test('push to a remote marked public is stopped', { options: { publicRemotes: 'public' } }, async ($, on) => {
  const ran: string[] = []
  fakeRepo(on, '')
  fakeTools(on, ran)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git push public main' })
  expect(ran).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(ran).toEqual(['Bash: git push origin main'])
})
