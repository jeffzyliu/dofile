"""dofile patch: a restricted evaluator for the arithmetic expressions some commands take as text
(arch's archmexp(), bayesstats' {param} expressions), in place of Python's eval().

eval() with empty __builtins__ is not a sandbox: attribute access (().__class__...) reaches Python's
internals from Stata code. This walks the parsed expression and allows only numbers, the given names,
calls of the given functions, + - * / ** and unary minus; anything else is rejected."""
from __future__ import annotations

import ast
import operator
from typing import Any, Mapping

_BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow}
_UNARY = {ast.USub: operator.neg, ast.UAdd: operator.pos}


def safe_eval(text: str, names: Mapping[str, Any]) -> Any:
    """Evaluates `text` with only `names` (values and functions) in scope. ValueError if it uses anything
    else (attributes, subscripts, keywords, comprehensions, ...) or doesn't parse."""
    try:
        tree = ast.parse(text.strip(), mode="eval")  # eval() ignored leading spaces; ast.parse does not
    except SyntaxError as e:
        raise ValueError(f"invalid expression {text}") from e

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return node.value
        if isinstance(node, ast.Name) and node.id in names:
            return names[node.id]
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            return _BIN[type(node.op)](ev(node.left), ev(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
            return _UNARY[type(node.op)](ev(node.operand))
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in names
                and callable(names[node.func.id]) and not node.keywords):
            return names[node.func.id](*[ev(a) for a in node.args])
        raise ValueError(f"invalid expression {text}")
    return ev(tree)
