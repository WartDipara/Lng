"""Canonical schema definitions. Regenerate with python scripts/generate_schemas.py."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
S = {"type": "string", "minLength": 1}
ID = {"type": "string", "pattern": "^[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$", "maxLength": 180}
INT = {"type": "integer", "minimum": 1}
DATE = {"type": "string", "format": "date-time"}


def arr(item, minimum=0):
    return {"type": "array", "items": item, "minItems": minimum}


def obj(props, required=None):
    return {"type": "object", "properties": props, "required": list(props) if required is None else required, "additionalProperties": False}


def enum(*values):
    return {"enum": list(values)}


def ref(name):
    return {"$ref": "#/$defs/" + name}


def entity(props, required=None):
    base = {"id": ID, "revision": INT, "sourceIds": arr(ID, 1)}
    return obj(base | props, list(base) + (list(props) if required is None else required))


def build():
    defs = {}
    defs["source"] = obj({"id": ID, "revision": INT, "title": S, "url": {"type": "string", "format": "uri"},
                          "license": S, "usage": enum("lexical-metadata-only", "attributed-content", "original", "reference-only"),
                          "retrievedAt": DATE, "sourceRevision": S, "sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"}},
                         ["id", "revision", "title", "url", "license", "usage", "retrievedAt"])
    defs["sense"] = obj({"id": ID, "partOfSpeech": S, "sourceIds": arr(ID, 1),
                         "definition": {"type": ["string", "null"]}, "simpleDefinition": {"type": ["string", "null"]},
                         "examples": arr(S), "synonyms": arr(S), "synonymNote": {"type": ["string", "null"]},
                         "collocations": arr(S), "status": enum("reference", "draft", "ready")})
    defs["word"] = entity({"headword": S, "variants": arr(S), "tags": arr(S),
                           "cefr": enum(None, "A1", "A2", "B1", "B2", "C1", "C2"), "senses": arr(ref("sense")),
                           "status": enum("headword-only", "reference", "draft", "ready")})
    defs["passage"] = entity({"title": S, "paragraphs": arr(obj({"id": ID, "text": S}), 1),
                              "publishedAt": DATE, "verifiedAt": DATE}, ["title", "paragraphs"])
    defs["target"] = obj({"kind": enum("question", "sense"), "id": ID, "revision": INT})
    defs["option"] = obj({"id": ID, "text": S})
    defs["choice"] = obj({"kind": enum("choice"), "options": arr(ref("option"), 2), "correctIds": arr(ID, 1), "multiple": {"type": "boolean"}})
    defs["text"] = obj({"kind": enum("text"), "fields": arr(obj({"id": ID, "prompt": S, "accepted": arr(S, 1),
                            "caseSensitive": {"type": "boolean"}, "maxWords": INT}), 1)})
    defs["matching"] = obj({"kind": enum("matching"), "prompts": arr(ref("option"), 1), "options": arr(ref("option"), 1),
                              "pairs": arr(obj({"promptId": ID, "optionId": ID}), 1), "reuseOptions": {"type": "boolean"}})
    defs["ordering"] = obj({"kind": enum("ordering"), "items": arr(ref("option"), 2), "correctOrder": arr(ID, 2)})
    types = ["comprehension", "error-identification", "sentence-completion", "paragraph-improvement", "true-false-not-given", "yes-no-not-given", "matching-headings", "matching-information", "matching-features", "matching-sentence-endings", "summary-completion", "note-completion", "table-completion", "flowchart-completion", "diagram-labelling", "short-answer", "multiple-choice-cloze", "open-cloze", "word-formation", "key-word-transformation", "dialogue", "scenario"]
    defs["question"] = entity({"type": enum(*types), "origin": enum("original", "official-sample", "past-paper"),
        "title": S, "instructions": S, "prompt": S, "passageId": ID, "passageRevision": INT,
        "interaction": {"oneOf": [ref(x) for x in ["choice", "text", "matching", "ordering"]]},
        "explanation": S, "optionExplanations": {"type": "object", "additionalProperties": S},
        "evidenceParagraphIds": arr(ID), "senseIds": arr(ID), "tags": arr(S),
        "layout": obj({"kind": enum("table", "flowchart", "diagram"), "rows": arr(arr(S)),
                       "steps": arr(S), "imageDataUri": {"type": "string", "pattern": "^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+=*$"},
                       "altText": S, "labels": arr(obj({"fieldId": ID, "x": {"type": "number", "minimum": 0, "maximum": 1}, "y": {"type": "number", "minimum": 0, "maximum": 1}}))}, ["kind"]),
        "exam": obj({"name": S, "year": {"type": "integer", "minimum": 1900, "maximum": 2200}, "reference": S}, ["name", "reference"])},
        ["type", "origin", "title", "instructions", "prompt", "interaction", "explanation", "evidenceParagraphIds", "senseIds", "tags"])
    pack = obj({"schemaVersion": {"const": 1}, "packId": ID, "packVersion": INT, "createdAt": DATE,
                "requires": arr(obj({"packId": ID, "minVersion": INT})), "sources": arr(ref("source")),
                "vocabulary": arr(ref("word")), "passages": arr(ref("passage")), "questions": arr(ref("question"))},
               ["schemaVersion", "packId", "packVersion", "createdAt", "requires", "sources"])
    pack.update({"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://engdictionary.local/schemas/content-pack.v1.json", "$defs": defs})
    user = obj({"schemaVersion": {"const": 1}, "notes": arr(obj({"id": ID, "title": S, "body": {"type": "string"}, "tags": arr(S),
                "target": ref("target"), "createdAt": DATE, "updatedAt": DATE}, ["id", "title", "body", "tags", "createdAt", "updatedAt"])),
        "attempts": arr(obj({"id": ID, "target": ref("target"), "kind": enum("question", "spelling", "recall"), "answer": {},
                              "score": {"type": "number", "minimum": 0}, "maxScore": INT, "createdAt": DATE})),
        "mistakes": arr(obj({"target": ref("target"), "attemptIds": arr(ID, 1), "mastered": {"type": "boolean"}, "updatedAt": DATE})),
        "reviews": arr(obj({"target": ref("target"), "dueAt": DATE, "intervalDays": {"type": "number", "minimum": 0},
                             "ease": {"type": "number", "minimum": 1.3}, "repetitions": {"type": "integer", "minimum": 0}})),
        "settings": obj({"dailyNewLimit": {"type": "integer", "minimum": 0}, "selectedTags": arr(S)})})
    user.update({"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://engdictionary.local/schemas/user-state.v1.json", "$defs": {"target": defs["target"]}})
    out = ROOT / "schemas"
    out.mkdir(exist_ok=True)
    for filename, schema in [("content-pack.v1.schema.json", pack), ("user-state.v1.schema.json", user)]:
        (out / filename).write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    build()
