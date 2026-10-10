# Word Normalization Version 1

## 1. Purpose

`normalization_version = 1` defines the deterministic rule used to identify the same logical word in independently created BetterNotes SQLite databases.

Version 1 is deliberately conservative. It removes formatting differences that are not intended to distinguish words, but it does not perform linguistic transformations or change letter case.

The rule is used for:

- grouping identical words from different source folders and TXT files;
- enforcing word uniqueness inside one SQLite database;
- comparing words exported from different SQLite databases;
- attaching study-plan state to a canonical word instead of to a TXT line;
- preserving every source occurrence without merging its markers or annotation.

It is not used to modify the original TXT content.

## 2. Terminology

### 2.1 Source word

The word text parsed from the first field of a TXT record.

Example:

```text
 abandon |v||||||放弃；抛弃
```

The source word is the value before the first `|`:

```text
 abandon 
```

### 2.2 Display word

The text shown to the user. Version 1 removes leading and trailing whitespace but otherwise preserves the source spelling and letter case.

Examples:

```text
source word:  " Abandon "
display word: "Abandon"

source word:  " ａｂａｎｄｏｎ "
display word: "ａｂａｎｄｏｎ"
```

`display_word` does not apply NFKC. It keeps the source spelling for display and removes boundary whitespace only.

### 2.3 Normalized word

The value used for canonical-word grouping and database uniqueness.

For Version 1 it is produced by:

```text
Unicode NFKC normalization
then
leading/trailing whitespace removal
```

Letter case is preserved.

### 2.4 Canonical word

One row in the SQLite `words` table, identified by:

```text
language
normalization_version
normalized_word
```

A canonical word can have any number of occurrences.

### 2.5 Word occurrence

One physical record parsed from one TXT file. Occurrences keep their source file, line position, markers, annotation, and raw text independently.

Grouping occurrences under one canonical word does not merge or discard occurrence content.

## 3. Version 1 Algorithm

Given an input value `value`:

1. Convert `null` and `undefined` to an empty string.
2. Convert any other value to a JavaScript string.
3. Apply Unicode Normalization Form Compatibility Composition (`NFKC`).
4. Remove leading and trailing whitespace with JavaScript `String.prototype.trim()` semantics.
5. Return the resulting string without changing its letter case or internal content.

Pseudocode:

```text
function normalizeWordV1(value):
    if value is null or undefined:
        source = ""
    else:
        source = String(value)

    normalized = UnicodeNFKC(source)
    normalized = TrimLeadingAndTrailingWhitespace(normalized)

    return normalized
```

JavaScript reference implementation:

```js
export const WORD_NORMALIZATION_VERSION = 1

export function normalizeWordV1(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
}
```

The production implementation and automated tests must follow this function's behavior.

## 4. Operations Not Performed

Version 1 does not:

- convert text to lowercase;
- convert text to uppercase;
- collapse or remove whitespace inside the word;
- remove punctuation;
- remove or normalize hyphens beyond Unicode NFKC behavior;
- remove apostrophes;
- merge straight and curly apostrophes through a custom rule;
- perform stemming or lemmatization;
- merge singular and plural forms;
- merge verb tenses;
- merge abbreviations and expanded forms;
- merge British and American spellings;
- correct spelling mistakes;
- translate words;
- infer language from the text;
- merge visually similar characters from different scripts;
- modify markers or annotations.

Consequently, these remain different canonical words:

```text
abandon
Abandon
ABANDON

ice-cream
ice cream

can't
cant

color
colour

run
running
ran
```

## 5. Empty Values

After normalization, an empty result is not a valid canonical word.

Examples that become empty:

```text
""
"   "
"\t\r\n"
null
undefined
```

Recommended import behavior:

- do not create a `words` row;
- keep the source file scan running;
- count the record as an invalid or empty-word occurrence;
- write its file path and line number to Debug Info;
- do not silently convert the annotation or another field into the word.

Example Debug Info message:

```text
[Library Warning] Empty word skipped: C:\Words\TOEFL\unit01.txt, line 24
```

## 6. Unicode NFKC Behavior

NFKC converts Unicode compatibility variants into a stable representation.

Examples:

| Source | Normalized | Result |
|---|---|---|
| `ａｂａｎｄｏｎ` | `abandon` | Grouped with ASCII `abandon` |
| `Ａｂａｎｄｏｎ` | `Abandon` | Case remains uppercase at the start |
| `①` | `1` | Compatibility form becomes ASCII digit |
| `ﬁle` | `file` | Compatibility ligature is expanded |

NFKC can change compatibility characters. The original TXT line and source spelling must therefore remain available in the occurrence record.

The application must not write the normalized value back to the TXT file unless the user explicitly edits and saves the word.

## 7. Whitespace Behavior

Version 1 removes whitespace only at the beginning and end.

Examples:

| Source | Normalized |
|---|---|
| ` abandon ` | `abandon` |
| `\tabandon\r\n` | `abandon` |
| `ice cream` | `ice cream` |
| `ice  cream` | `ice  cream` |

The last two examples remain different because internal whitespace is not collapsed.

## 8. Case-Sensitive Identity

Version 1 preserves case. Therefore:

```text
abandon != Abandon
Abandon != ABANDON
abandon != ABANDON
```

This rule applies to canonical-word identity and grouping.

The C-page Word filter may independently offer case-insensitive searching for convenience. Search behavior must not change canonical-word identity.

For example, a case-insensitive search for `abandon` may return all three rows, but the Library must continue to display them as three separate canonical words.

## 9. Language

Language is part of the canonical identity:

```text
(language, normalization_version, normalized_word)
```

Version 1 uses `en` as the default language for the current word-list workflow.

The same normalized text can exist separately under another language code:

```text
(en, 1, gift)
(de, 1, Gift)
```

Because case is preserved, `gift` and `Gift` are already different normalized values. The language field additionally prevents accidental identity collisions when multilingual sources are introduced.

## 10. SQLite Representation

Recommended table definition:

```sql
CREATE TABLE words (
  id                    INTEGER PRIMARY KEY,
  language              TEXT NOT NULL DEFAULT 'en',
  normalization_version INTEGER NOT NULL,
  normalized_word       TEXT NOT NULL,
  display_word          TEXT NOT NULL,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,

  UNIQUE (
    language,
    normalization_version,
    normalized_word
  )
);
```

Important requirements:

- do not apply SQLite `COLLATE NOCASE` to the uniqueness constraint;
- use the normalized value exactly as produced by `normalizeWordV1()`;
- use parameterized statements;
- never use the database-local integer `id` to compare words from independent databases.

Example lookup:

```sql
SELECT id, display_word
FROM words
WHERE language = ?
  AND normalization_version = ?
  AND normalized_word = ?;
```

Example parameters:

```text
language: en
normalization_version: 1
normalized_word: Abandon
```

## 11. Local ID and Cross-Database Identity

`words.id` is a local SQLite primary key. It is used for efficient joins inside one database.

Example:

```text
Database A: id 15  -> abandon
Database B: id 891 -> abandon
```

The integers do not need to match.

The cross-database identity is:

```text
en | 1 | abandon
```

Two word rows represent the same canonical word only when all three identity fields match exactly.

An optional portable key can be represented without hashing:

```text
v1:en:abandon
```

The authoritative identity remains the three separate database fields, avoiding parsing or escaping ambiguity in the portable string.

## 12. Display Word Selection

Occurrences grouped under one canonical word can have different source spellings because NFKC is used only for canonical identity. For example, `ａｂａｎｄｏｎ` and `abandon` share one normalized value while retaining different source text.

Recommended first-import rule:

1. When the canonical word is first created, set `display_word` to the original source word with leading and trailing whitespace removed; do not apply NFKC.
2. Later imports do not automatically replace `display_word`.
3. A future explicit user command may change the preferred display value.

Changing `display_word` alone must not change canonical identity.

Changing `normalized_word` means moving the occurrence to a different canonical word and must be handled as an explicit data operation.

## 13. Occurrence Grouping

Each parsed TXT line produces one occurrence.

Example source records:

```text
abandon|v||||||放弃
abandon|verb||||||抛弃
abandon|difficult||||||容易忘记
```

The result is:

```text
Canonical words: 1
Occurrences:      3
```

All markers and annotations remain independent.

No occurrence-level uniqueness across independent databases is required. Rebuilding a source-file index may assign new local occurrence IDs, provided that the current occurrence count and content remain complete.

## 14. Versioning Rules

Once Version 1 data exists, the Version 1 algorithm must not be silently changed.

Any behavioral change requires a new version, for example:

```text
normalization_version = 2
```

Changes that require a new version include:

- converting words to lowercase;
- collapsing internal spaces;
- normalizing apostrophe variants with a custom rule;
- removing punctuation;
- performing lemmatization;
- changing the Unicode normalization form;
- introducing language-specific spelling transformations.

A future migration must:

1. retain the original Version 1 identity during analysis;
2. compute the Version 2 value separately;
3. detect collisions before changing any rows;
4. show a migration report;
5. preserve occurrence content;
6. update study-plan references in one transaction;
7. support rollback from a pre-migration backup.

## 15. Reference Test Cases

The implementation should include at least the following tests:

| Input | Expected Version 1 output | Notes |
|---|---|---|
| `abandon` | `abandon` | Unchanged |
| ` Abandon ` | `Abandon` | Trimmed, case preserved |
| `ABANDON` | `ABANDON` | Case preserved |
| `ａｂａｎｄｏｎ` | `abandon` | Full-width form normalized |
| `ＡＢＡＮＤＯＮ` | `ABANDON` | Full-width form normalized, case preserved |
| `ice cream` | `ice cream` | Internal space retained |
| `ice  cream` | `ice  cream` | Repeated internal space retained |
| `ice-cream` | `ice-cream` | Hyphen retained |
| `can't` | `can't` | Apostrophe retained |
| `can’t` | `can’t` | No custom apostrophe folding |
| `ﬁle` | `file` | Ligature normalized by NFKC |
| `\tabandon\r\n` | `abandon` | Boundary whitespace removed |
| `   ` | empty | Invalid canonical word |
| `null` | empty | Invalid canonical word |
| `undefined` | empty | Invalid canonical word |

Additional assertions:

```text
normalizeWordV1("abandon") !== normalizeWordV1("Abandon")
normalizeWordV1(" abandon ") === normalizeWordV1("abandon")
normalizeWordV1("ａｂａｎｄｏｎ") === normalizeWordV1("abandon")
normalizeWordV1("ice cream") !== normalizeWordV1("ice  cream")
```

## 16. Implementation Checklist

- [ ] Define `WORD_NORMALIZATION_VERSION = 1` in one shared main-process module.
- [ ] Use one implementation of `normalizeWordV1()` for scan, lookup, import, and test code.
- [ ] Preserve letter case.
- [ ] Reject empty normalized words.
- [ ] Store the original raw TXT line in the occurrence index.
- [ ] Enforce the composite SQLite uniqueness constraint.
- [ ] Do not use `COLLATE NOCASE` for canonical identity.
- [ ] Log skipped empty records to Debug Info.
- [ ] Keep word-search behavior separate from identity normalization.
- [ ] Add migration logic before introducing any future normalization version.

## 17. Version 1 Summary

The complete Version 1 identity rule is:

```text
identity = (
  language,
  normalization_version = 1,
  String(sourceWord ?? '').normalize('NFKC').trim()
)
```

Letter case is preserved. Occurrence data is grouped by this identity but is never automatically merged.
