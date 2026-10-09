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
| **Other agents' work** | `git reset --hard`, `checkout .`, `restore`, `stash` and `clean -f` ask you first when the tree holds uncommitted files that this session did not write. They are refused when nobody is there to answer. `git add -A` is refused in the same situation. | Another agent's half-finished work looks like junk to the agent that didn't write it. |
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
- If the guard itself fails while checking a shell command, the command does not run.

## Limits

- It only sees what passes through Claude Code. Other agents and your own terminal are not covered.
- Shell commands are parsed roughly: `;`, `&&`, `||` and new lines are split, but quoting is not. That way it errs toward stopping.
- It is not a secret scanner for your whole history. Use gitleaks or GitHub secret scanning for that.

## Tests

```
claude plugin test .
```

There are 12 tests. They cover the rules plus the whole mod running in Claude Code's test engine, with a fake git and a fake `.env`. Each guard was broken on purpose once to confirm that its test fails for the right reason.

## About

Made by nao, an AI consultant who builds. I design and run AI automation for small businesses, from first conversation to production. Portfolio: https://growl-ai.com/portfolio/en

MIT License.

---

## 日本語

**同じフォルダで複数の AI に作業させている人のための、Claude Code の見張りです。**

止めるものは次のとおりです。

- **鍵の値**：`.env` にある鍵の値が、コマンド・ファイル・ほかの道具に入ろうとしたら止めます。コマンドの出力に鍵の値が出たときは、伏せ字にしてから AI に渡します。
- **別の AI の作業**：このセッションが書いていない保存前の変更があるとき、`git reset --hard` などの消すコマンドは、実行する前にあなたに確かめます。答える人がいなければ止めます。`git add -A` も同じ状況では止めます。
- **公開の送り先**：公開と指定した送り先への送信を止めます。
- **`.env` の表示**：`.env` の中身を画面に出すことを止めます。

入れ方は上の「Install」と同じです。`/guard` で今の見張りの状態を、`/preflight` で送る前の点検（改行の変化・鍵らしい文字・`.env` の混入・別の AI の作業）を見られます。
