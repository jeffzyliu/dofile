"""dofile patch (PATCH-2): Stata's Break, taken only at safe points.

The host (dofile's worker) calls request() from its SIGINT handler instead of raising KeyboardInterrupt at
whatever line is running: that could stop a command half done (an `append` with some columns extended and others
not). The interpreter calls at_command() before each command and each loop pass, and long computations that leave
the data as they found it call check(). Both raise KeyboardInterrupt, so after a Break the data is as the last
complete command left it.
"""
requested = False  # a Break is pending
depth = 0  # engine commands running now; `do`, `run` and `include` don't count (their lines are commands too)


def request() -> None:
    global requested
    requested = True


def clear() -> None:
    global requested, depth
    requested, depth = False, 0


def check() -> None:
    """Take a pending Break now: for computations that don't change the data, or restore it in a `finally`."""
    global requested
    if requested:
        requested = False
        raise KeyboardInterrupt


def at_command(by_groups) -> None:
    """Before a command or a loop pass: only outside other commands and `by`, which would stop half done."""
    if requested and depth == 0 and by_groups is None:
        check()
