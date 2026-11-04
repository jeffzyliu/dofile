"""Sandbox for running untrusted Stata code in a dedicated worker process.

Two layers:
1. Denylist: Stata commands that run programs, delete files, change directory or download are
   replaced by an rc 199 error (`!cmd` is OpenDTA's synonym for `shell`, so it is covered).
2. A Python audit hook (PEP 578) blocks subprocesses and network connections, confines writes,
   deletes and renames to the session workdir, and reads to the workdir, the extra read dirs and
   the Python installation.

This is a policy layer, not a security boundary: clients send Stata, not Python, so the hook only
has to stop what OpenDTA's commands can do. A public deployment should still run in a container.
Audit hooks cannot be removed, so install() is for a process that does nothing else.
"""
from __future__ import annotations

import dataclasses
import errno
import os
import sys
import tempfile

DENIED = ("shell", "erase", "rm", "rmdir", "mkdir", "cd", "copy", "webuse")

_BLOCKED_EVENTS = (
    "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork", "os.forkpty",
    "pty.spawn", "socket.connect", "socket.bind", "socket.getaddrinfo", "socket.gethostbyname", "urllib.Request", "ctypes.dlopen", "webbrowser.open",
)
_WRITE_EVENTS = ("os.remove", "os.rmdir", "os.mkdir", "os.rename", "os.symlink", "os.link", "os.chmod",
                 "os.chown", "os.truncate", "os.utime", "shutil.rmtree", "shutil.move", "os.chdir")
_LIST_EVENTS = ("os.listdir", "os.scandir", "glob.glob")
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


class SandboxError(PermissionError):
    def __init__(self, message: str):
        super().__init__(errno.EACCES, message)  # strerror = message, so OpenDTA's own 603 errors show it


def deny_commands() -> None:
    """Replace the dangerous commands in OpenDTA's registry with an rc 199 error."""
    from ._vendor.opendta.commands import registry
    from ._vendor.opendta.core.errors import StataError
    from ._vendor.opendta.session import Session  # noqa: F401  (registers all commands)

    for name in DENIED:
        spec = registry.REGISTRY.get(name)
        if spec is None:
            continue

        def blocked(s, args, _name=name):
            raise StataError(199, f"command {_name} is disabled in the dofile sandbox")
        registry.REGISTRY[name] = dataclasses.replace(spec, fn=blocked)


def _real(p) -> str | None:
    if isinstance(p, int):
        return None  # an already-open file descriptor
    try:
        p = os.fsdecode(os.fspath(p))
    except TypeError:
        return None
    return os.path.realpath(p)


def _inside(path: str, roots: tuple[str, ...]) -> bool:
    return any(path == r or path.startswith(r + os.sep) for r in roots)


def install(workdir: str | os.PathLike, read_dirs: tuple[str, ...] = ()) -> None:
    """Confine this process. Call once, before running untrusted code."""
    work = os.path.realpath(workdir)
    # temp files and matplotlib's cache go to a hidden folder inside the workdir, out of the user's files
    scratch = os.path.join(work, ".dofile")
    os.makedirs(scratch, exist_ok=True)
    for var in ("TMPDIR", "HOME", "MPLCONFIGDIR"):
        os.environ[var] = scratch
    tempfile.tempdir = scratch
    sys.dont_write_bytecode = True
    os.chdir(work)
    deny_commands()
    import mimetypes
    mimetypes.init()  # reads system files like /etc/mime.types once; openpyxl (putexcel, export excel) needs it

    py_roots = {os.path.realpath(p) for p in (sys.prefix, sys.base_prefix, sys.exec_prefix)}
    py_roots |= {os.path.realpath(p) for p in sys.path if p and os.path.isdir(p)}
    writable = (work,)
    readable = (work, *sorted({os.path.realpath(d) for d in read_dirs} | py_roots), "/dev/null")

    def hook(event: str, args: tuple) -> None:
        if event.startswith(_BLOCKED_EVENTS):
            raise SandboxError(f"dofile sandbox: {event} is not allowed")
        if event == "open":
            path = _real(args[0])
            if path is None:
                return
            mode, flags = args[1], args[2] or 0
            write = any(c in mode for c in "wax+") if isinstance(mode, str) else bool(flags & _WRITE_FLAGS)
            if not _inside(path, writable if write else readable):
                raise SandboxError(f"dofile sandbox: cannot {'write' if write else 'read'} {path}")
        elif event in _WRITE_EVENTS:
            for a in args[:2]:
                path = _real(a)
                if path is not None and not _inside(path, writable):
                    raise SandboxError(f"dofile sandbox: {event} outside the workdir: {path}")
        elif event in _LIST_EVENTS:
            path = _real(args[0] if args and args[0] is not None else ".")
            if path is not None and not _inside(path, readable):
                raise SandboxError(f"dofile sandbox: cannot list {path}")

    sys.addaudithook(hook)
