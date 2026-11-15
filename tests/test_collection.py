"""Checks real collection output, not synthetic data volume claims."""
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
        self.assertEqual(decode("word 中文".encode("gb18030")), "word 中文")
        self.assertEqual(decode("word 中文".encode("utf-16")), "word 中文")

    def test_real_dataset_integrity(self):
        pack = json.loads((ROOT / "data/vocabulary.json").read_text(encoding="utf-8"))
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
        self.assertEqual(report["headwords"], len(words))
        self.assertEqual(report["senses"], len(senses))


if __name__ == "__main__":
    unittest.main()
