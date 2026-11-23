# Deploying the web demo to dofile.dev

The web demo is two Cloudflare Workers that serve static files only:

| Address | Worker | Folder | Wrangler config |
|---|---|---|---|
| `https://dofile.dev/` | `dofile` | `web/dist/site/` (the landing page, `/commands/`) | `web/wrangler.jsonc` |
| `https://app.dofile.dev/` | `dofile-app` | `web/dist/app/` (the editor, cross-origin isolated on every path) | `web/wrangler.app.jsonc` |

The workflows:
- **Production:** a push to `main` starts `deploy.yml`. It runs ci, web and lint on that commit (`workflow_call`), and it
  deploys both Workers only if all three pass and the commit is still the tip of `main`.
- **Pull requests:** `preview.yml` uploads a preview version of both Workers for each pull request from a branch of this
  repository. Forks get no preview. Production does not change.

This file covers the one-time setup, the order it has to happen in, and what to check on the first real deploy. How the
two builds link to each other is in `docs/design/SPEC.md`, section 8, "URLs". Prices and policies were checked on
2026-11-13. Check the price again at checkout.

## Every workflow at a glance

All in `.github/workflows/`. The required checks are the branch ruleset's; on `main`, called from `deploy.yml`, the same
checks are named `ci / ci ok`, `web / web ok` and `lint / lint ok`. Each gate also lists the jobs of its run (`gh api`, `actions: read`) and fails unless every one, bar the gates, is `success` or `skipped`: a matrix leg GitHub never ran counts as success in `needs`.

| Workflow | Trigger | What it runs | Required check | Secrets, variables |
|---|---|---|---|---|
| `ci.yml` | pull request; called by `deploy.yml`; by hand | ruff (`poe lint`); `poe ci` on Ubuntu × Python 3.12, 3.13, 3.14 and macOS × 3.14 (a pull request: 3.14 only on both; macOS runners are scarce). A pull request that touches none of its files skips the jobs | `ci ok` | none |
| `web.yml` | pull request; called by `deploy.yml`; by hand | `npm run check`, the `commands.json` diff, `npm test`, a production build; Biome strict; e2e, one job per Playwright project (4); the memory snapshot and `check-snapshot`. Same skipping | `web ok` | none |
| `lint.yml` | pull request; called by `deploy.yml`; by hand | actionlint and shellcheck, when `.github/workflows/`, `.github/actions/` or `.github/scripts/` changed (always on `main`) | `lint ok` | none |
| `deploy.yml` | push to `main`; by hand (deploys only on `main`) | the three above, then, if all passed and the commit is still the tip of `main`, `build-web`, `wrangler deploy` of both Workers and `scripts/smoke.ts` | none | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; `github.token` (tip check) |
| `preview.yml` | pull request that changes `web/`, `src/`, `pyproject.toml`, `uv.lock`, `build-web` or itself; not forks or Dependabot | `build-web` with the preview addresses, `wrangler versions upload --preview-alias pr-<N>` of both Workers, `scripts/smoke.ts`, one comment with the addresses ([section 4](#4-pull-request-previews)) | none (does not wait for the tests) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; variable `CLOUDFLARE_WORKERS_SUBDOMAIN`; `github.token` (`pull-requests: write`, comment job only) |
| `windows.yml` | push to `main`; by hand | `poe test` on Windows × Python 3.14. Not called by `deploy.yml`: a red run blocks neither a merge nor a deploy | none | none |
| `release.yml` | push of a tag `v*` | `test` (`poe test` on Ubuntu and macOS × Python 3.12, 3.13, 3.14; Windows is commented out until `windows.yml` passes), then `build`: tag on `main` and equal to `pyproject.toml`'s version, `poe test`, `uv build`, `twine check`, the wheel's smoke test, then `uv publish` ([`docs/releasing.md`](releasing.md)) | none | no secret: PyPI Trusted Publishing (OIDC), environment `pypi` |
| Dependabot (`.github/dependabot.yml`) | weekly | update pull requests for the GitHub Actions in the workflows and in `.github/actions/*` | (its pull requests run the checks above) | none |

`build-web` is the composite action `.github/actions/build-web` (the wheel, the snapshot at quality 11, both builds, the
size check); the tip check is `.github/scripts/is-main-tip.sh`. Why: [How the workflows work](#how-the-workflows-work).

**Merge method.** A pull request that holds a reformat commit named in `.git-blame-ignore-revs` is merged with a merge
commit: a rebase or squash changes the commit's hash, and the ignore file would name a commit `main` does not have. Any
merge method works otherwise.

## 1. Buy the domain

**Use Cloudflare Registrar.** The domain, its DNS zone and the Workers then all sit in one account.

| Registrar | .dev first year | .dev renewal | WHOIS privacy |
|---|---|---|---|
| Cloudflare | about $8.20 | about $12.20 (at cost: the registry's and ICANN's fee, no markup) | free, on by default (redaction) |
| Porkbun | about $8.75 (promo) | $12.87 | free; not verified whether it is on by default or what public RDAP shows |
| Spaceship | $6.44 with a one-per-customer promo code | about $12.62 | not verified |
| Namecheap | about $10.98 | $20.98 | free; not verified whether it is on by default or how it hides the data |

- **Compare renewal prices, not first-year prices.** Over five years Cloudflare costs about $57, Porkbun about $60 and
  Namecheap about $95. Spaceship's first-year saving (about $2) is less than the bother of moving the domain to Cloudflare
  later.
- **Cloudflare's one condition: the domain must use Cloudflare's nameservers.** That costs nothing here, because the Workers'
  custom domains need the zone on Cloudflare anyway.

**Steps, in the Cloudflare dashboard:**
1. Log in to the account that already holds the `dofile` Worker, the one the repository secret `CLOUDFLARE_ACCOUNT_ID`
   names.
2. Go to Domain Registration > Register Domains, search for `dofile.dev`, and add it.
3. Fill in the registrant contact. It must be accurate: a domain with false contact details can be suspended.
   - **Leave Organization blank.** If an organization is filled in, it becomes the domain's legal holder and its name is
     published.
   - The contact must be in plain ASCII.
4. Turn on auto-renew, then pay.
5. Cloudflare creates the `dofile.dev` zone on its own nameservers. Wait until the zone shows **Active**.

**What stays private.**
- Since August 2025, ICANN's Registration Data Policy has required registrars to keep a person's personal data out of
  public WHOIS and RDAP.
- Cloudflare shows "Data Redacted" in place of your name, email, phone and street address.
- What stays public: your **state or province and country**, the nameservers and the dates.
- Cloudflare redacts the data itself: no proxy company's details stand in for yours.
- Someone with a legitimate reason, such as law enforcement or a trademark holder, can request the redacted data through
  ICANN's Registration Data Request Service (RDRS), or with a court order.
- To see what the public sees once you have bought it, run `whois dofile.dev`, or look it up at
  https://lookup.icann.org/.

**.dev is HTTPS only.** The whole `.dev` TLD is on the browsers' HSTS preload list, so browsers never load
`http://dofile.dev`, and you cannot opt out. Workers custom domains get their certificates automatically. Allow a few
minutes after the first deploy for the certificates to be issued.

**Transfers.** ICANN locks a domain against moving to another registrar for 60 days after a change of registrant, and,
under the usual transfer rules, after registration too (Cloudflare's FAQ states the first case; the second is not checked
here). This only matters if you move the domain away later.

## 2. Cloudflare and GitHub setup

Do these once, after the zone is Active and before merging the pull request that brings this setup to `main`.

1. **The API token** (Cloudflare dashboard, My Profile > API Tokens).
   - Edit the token behind `CLOUDFLARE_API_TOKEN`, or make a new one from the template "Edit Cloudflare Workers".
   - The template already holds Zone: Workers Routes Write, but the token only reaches zones listed under **Zone
     Resources**. Add the `dofile.dev` zone, or "All zones from an account" for this account.
   - The same token serves both production and previews.
   - Not verified: if the first deploy fails with an authentication error on the custom domain, also add Zone: Zone Read
     and Zone: DNS Edit.
2. **Repository secrets** (Settings > Secrets and variables > Actions > Secrets). `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` are there already; replace the token if you made a new one.
3. **A repository variable**, on the Variables tab of the same page: `CLOUDFLARE_WORKERS_SUBDOMAIN`.
   - Its value is the account's workers.dev subdomain: just the label, the `<label>` in
     `<worker>.<label>.workers.dev`.
   - It is shown in the dashboard under Workers & Pages, or from `GET /accounts/{account_id}/workers/subdomain`.
   - `preview.yml` fails with an error that names this variable when it is missing.
4. **The branch ruleset stays as it is.** The required checks are still "ci ok", "web ok" and "lint ok".
   - Do not require anything from `preview.yml`: it is skipped for forks and for pull requests that change no build input,
     and a required check that never reports blocks a merge.

## 3. The order of the first deploy

**Step 1. Buy the domain and finish section 2 first.** Merging before the zone is Active breaks production: both
Wrangler configs carry `routes` with `custom_domain: true`, so `wrangler deploy` on `main` fails for a zone the account does
not have. The exact error is not verified, so plan on a failure, not a skip.

**Step 2. Open the pull request** from `deploy/dofile-dev` (`git push -u origin deploy/dofile-dev`, then `gh pr create`).
CI runs as usual. The pull request also runs `preview.yml` for the first time:
- **The editor's preview fails.** `dofile-app` does not exist yet, and wrangler refuses `versions upload` for a Worker
  that was never deployed (the reviewer read this in wrangler's source; not seen on Cloudflare).
- **That failure does not block the merge,** because the preview is not a required check. Run the preview again after
  step 3.
- **The site's preview should work.** `dofile` already exists.

**Step 3. Merge.** Any merge method works, since the branch holds no reformat commit. `deploy.yml` then runs, in this
order:
1. The three test suites.
2. A check that the commit is still the tip of `main`.
3. The two builds (`DOFILE_URLS=production`).
4. A size check over both folders.
5. The tip check again, then `wrangler deploy` of the editor's Worker, then the site's.
6. A smoke check of both domains (`web/scripts/smoke.ts`, retrying for up to 10 minutes).

On the first deploy, Cloudflare creates the DNS records and certificates for both domains itself. If the certificates take
longer than the smoke check waits, the run goes red although the deploy went through: check the two addresses by hand
(`cd web && node scripts/smoke.ts`).

**Step 4. Check the deploy**, as in section 5.

**Step 5. Re-run the pull request's preview job if it failed,** or check the next pull request's preview, as in section 4.

**A manual deploy** (Actions > deploy > Run workflow) runs the tests too, so no route puts an untested commit into
production. If only the deploy job failed, for example on a Cloudflare hiccup, "Re-run failed jobs" retries the deploy
alone, and the tip-of-main check runs again first (see "How the workflows work" for when not to).

**Deploying from your own computer** (`cd web && npm run deploy`) still works: it runs a strict lint, builds both folders
for production (`DOFILE_URLS=production`), runs the size check and deploys both Workers. It runs no tests. It needs `wrangler login`, or `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the environment. Use it only when the workflow cannot run.

## 4. Pull request previews

Every pull request from a branch of this repository that changes a build input (`web/`, `src/`, `pyproject.toml`,
`uv.lock`, the build action, or `preview.yml` itself) gets two addresses, posted in one comment that each push updates:

- the editor: `https://pr-<N>-dofile-app.<subdomain>.workers.dev/`
- the landing page: `https://pr-<N>-dofile.<subdomain>.workers.dev/`

The two link to each other, not to production: the build bakes both preview addresses in.

- **Forks and Dependabot get no preview,** because their runs get no secrets. The workflow uses `pull_request`, never
  `pull_request_target`, so code from a fork never runs with the token.
- **Previews do not wait for the tests.** They exist for looking at a change.
- **Previews are public.** Anyone with the address can open one. Cloudflare Access can put them behind a login if that
  ever matters.
- **Nothing deletes a preview** when its pull request closes. Cloudflare keeps the 1,000 newest aliases per Worker and drops
  the oldest.

**Check on the first real preview**, since none of this was verified before it ran:
- Both addresses load: preview (version) URLs work for these Workers, which serve static files only.
- In the editor preview's console, `crossOriginIsolated` is `true`. That shows the `_headers` file applies on preview
  addresses.
- Production is unchanged: `wrangler versions upload` does not deploy, and the custom domains still serve the old
  version.
- The workflow's smoke check passed: both preview addresses answer 200, the landing page links to the preview editor, and
  the editor has COOP and COEP (so `_headers` applies on preview addresses). A wrong `CLOUDFLARE_WORKERS_SUBDOMAIN` fails
  this step.
- The previews' responses carry `X-Robots-Tag: noindex` (from `_headers`; the smoke check does not look at it).

## How the workflows work

The two workflow files keep only what a maintainer needs on the page; the reasons are here.

**Only the tip of `main` is deployed, and never out of order.** Each commit on `main` gets its own `deploy` run, and its
tests run with no shared group: a merge never waits behind another merge's tests, and none is cancelled. So two quick
merges A then B can finish their tests in either order. One script, `.github/scripts/is-main-tip.sh`, asks GitHub whether
the run's commit is still the tip of `main` (exit 0: yes; 1: no, with a notice; 2: it could not tell, which fails the job).
It is asked twice:
- **`latest`, after the tests and outside the deploy group.** A commit that is no longer the tip stops here, green. It
  never enters `deploy-production`. This matters because a concurrency group holds one running and one pending job, and a
  new pending job cancels the pending one: an older commit entering the group late would cancel a newer commit's pending
  deploy.
- **In the deploy job, inside the group, in the same step as `wrangler deploy`.** The group runs one deploy at a time and
  never cancels one in progress (`cancel-in-progress: false`), so the editor and the site are never left half deployed.
  By the time this check runs, any deploy ahead of it has finished. It sits after the build, right before wrangler: a
  commit superseded during the build still stops there. The cost: a superseded commit holds the group through one build
  before it stops (time, not safety).

If the newer commit then fails its tests, production stays on the last commit deployed until a later commit passes.

**Re-runs and manual runs.**
- A deploy that failed on its own (a network error, say) is retried with "Re-run failed jobs": the tests are not run again,
  and the in-group tip check still applies. Re-run failed jobs only while that commit is still the tip: the re-run skips
  `latest`, so an old deploy job would enter the group and could cancel a newer pending one (it would then stop at its own
  tip check, and production would wait for the next merge or a re-run of the tip's run).
- A manual run (Actions > deploy > Run workflow) runs the tests too, so nothing reaches production untested. Started on
  another branch it runs the tests and deploys nothing.
- A `[skip ci]` commit on `main` starts no run. If it lands while an earlier commit's run is testing, that run's tip check
  stops it, so neither deploys until the next commit.

**The smoke check cannot roll back.** After the deploy, `web/scripts/smoke.ts` checks both domains (200, the landing
page's link to the editor, the editor's COOP and COEP), retrying for up to 10 minutes. A failure turns the run red; the
deploy has happened. To go back: re-running an earlier commit's run deploys nothing (its tip check stops it), so revert
on `main` (a new commit, which deploys itself), or from your own computer `npx wrangler rollback` for each Worker
(with `--config wrangler.app.jsonc` for the editor; not tried here).

**Secrets.** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are in the environment of the step that runs wrangler only:
`npm ci`, the snapshot and the builds never see them in their environment. In preview.yml those run the pull request's own
code earlier in the same job, and anything it leaves behind (a process, a changed `node_modules/.bin/wrangler`) runs with the
token: that is why previews are for branches of this repository only. Wrangler is the project's own (`npx --no-install wrangler`, the version
in `web/package-lock.json`), never a fresh download. Checkouts keep no credentials (`persist-credentials: false`).

**Why preview.yml has two jobs.** `upload` runs the pull request's code (its `npm ci`, its build scripts) with the
Cloudflare token, which is why it runs only for branches of this repository: never `pull_request_target`, never forks, never
Dependabot. The token that can write to the pull request (`pull-requests: write`) is in `comment` only, a job that runs no
code from the pull request and gets the two addresses as `upload`'s outputs.

**What the build shares.** `.github/actions/build-web` is the one build for production and previews: the wheel, the
snapshot (cached on a hash of its inputs, and used only if `node scripts/build-id.ts` says it is of the wheels just built;
GitHub scopes a pull request's cache to it, so a preview never feeds production), both builds and the 25 MiB size check
(`web/scripts/check-sizes.ts`, which `npm run deploy` runs too). The caller names the addresses: `urls: production`, or the
two preview URLs; with neither the build fails (`web/scripts/urls.ts`). A production build carries canonical links; a
preview's `_headers` say `X-Robots-Tag: noindex`.

## 5. Checklist for the first production deploy

Work through `docs/design/SPEC.md`, section 8, "URLs", "To look at on the first real deploy". In short:
- `https://dofile.dev/`, `https://dofile.dev/commands/` and `https://app.dofile.dev/` load.
- In the editor's console, `crossOriginIsolated` is `true`.
- The engine download size on the landing page matches the editor's prompt.
- The links between the two origins go to the right places.
- The redirects and the 404s match the table there.
- In Safari, reloading the editor after the engine has started still works (COEP on a 304).

Also check:
- `whois dofile.dev` shows your details redacted (section 1).
- `http://dofile.dev` is refused or upgraded, never served over plain HTTP.

## 6. The old workers.dev address

The `dofile` Worker has served the old one-origin build at `https://dofile.<subdomain>.workers.dev/` since the first
deploy, with the editor at `/app/`. After this change:
- That address serves the new landing page.
- `/app/` there is a 404.
- `https://dofile-app.<subdomain>.workers.dev/` serves the new editor. Both configs keep `workers_dev` on, because
  previews need it.
- Search engines are pointed at the production addresses: every page of a production build has a `<link rel="canonical">`
  to its `dofile.dev` or `app.dofile.dev` address, so the same files at the two workers.dev addresses defer to them.

**Files stored under the old address stay with it.** Files a visitor kept in the old editor live in that origin's
browser storage (IndexedDB), and the new editor is on another origin. To keep them:
1. Open the old editor **before** this merges.
2. Use "Download all (.zip)".
3. Upload the files at `https://app.dofile.dev/`.

Once the merge deploys, the old editor is gone, and with it the page that could export the files. The downloaded engine
and the theme setting do not carry over either: the first visit to the new address downloads the engine again.

If no one but the maintainer used the old address, none of this matters. To retire the workers.dev addresses later, set
`workers_dev: false` in both configs; that also turns off previews.

## 7. Infrastructure as code: not yet

**What IaC is.** Infrastructure-as-code tools, such as Terraform and OpenTofu, describe infrastructure in files: zones,
DNS records, Workers and their domains.
- `plan` shows how the real state differs from the files.
- `apply` makes the real state match the files.

**When it pays off:**
- there are many resources;
- several people change them;
- environments must be rebuilt from scratch.

**Why dofile does not need it yet.** dofile has none of those, and what it does need is covered:
- **The Workers, their files, and their custom domains** are already declared in the two Wrangler configs, and
  `wrangler deploy` applies them on every merge. Wrangler is the IaC for this part.
- **The DNS records** are made by Cloudflare when a custom domain is attached. There are none to write by hand.
- **The registration, the zone, the token and the GitHub settings** are done once, by hand (sections 1 and 2).

**What Terraform would cost:**
- a state file to keep somewhere safe;
- a second token with wider rights;
- a second description of the custom domains, overlapping Wrangler's (`cloudflare_workers_custom_domain` against `routes`).

In return, it would write down a handful of one-time clicks.

**Recommendation: no IaC now.** Revisit it when phase 3, the hosted MCP server (`docs/phase3-plan.md`), adds real
infrastructure: a server, storage, more DNS records, or a staging environment.

**Then use OpenTofu rather than Terraform.**
- Both use the same Cloudflare provider and the same configuration language.
- Terraform 1.6 and later is under the Business Source License; OpenTofu is MPL-2.0.
- The license policy (`LICENSE-POLICY.md`) does not strictly cover a tool that is not shipped, but the open license is
  the one that matches it.
