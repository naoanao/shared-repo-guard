import { expect, test } from 'claude-code/testing'
import {
  parseList, pushToPublic, addAll, destructiveGit, printsEnvFile, readsEnvFile, secretValuesFrom,
  containsSecret, redact, statusPaths, relativeToRoot, foreignChanges, secretPatternHits, lineEndingChurn,
} from '../hooks/rules.js'

test('push to a public remote is stopped, the private one passes', async () => {
  const pub = parseList('public, mirror')
  expect(pushToPublic('git push public main', pub)).toBeTruthy()
  expect(pushToPublic('cd x && git push -u mirror HEAD:main', pub)).toBeTruthy()
  expect(pushToPublic('git push --all origin', pub)).toBeTruthy()
  expect(pushToPublic('git push origin main', pub)).toBe(null)
  expect(pushToPublic('git push origin feature/public-api', pub)).toBe(null)
  expect(pushToPublic('git log --grep public', pub)).toBe(null)
  expect(pushToPublic('git push public main', [])).toBe(null)
  expect(pushToPublic('git push "public" main', pub)).toBeTruthy()
  expect(pushToPublic("git push 'mirror' HEAD", pub)).toBeTruthy()
  expect(pushToPublic('git commit -m "push to public"', pub)).toBe(null)
})

test('git add -A is recognised, adding files by name is not', async () => {
  expect(addAll('git add -A')).toBeTruthy()
  expect(addAll('git add --all')).toBeTruthy()
  expect(addAll('git add .')).toBeTruthy()
  expect(addAll('git add ./')).toBeTruthy()
  expect(addAll('git add :/')).toBeTruthy()
  expect(addAll('git add *')).toBeTruthy()
  expect(addAll('git add "."')).toBeTruthy()
  expect(addAll('git add ./src/a.ts')).toBe(null)
  expect(addAll('git add src/a.ts docs/b.md')).toBe(null)
  expect(addAll('git add .github/workflows/ci.yml')).toBe(null)
})

test('commands that discard uncommitted work are recognised', async () => {
  expect(destructiveGit('git reset --hard HEAD')).toBeTruthy()
  expect(destructiveGit('git checkout -- a.md')).toBeTruthy()
  expect(destructiveGit('git checkout .')).toBeTruthy()
  expect(destructiveGit('git restore a.md')).toBeTruthy()
  expect(destructiveGit('git stash')).toBeTruthy()
  expect(destructiveGit('git clean -fd')).toBeTruthy()
  expect(destructiveGit('git restore --staged a.md')).toBe(null)
  expect(destructiveGit('git reset HEAD a.md')).toBe(null)
  expect(destructiveGit('git stash list')).toBe(null)
  expect(destructiveGit('git checkout main')).toBe(null)
})

test('printing or reading .env is stopped, the example file passes', async () => {
  expect(printsEnvFile('cat apps/web/.env.local')).toBeTruthy()
  expect(printsEnvFile('Get-Content .env')).toBeTruthy()
  expect(printsEnvFile('cat README.md')).toBe(null)
  expect(readsEnvFile('/repo/.env')).toBeTruthy()
  expect(readsEnvFile('C:\\repo\\.env.production')).toBeTruthy()
  expect(readsEnvFile('/repo/.env.example')).toBe(null)
  expect(readsEnvFile('/repo/environment.ts')).toBe(null)
})

test('secret values are taken from .env, public and short values are not', async () => {
  const env = [
    '# comment',
    'STRIPE_SECRET_KEY="' + 'sk_' + 'test_abcdefghijklmnop' + '"',
    'export GITHUB_TOKEN=ghp_1234567890abcdefghij',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJpublicpublicpublic',
    'VITE_API_KEY=publicpublicpublic',
    'PORT=3000',
    'API_KEY=short',
    'APP_NAME=a-long-but-harmless-value',
  ].join('\n')
  const s = secretValuesFrom(env)
  expect(s).toEqual(['sk_' + 'test_abcdefghijklmnop', 'ghp_1234567890abcdefghij'])
  expect(containsSecret('curl -H "Authorization: ghp_1234567890abcdefghij"', s)).toBe(true)
  expect(containsSecret('curl -H "Authorization: $GITHUB_TOKEN"', s)).toBe(false)
  expect(redact({ text: 'key=' + 'sk_' + 'test_abcdefghijklmnop' }, s)).toEqual({ text: 'key=[shared-repo-guard: secret hidden]' })
})

test('uncommitted files this session did not write are foreign', async () => {
  const z = ' M src/app.ts\0?? notes/new.md\0R  src/new-name.ts\0src/old-name.ts\0 M src/mine.ts\0'
  const paths = statusPaths(z)
  expect(paths).toEqual(['src/app.ts', 'notes/new.md', 'src/new-name.ts', 'src/old-name.ts', 'src/mine.ts'])
  const mine = [relativeToRoot('C:\\Work\\Repo\\src\\mine.ts', 'C:/Work/Repo')]
  expect(mine).toEqual(['src/mine.ts'])
  expect(foreignChanges(paths, mine)).toEqual(['src/app.ts', 'notes/new.md', 'src/new-name.ts', 'src/old-name.ts'])
  expect(foreignChanges([' src/mine.ts'.trim()], mine)).toEqual([])
  expect(relativeToRoot('/elsewhere/a.ts', '/repo')).toBe(null)
  expect(relativeToRoot('/repo-other/a.ts', '/repo')).toBe(null)
})

test('known secret formats in added diff lines, and line-ending churn', async () => {
  const diff = '+++ b/a.ts\n+const k = "' + 'sk_' + 'live_abcdefgh12345678' + '"\n-const old = "' + 'sk_' + 'live_abcdefgh12345678' + '"\n context'
  expect(secretPatternHits(diff)).toEqual(['Stripe live key x1'])
  expect(secretPatternHits('+const x = 1')).toEqual([])
  expect(lineEndingChurn(' 1 file changed, 2356 insertions(+), 2356 deletions(-)', ' 1 file changed, 29 insertions(+), 3 deletions(-)')).toEqual({ shown: 4712, real: 32 })
  expect(lineEndingChurn(' 1 file changed, 29 insertions(+)', ' 1 file changed, 29 insertions(+)')).toBe(null)
})
