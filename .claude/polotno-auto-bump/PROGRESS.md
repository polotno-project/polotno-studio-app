# Auto-bump polotno + @polotno/*

- [x] .github/dependabot.yml: daily npm check, only polotno and @polotno/*, one grouped PR, `versioning-strategy: increase` (0.x caret ranges never reach new minors), no cooldown for these packages
- [x] Checked: build.yml runs on Dependabot PRs; VITE_POLOTNO_KEY is an Actions secret (not exposed to Dependabot runs) but polotno-key.ts has a fallback, so the build still passes
- [ ] After merge to master: confirm in Insights → Dependency graph → Dependabot that the config is picked up and the first grouped PR opens (polotno 4.16.1→4.17.0, pdf-export 0.13→0.15, pdf-import 0.9→0.12, schema 0.7→0.9, video-export 0.4→0.5)
- [x] 2026-10-22 Repo: "Allow auto-merge" on; ruleset 25631988 "master: require Build" (build (macos-14) / (ubuntu-latest) / (windows-latest) required, repo admins bypass)
- [x] .github/workflows/dependabot-auto-merge.yml (fetch-metadata@v3, `gh pr merge --auto --squash` when dependency-group == polotno and update-type — the highest in the group — is not semver-major)

## Patch release after an auto-merged bump (2026-10-26)

Decisions: release is a draft (publishing stays manual); release even if master has other unreleased commits.

- [x] scripts/polotno-patch-release.mjs (+ test): compares Polotno deps with tag v<version>, writes CHANGELOG entry, prints next patch version (empty = skip). Dry-run on origin/master: no change → skip; simulated bump → 0.3.1, CHANGELOG + package.json + lockfile updated
- [x] .github/workflows/polotno-release.yml: workflow_run on Build (Dependabot polotno group PR) → waits for the auto-merge → bump commit + tag pushed to master → calls release.yml (now also workflow_call with `ref`) with secrets: inherit
- [ ] Ruleset 25631988: add GitHub Actions (Integration 15368) to bypass_actors so the release commit can be pushed to master — blocked for the agent, user to run
- [ ] After merge: first real run — check the group branch really starts with dependabot/npm_and_yarn/polotno-, the workflow_run run gets Actions secrets, and the draft release has all installers
