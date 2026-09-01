# Filter Expression Syntax

This document describes the filter syntax used by the video mode Note list and Notes Pool.

## Supported Operators

| Syntax | Meaning | Example |
| --- | --- | --- |
| `&&` | AND | `模型 && 图像` |
| `||` | OR | `模型 || 图像` |
| `!` | NOT | `!错误` |
| `( )` | Grouping | `(模型 && 图像) || 圆锥` |

## Matching Rule

Each plain text term means: the note content contains this text.

Examples:

```txt
模型
```

Matches notes whose content contains `模型`.

```txt
模型 && 图像
```

Matches notes whose content contains both `模型` and `图像`.

```txt
模型 || 图像
```

Matches notes whose content contains either `模型` or `图像`.

```txt
(模型 && 图像) || 圆锥
```

Matches notes whose content contains both `模型` and `图像`, or contains `圆锥`.

```txt
!错误
```

Matches notes whose content does not contain `错误`.

```txt
! ((模型 && 图像) || 圆锥)
```

Matches notes whose content does not satisfy `(模型 && 图像) || 圆锥`.

## Spaces

Spaces around operators are optional.

These are equivalent:

```txt
模型&&图像
模型 && 图像
```

Spaces inside a plain text term are kept as part of the search text.

```txt
圆锥 曲线
```

This searches for the complete text `圆锥 曲线`.

## Ordinary Slash Text

Slash text is treated as ordinary text.

Examples:

```txt
//mr::
//mr??
```

These are normal text filters, not regular expressions.

## Regular Expressions

Regular expressions are not enabled in the current version.

The following syntax is not treated as a regular expression:

```txt
/圆锥|椭圆|双曲线/
```

It is treated as ordinary text.

## Invalid Expressions

If the expression is invalid, the UI shows `Invalid`.

Examples of invalid expressions:

```txt
模型 &&
(模型 || 图像
```

When an expression is invalid, the filter does not hide results.
