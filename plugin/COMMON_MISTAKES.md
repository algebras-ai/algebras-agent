# Common Translation Mistakes

Reference taxonomy of recurring translation errors. Use this when reviewing translations and when writing QA rules.

---

## 1. Mixed / Partially Untranslated Strings

**Root problem:** Source fragments leaked into localized output. Partial overwrite or concatenation corruption. Language contamination inside target text.

**Examples:**
- `CONSULTING ART DIREDirecteur techniqueR`
- `Texturing Artista`
- `Texturing 美术`

**QA rule:** Detect mixed-language contamination and retained source fragments beyond approved glossary or brand terms. Flag extra Latin tokens in non-Latin targets.

---

## 2. Glossary / Terminology Inconsistency

**Root problem:** A canonical project term is translated inconsistently across rows.

**QA rule:** Enforce mandatory glossary mappings and approved inflections for protected concepts. Run `glossary_qa.py` after every translation session.

---

## 3. Semantic Meaning Loss or Drift

**Root problem:** Translation changes or drops meaning from source.

**Subtypes:**
- Missing semantic component (`Drum Magazine` → generic word for magazine)
- Added unintended meaning (`Fried Toast` → `Burnt Toast`)
- Changed speaker intent or addressee (group command → singular command)
- Wrong sense of a broad concept (`humanity` as humankind vs. human nature)

**QA rule:** Verify semantic coverage of all source concepts. Check dialogue metadata for addressee count and speaker intent before accepting imperative or pronoun choices. Treat false friends as high-risk.

---

## 4. Numeric / Token Corruption

**Root problem:** A critical numeric token was modified in translation.

**Example:** `7.62` → `7.63`

**QA rule:** Preserve numbers, decimals, IDs, variables, markup, and placeholders exactly. Run `numeric_qa.py` on every batch.

---

## 5. Formatting / Whitespace Issues

**Root problem:** Invalid repeated whitespace in visible UI text, or tag/markup corruption.

**QA rule:** Detect repeated whitespace outside markup-sensitive contexts. Preserve all tags, placeholders, escaped quotes, and casing constraints exactly as in the source.

---

## 6. Regional Register Mismatch

**Root problem:** Target locale uses expressions from a different regional variety.

**Example:** Spain Spanish phrasing copied into Latin American Spanish.

**QA rule:** For languages with regional variants (es_ES / es_419, pt / pt_BR), compare rows side by side. Flag strings that retain clearly region-specific colloquialisms unless explicitly approved.

---

## 7. Domain Terminology Mistranslation

**Root problem:** Specialized or domain-specific terms treated as generic dictionary words.

**Example:** `paddle` in a BDSM context → generic word for a sports paddle.

**QA rule:** Treat domain-specific object and action names as terminology, not generic words. Validate against scene context and item function where available.

---

## 8. Profanity / Intensity Loss

**Root problem:** Source emotional intensity is weakened in the target without an explicit sanitization request.

**Example:** `The hell is happening?` → neutral equivalent with no expletive.

**QA rule:** Preserve profanity, panic, contempt, and horror intensity unless the target locale requires a deliberate tone shift or the user asks for sanitization.

---

## 9. Orthography / Diacritic Fallback

**Root problem:** ASCII fallback used instead of proper target-language diacritics.

**Examples:**
- `C'e'` → `C'è`
- `umanita'` → `umanità`

**QA rule:** Detect ASCII apostrophe substitutions for required diacritics in languages that use accented characters.

---

## 10. Length Expansion Risk

**Root problem:** Short or timing-sensitive strings expand significantly beyond the source length.

**Examples:**
- `Need more…` → `Il m'en faut plus...` (fr)
- `Found him yet?` → `¿Ya has encontrado a Marlowe?` (es_ES)

**QA rule:** Run `length_qa.py` on every batch. Review length-expanded short strings for subtitle fit, timing, and readability. Prefer concise natural equivalents when the source is a short reaction or bark.
