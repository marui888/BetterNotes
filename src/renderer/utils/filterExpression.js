const TOKEN_TYPES = {
  TERM: 'term',
  AND: 'and',
  OR: 'or',
  NOT: 'not',
  LPAREN: 'lparen',
  RPAREN: 'rparen',
}

function normalizeText(value) {
  return String(value || '').toLowerCase()
}

function readQuotedTerm(source, startIndex, quote) {
  let index = startIndex + 1
  let value = ''

  while (index < source.length) {
    const char = source[index]
    if (char === quote) {
      return { value, index: index + 1 }
    }

    if (char === '\\' && index + 1 < source.length) {
      value += source[index + 1]
      index += 2
      continue
    }

    value += char
    index += 1
  }

  throw new Error('缺少右引号')
}

function readTerm(source, startIndex) {
  let index = startIndex
  let value = ''

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '(' || char === ')' || char === '!') break
    if (char === '&' && next === '&') break
    if (char === '|' && next === '|') break

    value += char
    index += 1
  }

  return { value: value.trim(), index }
}

function tokenizeFilterExpression(source) {
  const tokens = []
  let index = 0

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (char === '&' && next === '&') {
      tokens.push({ type: TOKEN_TYPES.AND })
      index += 2
      continue
    }

    if (char === '|' && next === '|') {
      tokens.push({ type: TOKEN_TYPES.OR })
      index += 2
      continue
    }

    if (char === '!') {
      tokens.push({ type: TOKEN_TYPES.NOT })
      index += 1
      continue
    }

    if (char === '(') {
      tokens.push({ type: TOKEN_TYPES.LPAREN })
      index += 1
      continue
    }

    if (char === ')') {
      tokens.push({ type: TOKEN_TYPES.RPAREN })
      index += 1
      continue
    }

    if (char === '"' || char === "'") {
      const quoted = readQuotedTerm(source, index, char)
      const value = quoted.value.trim()
      if (!value) throw new Error('空字符串条件无效')
      tokens.push({ type: TOKEN_TYPES.TERM, value })
      index = quoted.index
      continue
    }

    const term = readTerm(source, index)
    if (!term.value) {
      throw new Error(`无法识别的筛选字符: ${char}`)
    }

    tokens.push({ type: TOKEN_TYPES.TERM, value: term.value })
    index = term.index
  }

  return tokens
}

function parseFilterTokens(tokens) {
  let index = 0

  const peek = () => tokens[index]
  const consume = () => tokens[index++]

  const parsePrimary = () => {
    const token = peek()
    if (!token) throw new Error('表达式不完整')

    if (token.type === TOKEN_TYPES.TERM) {
      consume()
      return { type: TOKEN_TYPES.TERM, value: token.value }
    }

    if (token.type === TOKEN_TYPES.LPAREN) {
      consume()
      const node = parseOr()
      if (peek()?.type !== TOKEN_TYPES.RPAREN) {
        throw new Error('缺少右括号')
      }
      consume()
      return node
    }

    throw new Error('需要筛选条件')
  }

  const parseNot = () => {
    if (peek()?.type === TOKEN_TYPES.NOT) {
      consume()
      return { type: TOKEN_TYPES.NOT, child: parseNot() }
    }

    return parsePrimary()
  }

  const parseAnd = () => {
    let node = parseNot()
    while (peek()?.type === TOKEN_TYPES.AND) {
      consume()
      node = { type: TOKEN_TYPES.AND, left: node, right: parseNot() }
    }
    return node
  }

  const parseOr = () => {
    let node = parseAnd()
    while (peek()?.type === TOKEN_TYPES.OR) {
      consume()
      node = { type: TOKEN_TYPES.OR, left: node, right: parseAnd() }
    }
    return node
  }

  const ast = parseOr()
  if (index < tokens.length) {
    throw new Error('表达式后面还有无法解析的内容')
  }

  return ast
}

function evaluateFilterAst(node, targetText) {
  if (!node) return true

  if (node.type === TOKEN_TYPES.TERM) {
    return targetText.includes(normalizeText(node.value))
  }

  if (node.type === TOKEN_TYPES.AND) {
    return evaluateFilterAst(node.left, targetText) && evaluateFilterAst(node.right, targetText)
  }

  if (node.type === TOKEN_TYPES.OR) {
    return evaluateFilterAst(node.left, targetText) || evaluateFilterAst(node.right, targetText)
  }

  if (node.type === TOKEN_TYPES.NOT) {
    return !evaluateFilterAst(node.child, targetText)
  }

  return false
}

export function compileFilterExpression(source) {
  const expression = String(source || '').trim()
  if (!expression) {
    return {
      ok: true,
      active: false,
      error: '',
      matches: () => true,
    }
  }

  try {
    const ast = parseFilterTokens(tokenizeFilterExpression(expression))
    return {
      ok: true,
      active: true,
      error: '',
      matches: (value) => evaluateFilterAst(ast, normalizeText(value)),
    }
  } catch (error) {
    return {
      ok: false,
      active: true,
      error: error.message || String(error),
      matches: () => true,
    }
  }
}
