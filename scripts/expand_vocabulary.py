"""Build immutable, English-only vocabulary expansion packs from pinned sources.

The shipped baseline remains unchanged. SQLite bounds collection memory, and the
gzip JSON Lines archive contains ordinary, dependency-ordered content packs.
"""
import csv
import gzip
import hashlib
import json
import re
import shutil
import sqlite3
from collections import Counter
from pathlib import Path

try:
    from .build_vocabulary import ROOT, normalize, valid, word_id
except ImportError:
    from build_vocabulary import ROOT, normalize, valid, word_id

ARCHIVE = ROOT / "data/vocabulary-expansion.jsonl.gz"
BATCH_SIZE = 2000
TAG_MAP = {"cet4": "CET4", "cet6": "CET6", "ky": "NPEE", "ielts": "IELTS",
           "toefl": "TOEFL", "gre": "GRE", "gk": "HIGH-SCHOOL", "zk": "MIDDLE-SCHOOL"}
NON_ENGLISH = re.compile(r"[\u0400-\u052f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]")
PART_OF_SPEECH = re.compile(r"^(n|v|a|s|r|adj|adv|vt|vi|prep|pron|conj|interj)\.?\s+(.+)$", re.I)


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def reference_senses(headword, definition, source_id):
    """Import structured English glosses only; never promote imported prose to ready."""
    senses = {}
    for line in definition.replace("\\r", "").replace("\\n", "\n").splitlines():
        line = " ".join(line.split())
        match = PART_OF_SPEECH.match(line)
        if not match or NON_ENGLISH.search(line) or not re.search("[A-Za-z]", match[2]):
            continue
        sid = "sense:" + hashlib.sha256(("ecdict\0" + headword + "\0" + line).encode()).hexdigest()[:24]
        senses[sid] = {"id": sid, "partOfSpeech": match[1].lower(), "sourceIds": [source_id],
                       "definition": match[2], "simpleDefinition": None, "examples": [],
                       "synonyms": [], "synonymNote": None, "collocations": [], "status": "reference"}
    return sorted(senses.values(), key=lambda sense: sense["id"])


def resolve_wordlist_headword(word, connection):
    """Undo the aggregator's artificial capitalization using existing spellings first."""
    lowered = word.lower()
    if connection.execute("SELECT 1 FROM words WHERE headword = ?", (lowered,)).fetchone():
        return lowered
    rows = connection.execute("SELECT headword FROM words WHERE folded = ? LIMIT 2", (word.casefold(),)).fetchall()
    if len(rows) == 1:
        return rows[0][0]
    # The upstream aggregator has already discarded original capitalization.
    # Unknown entries are lexical candidates, not verified names or acronyms.
    return lowered


def verified_path(record):
    path = ROOT / "data/raw" / record["localFile"]
    with path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != record["sha256"]:
        raise ValueError("Source checksum mismatch: " + record["id"])
    return path


def merge_word(connection, headword, source_id, tags, definition=""):
    row = connection.execute("SELECT data, original FROM words WHERE headword = ?", (headword,)).fetchone()
    word = json.loads(row[0]) if row else {
        "id": word_id(headword), "revision": 1, "sourceIds": [], "headword": headword,
        "variants": [], "tags": [], "cefr": None, "senses": [], "status": "headword-only"}
    word["sourceIds"] = sorted(set(word["sourceIds"] + [source_id]))
    word["tags"] = sorted(set(word["tags"] + tags))
    # Keep existing WordNet sense identities and meanings intact.
    if not word["senses"] and definition:
        word["senses"] = reference_senses(headword, definition, source_id)
        if word["senses"]:
            word["status"] = "reference"
    encoded = compact(word)
    if not row or row[0] != encoded:
        connection.execute("INSERT INTO words VALUES (?, ?, ?, ?) ON CONFLICT(headword) DO UPDATE SET data=excluded.data",
                           (headword, headword.casefold(), encoded, row[1] if row else None))
    return bool(word["senses"])


def source_entity(record, retrieved_at, previous=None):
    descriptions = {
        "ecdict": ("Repository MIT; aggregated English glosses are unreviewed reference material", "attributed-content"),
        "wordlist": ("Repository MIT; aggregated lexical list; upstream provenance listed in bundled README", "lexical-metadata-only"),
    }
    license_name, usage = descriptions[record["provider"]]
    value = {"id": record["id"], "revision": previous["revision"] if previous else 1,
             "title": record["provider"] + " / " + record["path"], "url": record["url"],
             "license": license_name, "usage": usage, "retrievedAt": record.get("retrievedAt", retrieved_at),
             "sourceRevision": record["revision"], "sha256": record["sha256"]}
    if previous and previous != value:
        value["revision"] += 1
    return value


def build():
    manifest = json.loads((ROOT / "data/sources.lock.json").read_text(encoding="utf-8"))
    records = {record["provider"]: record for record in manifest["files"]
               if (record["provider"], record["path"]) in [("ecdict", "ecdict.csv"), ("wordlist", "master.txt")]}
    if set(records) != {"ecdict", "wordlist"}:
        raise ValueError("Collect ECDICT and Wordlist before building the expansion")
    paths = {provider: verified_path(record) for provider, record in records.items()}
    for record in manifest["files"]:
        if record["provider"] in records and record["path"] in ["LICENSE", "README.md"]:
            shutil.copyfile(verified_path(record), ROOT / "data/notices" / (record["provider"] + "-" + record["path"]))

    work = ROOT / ".local/vocabulary-expansion"
    work.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(work / "collection.sqlite")
    connection.execute("PRAGMA cache_size=-16384")
    connection.execute("DROP TABLE IF EXISTS words")
    connection.execute("CREATE TABLE words (headword TEXT PRIMARY KEY, folded TEXT, data TEXT, original TEXT)")
    connection.execute("CREATE INDEX words_folded ON words(folded)")
    with gzip.open(ROOT / "data/vocabulary.json.gz", "rt", encoding="utf-8") as source:
        baseline = json.load(source)
    baseline_count = len(baseline["vocabulary"])
    for word in baseline["vocabulary"]:
        encoded = compact(word)
        connection.execute("INSERT INTO words VALUES (?, ?, ?, ?)", (word["headword"], word["headword"].casefold(), encoded, encoded))
    original_sources = {source["id"]: source for source in baseline["sources"]}
    baseline_requirement = {"packId": baseline["packId"], "minVersion": baseline["packVersion"]}
    del baseline
    connection.commit()
    sources = [source_entity(record, manifest["retrievedAt"], original_sources.get(record["id"])) for record in records.values()]
    created_at = max(source["retrievedAt"] for source in sources)
    statistics = {}
    rejected = (work / "rejected.jsonl").open("w", encoding="utf-8")
    try:
        for provider in ["ecdict", "wordlist"]:
            counts = Counter()
            record = records[provider]
            with paths[provider].open(encoding="utf-8-sig", newline="") as source:
                rows = csv.DictReader(source) if provider == "ecdict" else ({"word": line.strip()} for line in source)
                for line_number, row in enumerate(rows, 1):
                    counts["rows"] += 1
                    word = normalize(row["word"])
                    if not valid(word):
                        counts["rejectedRows"] += 1
                        rejected.write(compact({"sourceId": record["id"], "row": line_number, "candidate": word}) + "\n")
                        continue
                    if provider == "wordlist":
                        resolved = resolve_wordlist_headword(word, connection)
                        counts["caseAlignedRows"] += resolved != word
                        word = resolved
                    tags = [TAG_MAP.get(tag, "ECDICT-" + tag) for tag in row.get("tag", "").split()]
                    had_word = connection.execute("SELECT 1 FROM words WHERE headword=?", (word,)).fetchone()
                    counts["newHeadwords"] += not bool(had_word)
                    counts["acceptedRows"] += 1
                    counts["rowsWithEnglishGloss"] += bool(reference_senses(word, row.get("definition", ""), record["id"]))
                    merge_word(connection, word, record["id"], tags, row.get("definition", ""))
                    if line_number % 10000 == 0:
                        connection.commit()
            connection.commit()
            statistics[provider] = dict(counts)
            print(json.dumps({"provider": provider, **counts}), flush=True)
    finally:
        rejected.close()

    temporary = ARCHIVE.with_suffix(".tmp")
    inventory = []
    totals = Counter()
    tags = Counter()
    batch = []
    changed = Counter()
    def emit_batch(archive):
        number = len(inventory) + 1
        pack = {"schemaVersion": 1, "packId": f"vocab:expanded-{number:04d}", "packVersion": 1,
                "createdAt": created_at, "requires": [baseline_requirement] if number == 1 else
                [{"packId": inventory[-1]["packId"], "minVersion": 1}],
                "sources": sources if number == 1 else [], "vocabulary": list(batch), "passages": [], "questions": []}
        line = compact(pack).encode("utf-8")
        archive.write(line + b"\n")
        inventory.append({"packId": pack["packId"], "words": len(batch), "bytes": len(line)})
        batch.clear()
    with temporary.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as archive:
        for encoded, original in connection.execute("SELECT data, original FROM words ORDER BY folded, headword"):
            word = json.loads(encoded)
            totals["headwords"] += 1
            totals["senses"] += len(word["senses"])
            totals["headwordOnly"] += not bool(word["senses"])
            totals["sensesWithExamples"] += sum(bool(sense["examples"]) for sense in word["senses"])
            totals["sensesWithSynonyms"] += sum(bool(sense["synonyms"]) for sense in word["senses"])
            tags.update(word["tags"])
            if encoded == original:
                continue
            if original:
                word["revision"] = json.loads(original)["revision"] + 1
                changed["updated"] += 1
            else:
                changed["added"] += 1
            batch.append(word)
            if len(batch) == BATCH_SIZE:
                emit_batch(archive)
        if batch:
            emit_batch(archive)
    connection.close()
    # Published pack versions are immutable. A future source update needs a new series.
    if ARCHIVE.exists() and hashlib.sha256(ARCHIVE.read_bytes()).digest() != hashlib.sha256(temporary.read_bytes()).digest():
        raise ValueError("Expansion contents changed. Create a new versioned expansion series instead of overwriting released revisions.")
    temporary.replace(ARCHIVE)
    report = {**totals, "readySenses": 0, "baselineHeadwords": baseline_count, "expansion": dict(changed),
              "archiveBytes": ARCHIVE.stat().st_size, "packages": len(inventory), "tags": dict(sorted(tags.items())),
              "sources": statistics, "sourceRevisions": {provider: record["revision"] for provider, record in records.items()},
              "limitations": ["Only structured English ECDICT glosses are imported; Chinese translations and unstructured prose are excluded.",
                              "Existing WordNet meanings are preserved instead of replaced by ECDICT glosses.",
                              "Wordlist capitalizes all entries; spellings align to known words or lowercase lexical candidates.",
                              "Headword-only entries are searchable, not reviewed learning cards.",
                              "Community lists include proper names, technical terms and rare forms; tags are not official exam guarantees."]}
    (ROOT / "data/collection-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (ROOT / "data/vocabulary-expansion.manifest.json").write_text(json.dumps({"format": "content-pack-jsonl-gzip", "baseline": baseline_requirement,
        "archive": ARCHIVE.name, "sha256": hashlib.sha256(ARCHIVE.read_bytes()).hexdigest(), "packs": inventory}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({**totals, "expansion": dict(changed), "packages": len(inventory)}), flush=True)


if __name__ == "__main__":
    build()
