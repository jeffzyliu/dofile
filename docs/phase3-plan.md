# dofile — Phase 3 plan: hosted MCP server

**Goal:** a public MCP endpoint over HTTP that many users and agents can use at the same time, safely. Users
authenticate. A user can reach only their own sessions and files. Each user has limits on sessions, memory, CPU
and disk. The server runs in a container behind a reverse proxy with TLS, and self-hosters can run the same setup.

**Not in Phase 3:** billing, a web UI for MCP sessions (the Phase 2 editor is separate), community commands, files
kept after a session ends.

**Status (2026-11-06):** not started. Depends on Phase 1 only. It can run in parallel with Phase 2.

## Where the HTTP server is now (Phase 1)
- No authentication. It binds to localhost unless `--host` is given, which prints a warning. `--unsafe` is then
  refused. The SDK's DNS-rebinding protection is on for localhost only.
- Sessions are tokens from `start_session` (`secrets.token_urlsafe(16)`), each with its own temp workdir, deleted on
  close. Anyone with a token can use the session. Anyone who can reach the port can start sessions.
- `WorkerPool`: at most `--max-sessions`. When the pool is full, the least recently used idle session is closed,
  whoever it belongs to. So one client can push everyone else's sessions out. Idle sessions are closed after 15 min.
- Per session: one call runs and one may wait (`mcp_server.py`), a per-call timeout (60 s default), a log capped at
  2 × 1,000,000 characters in the worker, uploads up to `--max-upload` MB (1024 default). **No limits on memory, CPU
  time across calls, disk use in the workdir, or number of sessions per client.**
- `request_upload` and `request_download` URLs are built from `--public-url`.
- The sandbox (denylist + audit hook) is defense in depth, not a security boundary ([phase1-plan.md](phase1-plan.md),
  component 2). A public server needs a container as the boundary.

## Open decisions (recommendation first)
1. **Authentication.**
   - First check what `mcp` 2.3.0 gives for the MCP authorization spec (the server as an OAuth resource server,
     protected-resource metadata, a token verifier hook), so dofile does not build its own.
   - Step A (recommended first): static bearer tokens from a file (`--tokens FILE`, one user name per token). This is
     enough for self-hosters and for a small invite-only instance.
   - Step B: OAuth 2.1 through an external identity provider (for example GitHub sign-in through a hosted IdP) for
     the public instance, so remote clients such as Claude's custom connectors can sign in.
2. **Authorization.**
   - A session token belongs to the user who started it. A call with another user's session token is refused as
     "unknown session". The token alone is no longer enough.
   - Pool eviction picks only among the caller's own idle sessions. If the whole pool is full, `start_session` is
     refused.
   - Per-user limits, set in config: number of sessions, workdir disk use, upload size, calls per minute.
3. **Resource limits per session.**
   - Memory and CPU: `setrlimit` in the child after the fork (Linux: `RLIMIT_AS`, `RLIMIT_CPU`). macOS ignores
     `RLIMIT_AS`, so the hosted server runs on Linux only. Or (alternative) one cgroup per child, which needs more
     privileges in the container.
   - Disk: a check on writes in the audit hook (bytes per workdir), or one size-limited volume per session. The
     audit hook does not see write sizes, so check the size after each call and refuse the next call if the workdir is
     too large.
   - A user's limit breach ends that session only (rc 9998 with the reason), never the server.
4. **Isolation.** (Recommended) One container for the server: non-root, read-only root filesystem, no outbound
   network, workdirs on a size-limited volume, the forkserver inside it. Later, if the instance is public: gVisor
   (runsc) or one container per user.
5. **Reverse proxy.** (Recommended) Caddy (automatic TLS, simple config). Required:
   - no response buffering on the MCP endpoint (streamed responses),
   - read timeouts longer than the longest call timeout,
   - request body size that allows `--max-upload` on `/upload/`,
   - `--public-url` set to the public https URL,
   - a Host and Origin allowlist for the public name (the SDK's DNS-rebinding check is localhost-only),
   - rate limits per IP on `start_session` and `/upload/`.
6. **Where to host.** A single Linux VM (for example Hetzner) or Fly.io. Decide by price and by whether the
   container settings in decision 4 are allowed there.
7. **Logs and privacy.** By default the server does not log users' code, data or file names. It logs only call
   counts, return codes, durations and limit hits. A short privacy note on the landing page.

## Order of work (each step ends green)
1. **Authentication, step A,** with tests: no token gives 401, a wrong token gives 401, two users with their own
   tokens.
2. **Authorization:** sessions owned by users, eviction among the user's own sessions, per-user limits. Tests: user B
   cannot use user A's session token, and user B cannot push user A's sessions out.
3. **Resource limits:** memory, CPU and disk per session. Tests: a call that allocates too much memory, an endless
   `save` loop that fills the disk, and a CPU-bound loop. Each ends only its own session.
4. **Container image** and a `compose` file with the reverse proxy, for self-hosters. A smoke test in CI: start the
   container, start a session, run a regression, check that outbound network fails.
5. **Clients:** Claude Code (`--transport http`), Claude's remote connector, MCP Inspector. Fix what they find. Update
   `MCP-SCHEMA.md` and the TypedDicts together for any tool change.
6. **Authentication, step B** (OAuth) for the public instance.
7. **Deploy** the public instance. Load test: N users each running a regression loop. Write down the limits and
   numbers here.
8. **Agent ergonomics** with remote clients: the open items in [agent-ergonomics.md](agent-ergonomics.md) (ERG-8,
   ERG-9) if agents keep running into them. They are engine error text, so web demo users see them too; fix them
   whenever it's convenient, in either phase.

## Verification (end of Phase 3)
- [ ] Without a valid token, every MCP and upload/download request is refused.
- [ ] User B cannot read, run in, reset or evict user A's sessions, even with A's session token.
- [ ] A memory bomb, a disk fill and an endless loop each end only the session that ran them. Other users' calls keep
      working.
- [ ] From inside the container, outbound network fails and writes outside the workdirs fail.
- [ ] Through the proxy: a long call streams, a 1 GB upload works, and the upload and download links use the public
      URL.
- [ ] Claude Code and one other client run the Phase 1 check (robust regression on cps.dta, `shell ls` refused)
      against the public URL.
- [ ] A self-hoster can start the same setup from the README with one `compose` command.

## Risks
- **The engine is large and was not written to face untrusted users.** ODT-14 showed an `eval()` on user text. The
  container is the boundary. Check every re-vendor for new `eval`/`exec` on user text (Phase 1 rule).
- **Cost and abuse.** Free compute attracts misuse. No outbound network stops scraping and spam, but not CPU use
  such as mining. Per-user limits and invite-only accounts come first.
- **The MCP authorization spec and SDK are still changing.** Pin `mcp`, and keep step A working when B changes.
- **Workdirs hold users' data.** Delete them on close and on restart, never back them up, and say so.
