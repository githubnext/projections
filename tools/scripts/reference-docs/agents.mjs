// ---------------------------------------------------------------------------------------------------------------
// Agent prompt files: markdown for coding agents (docs/agents/*.md), which the CLI bundles and prints with
// `projections help agents NAME`, and which the docs' "paste into your coding agent" prompts point at. Each is a setup
// page's text, or the guide the CLI prints with `projections help authoring` (the skill `projections init` writes),
// behind a brief for the agent.
import {readFile} from 'node:fs/promises'
import {join, posix} from 'node:path'
import {fail, header, projections, root, run} from './shared.mjs'

export const agentsDir = 'docs/agents'
/**
 * The repository's files on GitHub, where links for people (and the install prompt, for agents without the CLI) go.
 * The CLI's `DOCS_BASE` (packages/cli/src/docs.rs) and the VS Code extension's are the same; repoint all three together.
 */
const DOCS_BASE = 'https://github.com/githubnext/projections/blob/main/'

/** A markdown file's body for an agent: without its title and prompt blocks, links absolute (GitHub source). */
async function agentBody(file) {
  let text = await readFile(join(root, file), 'utf8')
  text = text.replace(/^# .*\n+/, '').replace(/^```prompt[^\n]*\n[\s\S]*?^```\n+/gm, '')
  return text.replace(/\]\((?![a-z][a-z0-9+.-]*:|#)([^)#\s]+)(#[^)\s]*)?\)/gi, (_, path, anchor = '') => {
    const target = posix.normalize(posix.join(posix.dirname(file), path))
    if (target.startsWith('..')) fail(`${file}: link ${path} leaves the repository`)
    return `](${DOCS_BASE}${target}${anchor})`
  })
}
/** Demotes every heading outside code by one level, so a guide nests under the brief's title. */
const demoteHeadings = text => {
  let fenced = false
  return text
    .split('\n')
    .map(line => {
      if (/^```/.test(line)) fenced = !fenced
      return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line
    })
    .join('\n')
}
const brief = (title, sources, summary, steps) =>
  `${header(sources)}# ${title}

${summary}

## Your task

${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}
`

export async function agents() {
  const install = `${DOCS_BASE}${agentsDir}/install.md`
  const authoring = run(projections(), ['help', 'authoring'])
  return {
    [`${agentsDir}/install.md`]: `${brief(
      'Install the Projections CLI',
      ['docs/setup/install.md'],
      'This file guides you, a coding agent, to install the Projections CLI on this machine for the person you are helping.',
      [
        'Check whether it is already installed: `projections --version`. If it prints a version, you are done.',
        'Download the release asset for this platform and verify it, as below. Never skip the verification.',
        'Put it on the PATH as `projections`, in a directory in the person’s home directory unless they ask otherwise.',
        'Verify: `projections --version` prints a version.',
      ],
    )}
${await agentBody('docs/setup/install.md')}`,
    [`${agentsDir}/explore.md`]: `${brief(
      'Explore Projections in this repository',
      ['docs/setup/quick-start.md'],
      'This file guides you, a coding agent, to find the projections that apply to this repository, try them on its recent pull requests, and help the person choose which to keep and add to CI. You work with the Projections tools or the `projections` CLI, and show the person the projections yourself in the Projections viewer, a page on this machine that you drive and they watch. Nothing is written until they choose.',
      [
        'Prefer the Projections tools when you have them: in VS Code’s agent the Projections extension offers them, and an MCP client gets them from `projections mcp` (an MCP server over standard input and output; add it as a stdio server run in this repository). They do each step below and answer in short text; writes preview first and write only once confirmed (over MCP, call again with the preview’s `confirm` token after the person agrees). Otherwise use the CLI commands below.',
        `Check the CLI: \`projections --version\`. If it is missing, install it by following ${install}.`,
        'Propose: the `explore` tool, or `projections explore --list --json`, lists the projections whose built-in extractors apply here, each with the files that suggested it.',
        'Sweep: the `sweep` tool, or `projections explore --sweep --json`, runs each one on the last 20 merges into this branch (`--last N` for more). Projections that run repository code are skipped unless you pass `--trust`; ask the person first.',
        'Report, per projection, the pull requests it changed on and how (for example `#12: 3 added, 1 removed`), which ones change on nearly every change (likely noise) or only on structural work, and the pull requests where several changed. To look at one yourself, draw it: `projections compare <before>..<after> -p <id> --png FILE` (a new file outside the repository).',
        'Ask the person which projections to keep. Never adopt or change CI on your own; a request to set projections up for them is their go-ahead to adopt the few the sweep shows are worth having, so you can show them. Say which you adopted and why.',
        'Adopt what they chose: `projections adopt <id>... --dry-run`, then `projections adopt <id>...`. If they want something no built-in projection shows, build it: run `projections help agents create-projection` and follow what it prints.',
        'Show them each adopted projection yourself: `projections view show -p <id> --choice bookmark:<bookmark>` (or the `open_projection` tool) shows it in the Projections viewer on a pull request it changed on (`projections bookmark list` lists the ones adopt saved) and prints the viewer’s URL. When the person asks to “open it in the inspector” or to “show” a projection, they mean this viewer.',
        'Open that page for them the first time: in your own browser if you have one (Codex’s, for example), else in the system browser by adding `--open`. Give them the bare link only when you can open neither. Later `projections view show` calls change what the open page shows; to show several projections side by side, give each its own page with `--viewer <name>` (the `viewer` input), and open each. ' +
          'In the GitHub Copilot app, use the Projections canvas instead of a browser tab: run `projections canvas install` once, then open the `projections` canvas, which shows the same viewer in the app’s theme (one canvas per viewer name).',
        'Talk them through what each one shows, and remove the definitions of any they don’t want. People who use VS Code can also look in the Projections extension (**Projections: Explore Repository**, from Step 1 of the quick start below).',
        'When they are happy, offer to add Projections to their CI: run `projections help agents ci` and follow what it prints. Commit only if they ask.',
      ],
    )}
${await agentBody('docs/setup/quick-start.md')}`,
    [`${agentsDir}/create-projection.md`]: `${brief(
      'Create a projection',
      ['projections help authoring (packages/cli/templates/SKILL.md)'],
      'This file guides you, a coding agent, to build a Projections projection for this repository: an extractor that reads the system the person described, presented by a renderer that fits it. The person’s request says what the projection should show.',
      [
        `Check the CLI: \`projections --version\`. If it is missing, install it by following ${install}.`,
        'Scaffold: `projections init <id>`, with a short ID for what the person wants to see (for example `service-map`). It writes the definition, a starter extractor in this project’s toolchain and the projections skill (in `.agents/skills/`, or the skills directory it prints), which holds the guide below. If you are Claude Code, or the person uses it, add `--claude` so Claude Code finds the skill too.',
        'Build the extractor, and a custom renderer only if no built-in one fits, following the guide below.',
        'Verify: `projections check -p <id> --trust` (or the `check` tool) passes. Fix everything it reports; don’t weaken the projection to make it pass.',
        'Show it to the person yourself, then discuss it: open it in the Projections viewer on a change where it says something (`projections view show -p <id> --before <before> --after <after>`, or the `open_projection` tool), in your own browser if you have one or the system browser (`--open`) otherwise, as “Show the person” below says. Tell them what it shows. Commit only if they ask.',
      ],
    )}
${demoteHeadings(authoring.trim())}
`,
    [`${agentsDir}/ci.md`]: `${brief(
      'Add Projections to CI',
      ['docs/setup/ci.md'],
      'This file guides you, a coding agent, to add the Projections GitHub Action to this repository’s CI, so every pull request and push summarizes how its projections changed and uploads them as an artifact. Where the step belongs depends on the repository’s CI, so no command writes it: you read the workflows, reason about where it fits, and propose the change for the person to approve.',
      [
        'Check that the repository defines at least one projection: `projections list`. If it defines none, say so and stop: they are adopted with `projections explore` and `projections adopt`, or built with `projections init`. Note which projections it says run repository code (they need `trust: true`), and run `projections doctor` for the toolchains and prepare steps their extractors use.',
        'Read every workflow in `.github/workflows/`: its triggers, default branch, runners, matrices, permissions, path filters, and each job’s setup, install and build steps. If one already runs `githubnext/projections`, say so and stop.',
        'Decide where the step belongs, as “Where it goes” below explains. The default is a step in the job that already sets up the toolchains and installs the dependencies (in a repository with one build, test and lint workflow, that job), after its install and build steps, so nothing is installed twice.',
        'Propose a workflow of its own only when no job sets up what the extractors need, every projection only reads files, or the job can’t take the step.',
        'Adapt the step to that job: change its checkout to `fetch-depth: 0` and `persist-credentials: false`; guard the step with `if:` when the workflow runs on events other than `pull_request` and `push`; run it in one matrix entry only; add `working-directory` for a project in a subdirectory.',
        'Add `trust: true` only for projections that need it, in a job with read-only permissions and no secrets. Check what the checkout change affects, such as a later step that pushes with the checkout’s credentials, and pick the narrowest fix.',
        'Show the person the diff and why you chose that place over the alternatives, including what it costs (a full-history checkout, a step before or after the tests) and what a pull request installs (below). Write it only once they agree; never change CI on your own.',
        'Commit only if they ask. After the change is merged, the default branch’s next push run produces the artifact that pull requests reuse for their merge base.',
      ],
    )}
${await agentBody('docs/setup/ci.md')}`,
  }
}
