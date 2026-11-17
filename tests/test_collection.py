"""Checks real collection output, not synthetic data volume claims."""
import gzip
import hashlib
import json
import unittest
from pathlib import Path
from scripts.build_vocabulary import decode, normalize, valid, word_id

ROOT = Path(__file__).resolve().parents[1]


class CollectionTests(unittest.TestCase):
    def test_normalization_keeps_meaningful_case_and_punctuation(self):
        self.assertEqual(normalize("  take   off "), "take off")
        self.assertEqual(normalize("don’t"), "don't")
        self.assertNotEqual(word_id("US"), word_id("us"))
        self.assertNotEqual(word_id("long-term"), word_id("long term"))
        self.assertFalse(valid("*abbey"))
        self.assertFalse(valid("word [phonetic]"))

    def test_source_encoding(self):
        self.assertEqual(decode("word \u4e2d\u6587".encode("gb18030")), "word \u4e2d\u6587")
        self.assertEqual(decode("word \u4e2d\u6587".encode("utf-16")), "word \u4e2d\u6587")

    def test_real_dataset_integrity(self):
        with gzip.open(ROOT / "data/vocabulary.json.gz", "rt", encoding="utf-8") as source:
            pack = json.load(source)
        words = pack["vocabulary"]
        self.assertGreater(len(words), 100000)
        self.assertEqual(len({w["id"] for w in words}), len(words))
        self.assertEqual(len({w["headword"] for w in words}), len(words))
        senses = [s for w in words for s in w["senses"]]
        self.assertEqual(len({s["id"] for s in senses}), len(senses))
        self.assertTrue(all(w["cefr"] is None for w in words))
        self.assertTrue(all(s["simpleDefinition"] is None and s["status"] == "reference" for s in senses))
        tags = {tag for w in words for tag in w["tags"]}
        self.assertTrue({"IELTS", "TOEFL", "CET4", "CET6", "GRE", "SAT", "GMAT"} <= tags)
        index = {w["headword"]: w for w in words}
        self.assertTrue(index["contingent"]["senses"])
        self.assertNotIn("accommodation n", index)
        self.assertNotIn("confused adj", index)
        self.assertTrue(any(s["synonyms"] for s in index["happy"]["senses"]))
        report = json.loads((ROOT / "data/collection-report.json").read_text())
        self.assertEqual(report["baselineHeadwords"], len(words))

    def test_expansion_integrity_and_historical_compatibility(self):
        with gzip.open(ROOT / "data/vocabulary.json.gz", "rt", encoding="utf-8") as source:
            baseline = json.load(source)
        originals = {word["id"]: word for word in baseline["vocabulary"]}
        source_ids = {source["id"] for source in baseline["sources"]}
        count = len(originals)
        senses = sum(len(word["senses"]) for word in originals.values())
        headword_only = sum(not word["senses"] for word in originals.values())
        visited = set()
        packages = []
        added = updated = 0
        inventory = json.loads((ROOT / "data/vocabulary-expansion.manifest.json").read_text())
        archive = ROOT / "data" / inventory["archive"]
        with archive.open("rb") as source:
            self.assertEqual(hashlib.file_digest(source, "sha256").hexdigest(), inventory["sha256"])
        with gzip.open(archive, "rt", encoding="utf-8") as source:
            for line in source:
                pack = json.loads(line)
                self.assertEqual(pack["packVersion"], 1)
                expected_dependency = packages[-1] if packages else baseline["packId"]
                self.assertEqual(pack["requires"], [{"packId": expected_dependency, "minVersion": 1}])
                packages.append(pack["packId"])
                source_ids.update(source["id"] for source in pack["sources"])
                for word in pack["vocabulary"]:
                    self.assertNotIn(word["id"], visited)
                    visited.add(word["id"])
                    self.assertTrue(valid(word["headword"]))
                    self.assertEqual(word["id"], word_id(word["headword"]))
                    self.assertTrue(set(word["sourceIds"]) <= source_ids)
                    previous = originals.get(word["id"])
                    if previous:
                        updated += 1
                        self.assertEqual(word["revision"], previous["revision"] + 1)
                        if previous["senses"]:
                            self.assertEqual(word["senses"], previous["senses"])
                        senses -= len(previous["senses"])
                        headword_only -= not previous["senses"]
                    else:
                        added += 1
                        count += 1
                        self.assertEqual(word["revision"], 1)
                    senses += len(word["senses"])
                    headword_only += not word["senses"]
                    for sense in word["senses"]:
                        self.assertEqual(sense["status"], "reference")
                        self.assertIsNone(sense["simpleDefinition"])
                        self.assertTrue(set(sense["sourceIds"]) <= source_ids)
                        self.assertNotRegex(sense["definition"] or "", r"[\u3400-\u9fff]")
        report = json.loads((ROOT / "data/collection-report.json").read_text())
        self.assertEqual(packages, [pack["packId"] for pack in inventory["packs"]])
        self.assertEqual(report["headwords"], count)
        self.assertEqual(report["senses"], senses)
        self.assertEqual(report["headwordOnly"], headword_only)
        self.assertEqual(report["expansion"], {"updated": updated, "added": added})
        self.assertGreater(added, 700000)


if __name__ == "__main__":
    unittest.main()
