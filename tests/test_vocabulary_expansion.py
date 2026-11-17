"""Focused source conversion tests, without downloading or rebuilding the corpus."""
import json
import sqlite3
import unittest
from scripts.expand_vocabulary import merge_word, reference_senses, resolve_wordlist_headword


class ExpansionTests(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.execute("CREATE TABLE words(headword TEXT PRIMARY KEY, folded TEXT, data TEXT, original TEXT)")

    def tearDown(self):
        self.connection.close()

    def test_capitalized_list_aligns_to_known_spelling_without_merging_case_sensitive_entries(self):
        for word in ["apple", "US", "us", "Aachen", "Polish", "polish"]:
            merge_word(self.connection, word, "test:base", [])
        self.assertEqual(resolve_wordlist_headword("Apple", self.connection), "apple")
        self.assertEqual(resolve_wordlist_headword("Aachen", self.connection), "Aachen")
        self.assertEqual(resolve_wordlist_headword("Us", self.connection), "us")
        self.assertEqual(resolve_wordlist_headword("Polish", self.connection), "polish")
        self.assertEqual(resolve_wordlist_headword("Zyzzogeton", self.connection), "zyzzogeton")
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM words").fetchone()[0], 6)

    def test_only_structured_english_glosses_become_reference_senses(self):
        text = "n. a small fruit\\nv. produce fruit\\nn. a small fruit\\n> an example\\nn. mixed \u4e2d\u6587\\nAn informal definition"
        senses = reference_senses("apple", text, "test:ecdict")
        self.assertEqual(len(senses), 2)
        self.assertEqual({sense["partOfSpeech"] for sense in senses}, {"n", "v"})
        self.assertTrue(all(sense["status"] == "reference" and sense["simpleDefinition"] is None for sense in senses))
        self.assertEqual(senses, reference_senses("apple", text, "test:ecdict"))

    def test_source_merge_preserves_existing_meanings_and_avoids_duplicate_sources(self):
        merge_word(self.connection, "apple", "test:wordnet", ["WORDNET"], "n. original meaning")
        original = json.loads(self.connection.execute("SELECT data FROM words").fetchone()[0])
        merge_word(self.connection, "apple", "test:ecdict", ["CET4"], "n. different meaning")
        merge_word(self.connection, "apple", "test:ecdict", ["CET4"], "n. different meaning")
        word = json.loads(self.connection.execute("SELECT data FROM words").fetchone()[0])
        self.assertEqual(word["senses"], original["senses"])
        self.assertEqual(word["id"], original["id"])
        self.assertEqual(word["sourceIds"], ["test:ecdict", "test:wordnet"])
        self.assertEqual(word["tags"], ["CET4", "WORDNET"])

    def test_bare_word_remains_searchable_without_a_fabricated_meaning(self):
        merge_word(self.connection, "zyzzyva", "test:wordlist", [])
        word = json.loads(self.connection.execute("SELECT data FROM words").fetchone()[0])
        self.assertEqual(word["status"], "headword-only")
        self.assertEqual(word["senses"], [])
        self.assertIsNone(word["cefr"])


if __name__ == "__main__":
    unittest.main()
