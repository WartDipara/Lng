"""Build an English-only, source-attributed master pack from locked snapshots."""
import csv
import gzip
import hashlib
import io
import json
import re
import shutil
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def normalize(word):
    return " ".join(unicodedata.normalize("NFKC", word).replace("’", "'").strip().split())


def valid(word):
    return bool(word and len(word) <= 100 and re.search("[A-Za-z]", word)
                and re.fullmatch(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9 '\-./]*", word)
                and not re.search(r"\b(?:adj|adv|vt|vi|pron)\.$", word))


def word_id(word):
    return "word:" + hashlib.sha256(word.encode()).hexdigest()[:24]


def decode(data):
    codecs = ("utf-16",) if data[:2] in (b'\xff\xfe', b'\xfe\xff') else ("utf-8-sig", "gb18030")
    for codec in codecs:
        try:
            value = data.decode(codec)
            if "\x00" not in value:
                return value
        except UnicodeError:
            continue
    raise ValueError("Unknown text encoding")


def tags_for(path):
    pairs = [("四级", "CET4"), ("六级", "CET6"), ("CET4", "CET4"), ("CET6", "CET6"),
             ("CET_4+6", "CET4+CET6"), ("考研", "NPEE"), ("NPEE", "NPEE"), ("托福", "TOEFL"),
             ("TOEFL", "TOEFL"), ("雅思", "IELTS"), ("GRE", "GRE"), ("GMAT", "GMAT"),
             ("SAT", "SAT"), ("专四", "TEM4"), ("专八", "TEM8"), ("四八级", "TEM4+TEM8"),
             ("COCA", "COCA20000"), ("高中", "HIGH-SCHOOL"), ("初中", "MIDDLE-SCHOOL"), ("商务", "BUSINESS")]
    return sorted({tag for fragment, tag in pairs if fragment in path})


def build():
    lock = json.loads((ROOT / "data/sources.lock.json").read_text(encoding="utf-8"))
    words, sources, stats = {}, [], []
    rejected = []
    raw = ROOT / "data/raw"
    notices = ROOT / "data/notices"
    notices.mkdir(exist_ok=True)

    def add(word, source, tags):
        word = normalize(word)
        if not valid(word):
            return None
        if word not in words:
            words[word] = {"id": word_id(word), "revision": 1, "sourceIds": [], "headword": word,
                           "variants": [], "tags": [], "cefr": None, "senses": [], "status": "headword-only"}
        entry = words[word]
        entry["sourceIds"] = sorted(set(entry["sourceIds"] + [source]))
        entry["tags"] = sorted(set(entry["tags"] + tags))
        return entry

    for record in lock["files"]:
        data = (raw / record["localFile"]).read_bytes()
        if hashlib.sha256(data).hexdigest() != record["sha256"]:
            raise ValueError("Source checksum mismatch: " + record["id"])
        provider, path = record["provider"], record["path"]
        if path.endswith(".md") or path in ["LICENSE", "WNDB_License.txt"]:
            shutil.copyfile(raw / record["localFile"], notices / (provider + "-" + Path(path).name))
            continue
        license_name = {"kyle": "Repository BSD-3-Clause; upstream data rights not independently established",
                        "mahavivo": "No explicit dataset license; lexical metadata only",
                        "ecdict": "Repository MIT; third-party definitions excluded",
                        "oewn": "CC-BY-4.0; see bundled Open English WordNet notices"}[provider]
        sources.append({"id": record["id"], "revision": 1, "title": provider + " / " + path,
                        "url": record["url"], "license": license_name,
                        "usage": "attributed-content" if provider == "oewn" else "lexical-metadata-only",
                        "retrievedAt": lock["retrievedAt"], "sourceRevision": record["revision"], "sha256": record["sha256"]})
        accepted = set()
        rejected_count = 0
        if provider == "oewn":
            continue
        if provider == "ecdict":
            # Metadata enrichment for the complete learner word lists, plus tagged entries.
            candidates = []
            for row in csv.DictReader(io.StringIO(decode(data))):
                if row["word"] in words or row.get("tag", "").strip():
                    tag_map = {"cet4": "CET4", "cet6": "CET6", "ky": "NPEE", "ielts": "IELTS", "toefl": "TOEFL", "gre": "GRE", "gk": "HIGH-SCHOOL", "zk": "MIDDLE-SCHOOL"}
                    candidates.append((row["word"], [tag_map.get(t, "ECDICT-" + t) for t in row.get("tag", "").split()]))
        else:
            candidates = []
            for line_number, line in enumerate(decode(data).splitlines(), 1):
                line = line.strip()
                if not line:
                    continue
                if provider == "kyle":
                    word = line.split("\t")[0]
                elif path in ["COCA_20000.txt", "CET_4+6_edited.txt"]:
                    word = line
                else:
                    # Preserve multiword headwords before phonetic/POS delimiters.
                    word = re.split(r"\[|\t|\s+(?:n|v|a|ad|adj|adv|vt|vi|prep|pron|conj|art|num)(?:\.|(?=[\u3400-\u9fff]))|[\u3400-\u9fff]", line.lstrip('*'), maxsplit=1)[0].strip()
                    word = re.sub(r"^\d+[.)]?\s+", "", word)
                if len(word) == 1 and word.isupper() and word != "I":
                    continue
                if not valid(normalize(word)):
                    rejected_count += 1
                    rejected.append({"sourceId": record["id"], "line": line_number, "candidate": word[:100]})
                    continue
                candidates.append((word, tags_for(path)))
        for word, tags in candidates:
            entry = add(word, record["id"], tags)
            if entry:
                accepted.add(entry["id"])
            else:
                rejected_count += 1
        stats.append({"sourceId": record["id"], "uniqueHeadwords": len(accepted), "rejectedRows": rejected_count})

    # Open English WordNet has explicit sense IDs and synsets: never merge senses by spelling alone.
    root = ET.fromstring(gzip.decompress((raw / "english-wordnet-2025.xml.gz").read_bytes()))
    lexicon = root.find("Lexicon")
    synsets = {s.attrib["id"]: s for s in lexicon.findall("Synset")}
    members = defaultdict(set)
    lexical_entries = lexicon.findall("LexicalEntry")
    for lexical in lexical_entries:
        lemma = lexical.find("Lemma").attrib["writtenForm"]
        for sense in lexical.findall("Sense"):
            members[sense.attrib["synset"]].add(lemma)
    oewn_words = set()
    for lexical in lexical_entries:
        lemma = lexical.find("Lemma")
        entry = add(lemma.attrib["writtenForm"], "oewn:2025", ["WORDNET"])
        if not entry:
            continue
        oewn_words.add(entry["id"])
        entry["variants"] = sorted(set(entry["variants"] + [f.attrib["writtenForm"] for f in lexical.findall("Form")]))
        for sense in lexical.findall("Sense"):
            synset_id = sense.attrib["synset"]
            synset = synsets[synset_id]
            definition = synset.findtext("Definition")
            sid = "sense:" + hashlib.sha256(sense.attrib["id"].encode()).hexdigest()[:24]
            entry["senses"].append({"id": sid, "partOfSpeech": lemma.attrib["partOfSpeech"], "sourceIds": ["oewn:2025"],
                "definition": definition, "simpleDefinition": None,
                "examples": [e.text for e in synset.findall("Example") if e.text],
                "synonyms": sorted(members[synset_id] - {lemma.attrib["writtenForm"]}),
                "synonymNote": None, "collocations": [], "status": "reference"})
        entry["status"] = "reference" if entry["senses"] else "headword-only"
    stats.append({"sourceId": "oewn:2025", "uniqueHeadwords": len(oewn_words)})
    ordered = sorted(words.values(), key=lambda entry: (entry["headword"].casefold(), entry["headword"]))
    for word in ordered:
        word["senses"].sort(key=lambda sense: sense["id"])
    pack = {"schemaVersion": 1, "packId": "vocab:collected", "packVersion": 1,
            "createdAt": lock["retrievedAt"], "requires": [], "sources": sources,
            "vocabulary": ordered, "passages": [], "questions": []}
    out = ROOT / "data/vocabulary.json"
    out.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    senses = [s for w in ordered for s in w["senses"]]
    report = {"headwords": len(ordered), "senses": len(senses), "headwordOnly": sum(not w["senses"] for w in ordered),
              "sensesWithExamples": sum(bool(s["examples"]) for s in senses),
              "sensesWithSynonyms": sum(bool(s["synonyms"]) for s in senses), "readySenses": 0,
              "bytes": out.stat().st_size, "tags": dict(sorted(Counter(t for w in ordered for t in w["tags"]).items())),
              "sources": stats,
              "limitations": ["WordNet glosses and examples are reference material, not reviewed simple-English learning cards.",
                              "Exam tags reflect community lists, not official exam guarantees or CEFR levels.",
                              "Case-sensitive headwords are kept distinct to avoid merging US/us or Polish/polish.",
                              "ECDICT contributes tagged entries and metadata for existing headwords; its full technical dictionary is not imported.",
                              "Raw source bytes are locked and checksummed; unlicensed third-party prose is not copied into the corpus."]}
    (ROOT / "data/collection-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (ROOT / "data/rejected-rows.json").write_text(json.dumps(rejected, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ["sources", "limitations"]}))


if __name__ == "__main__":
    build()
