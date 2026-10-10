# shared-repo-guard

**A Claude Code mod for repos where more than one AI agent works in the same folder.**

I run Claude Code and a second coding agent on one repository, often at the same time and under the same git name. Over two years that setup produced these incidents:

- An agent wrote a live API key straight into a shell command.
- An admin secret ended up in a URL query string and was copied into a work report.
- One agent cleaned up the working tree and deleted the other agent's uncommitted work. It could not be recovered.
- A script rewrote line endings, and a 29-line change became a 2,356-line diff.

Popular guard collections already block reading `.env` and force-pushing to `main`. They don't cover the incidents above, so this mod handles those.

## What it stops

| | What happens | Why |
|---|---|---|
| **Secret values** | Any shell command, file write, or tool call (browser, MCP and others) that contains the actual value of a secret from your `.env` is refused. If a value turns up in a command's output, it is masked before the model sees it. | Blocking the `.env` file isn't enough once the value has been copied somewhere else. |
| **Other agents' work** | `git reset --hard`, `checkout .`, `restore`, `stash` and `clean -f` are refused when the tree holds uncommitted files that this session did not write. It does not ask: in a desktop session in auto mode, a mod's question was seen to come back answered without any dialog, so a question cannot stand in for you. Run the command yourself in your own terminal when you mean it. `git add -A` (and the same thing written as `.`, `./`, `:/` or `*`) is refused in the same situation. | Another agent's half-finished work looks like junk to the agent that didn't write it. |
| **Public remotes** | Pushes to remotes you mark as public are refused, and so are `push --all` and `--mirror`. | A repo with a private `origin` and a public mirror is one typo away from publishing everything. |
| **Printing `.env`** | `cat .env` and similar commands are refused, and so is opening `.env` with the Read tool. `.env.example` is allowed. | |

**Commands**
- `/guard` shows how many secret values are watched, which remotes are marked public, what was stopped, and which uncommitted files are protected.
- `/preflight` runs before you push. It checks unpushed commits for line-ending churn, secret-looking strings (Stripe, OpenAI/Anthropic, GitHub, Google, AWS, private keys, JWTs), committed `.env` files, and files this session did not write.

While protected files exist, a quiet line above the prompt shows how many there are.

## Install

```
/plugin marketplace add naoanao/shared-repo-guard
/plugin install shared-repo-guard@shared-repo-guard
```

The install screen asks for two optional settings:
- **Public remotes**: remote names that must never be pushed to, for example `public, mirror`.
- **Extra .env files**: `.env` files below the repository root, for example `apps/web/.env.local`. Every `.env*` file at the root is watched automatically.

## How it works

- Secret values are read from your `.env` files when the session starts. They are kept in memory only and never written, logged, or shown. A key counts as a secret when its name contains SECRET, KEY, TOKEN, PASSWORD, PRIVATE, CREDENTIAL, WEBHOOK, SIGNING, AUTH, DSN or DATABASE_URL and its value is at least 12 characters long. Public build variables (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `EXPO_PUBLIC_`, `REACT_APP_`) are skipped.
- A file counts as "written by this session" when it was changed through Claude's Write or Edit tools. Every other uncommitted change is treated as someone else's. If this session changed a file through a shell command instead, you get a question rather than a silent loss.
- Options between `git` and its command (`git -C <dir>`, `-c key=value`, `--no-pager` and the like) are looked through, so `git -C other-repo add -A` is caught too.
- Commit messages are text, not commands, so words in them do not trigger a rule: the `-m "..."` of `git commit`, and a here-document given to `git commit` or written to a file. A message holding `$(...)` or backticks is still checked, because the shell runs those, unless the here-document tag is quoted (`<<'EOF'`), which keeps them as plain text.
- If the guard itself fails while checking a shell command, the command does not run.

## What it reads, runs, and sends

- **Sends nothing.** The mod makes no network requests and does not upload, log, or store anything. It has no telemetry.
- **Reads:**
  - `.env*` files in the repository root, plus any files you list under "Extra .env files". It reads them only to learn the secret values to watch for. The values stay in memory and are compared against what tools are about to run or return.
  - Each tool call's input and output (shell commands, file writes, and other tool arguments). It looks for those secret values there and masks them in output.
- **Runs:** only `git`, through its own read-only queries:
  - `git rev-parse --show-toplevel` to find the repository root
  - `git rev-parse --abbrev-ref --symbolic-full-name @{u}` to find the upstream branch
  - `git status --porcelain=v1 -z --untracked-files=all` to list uncommitted files
  - `git log <upstream>..HEAD`, plus `git diff` (with `--shortstat`, `--ignore-cr-at-eol --shortstat` and `--name-only` against the upstream) for `/preflight`

  None of these change your repository.
- **Changes:**
  - It refuses tool calls, using the rules above.
  - It replaces secret values in tool output with `[shared-repo-guard: secret hidden]`.
- **Hooks:**
  - `tool.call` on Bash, PowerShell, Read, Write, Edit and every other tool, for the checks above
  - `session.start` and `turn.complete` to refresh the list of uncommitted files
  - `ui.render` for the one-line notice above the prompt
  - `command.run` for `/guard` and `/preflight`

## How it differs from similar mods

- **blast-radius** (Anthropic sample) holds `rm -rf` and force pushes. This mod targets a different loss: uncommitted work that belongs to someone else.
- **secret-redactor** and **claude-code-redact** mask secrets in what the model reads. This mod also refuses commands, file writes and tool calls that would carry a secret value out.
- **Collision Guard** asks before another chat edits a file that was changed recently. This mod covers other agents and tools that never pass through Claude Code. It protects any uncommitted file this session did not write.

## Limits

- It only sees what passes through Claude Code. Other agents and your own terminal are not covered.
- Shell commands are parsed roughly: `;`, `&&`, `||` and new lines are split, but quoting is not. That way it errs toward stopping.
- It is not a secret scanner for your whole history. Use gitleaks or GitHub secret scanning for that.

## Tests

```
claude plugin test .
```

There are 15 tests. They cover the rules plus the whole mod running in Claude Code's test engine, with a fake git and a fake `.env`. Each guard was broken on purpose once to confirm that its test fails for the right reason.

## About

Made by nao, an AI consultant who builds. I design and run AI automation for small businesses, from first conversation to production. Portfolio: https://growl-ai.com/portfolio/en

Also by me: [agent-cross-check](https://github.com/naoanao/agent-cross-check). When another coding agent commits to your repo, Claude notices and audits the commits by diff and tests, not by the agent's report.

MIT License.

---

## 日本語

**同じフォルダで複数の AI に作業させている人のための、Claude Code の見張りです。**

止めるものは次のとおりです。

- **鍵の値**：`.env` にある鍵の値が、コマンド・ファイル・ほかの道具に入ろうとしたら止めます。コマンドの出力に鍵の値が出たときは、伏せ字にしてから AI に渡します。
- **別の AI の作業**：このセッションが書いていない保存前の変更があるとき、`git reset --hard` などの消すコマンドを止めます（聞きません。デスクトップの自動モードでは、Mod の質問が窓を出さずに答えつきで返ることがあったため）。本当に必要なら、ご自分の端末で打ってください。`git add -A`（`.`・`./`・`:/`・`*` と書いた場合も）も同じ状況では止めます。保存のメモの中の文字では止めません（`$(…)` を含むメモは確かめます）。
- **公開の送り先**：公開と指定した送り先への送信を止めます。
- **`.env` の表示**：`.env` の中身を画面に出すことを止めます。

入れ方は上の「Install」と同じです。`/guard` で今の見張りの状態を、`/preflight` で送る前の点検（改行の変化・鍵らしい文字・`.env` の混入・別の AI の作業）を見られます。
