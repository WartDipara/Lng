"""Small original fixtures illustrating every supported type, not exam papers."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOW = "2026-11-15T00:00:00Z"


def choice(options, answer=0):
    return {"kind": "choice", "options": [{"id": f"option:{i}", "text": t} for i, t in enumerate(options)],
            "correctIds": [f"option:{answer}"], "multiple": False}


def text(prompt, answer, limit=2):
    return {"kind": "text", "fields": [{"id": "field:answer", "prompt": prompt, "accepted": [answer], "caseSensitive": False, "maxWords": limit}]}


def main():
    source = {"id": "example:author", "revision": 1, "title": "Original format examples (fictional)",
              "url": "https://example.invalid/engdictionary", "license": "CC0-1.0", "usage": "original", "retrievedAt": NOW}
    word = {"id": "example:contingent", "revision": 1, "sourceIds": [source["id"]], "headword": "contingent",
            "variants": [], "tags": ["FORMAT-EXAMPLE"], "cefr": None, "status": "ready",
            "senses": [{"id": "example:contingent-dependent", "partOfSpeech": "adjective", "sourceIds": [source["id"]],
                        "definition": "Dependent on a condition being met.", "simpleDefinition": "Only possible if something else happens first.",
                        "examples": ["The trip is contingent on good weather.", "The grant is contingent on final approval."],
                        "synonyms": ["dependent"], "synonymNote": "Use contingent on when a result needs a condition to be met.",
                        "collocations": ["contingent on approval"], "status": "ready"}]}
    passage = {"id": "example:library", "revision": 1, "sourceIds": [source["id"]], "title": "A library trial",
               "paragraphs": [{"id": "paragraph:trial", "text": "A town library will test longer opening hours for six weeks. On Tuesdays it will close at eight rather than six. The extra hours depend on volunteers being available. The manager will count evening visits before deciding whether to continue."},
                              {"id": "paragraph:view", "text": "The manager believes the trial could help workers who finish late, but warns that a small rise in visits would not by itself prove that permanent funding is worthwhile."}]}
    questions = []

    def add(kind, prompt, interaction, explanation, **extra):
        q = {"id": "example:" + kind, "revision": 1, "sourceIds": [source["id"]], "type": kind,
             "origin": "original", "title": kind.replace("-", " ").title(), "instructions": "Complete the task using the supplied text.",
             "prompt": prompt, "interaction": interaction, "explanation": explanation,
             "evidenceParagraphIds": [], "senseIds": [], "tags": ["FORMAT-EXAMPLE"], **extra}
        questions.append(q)
        return q

    reference = {"passageId": passage["id"], "passageRevision": 1, "evidenceParagraphIds": ["paragraph:trial"]}
    add("comprehension", "What must happen before the extra hours can be offered?", choice(["Volunteers must be available.", "Permanent funding must already be approved.", "Every worker must visit.", "Visits must double."]), "The trial depends on volunteers being available.", **reference)
    add("error-identification", "Which part contains an error: The manager / have counted / the visits?", choice(["The manager", "have counted", "the visits"], 1), "Manager is singular, so use has counted.")
    add("sentence-completion", "The trial will last {{field:answer}} weeks.", text("Number of weeks", "six", 1), "The first sentence specifies six weeks.", **reference)
    add("paragraph-improvement", "Put the sentences into a logical order.", {"kind": "ordering", "items": [{"id": "sentence:a", "text": "The library starts a trial."}, {"id": "sentence:b", "text": "During it, staff count visits."}, {"id": "sentence:c", "text": "They then use those figures to decide what to do next."}], "correctOrder": ["sentence:a", "sentence:b", "sentence:c"]}, "The trial starts, visits are counted, and the results inform the decision.")
    add("true-false-not-given", "The library normally closes at six on Tuesdays.", choice(["True", "False", "Not Given"]), "Eight rather than six identifies the usual closing time.", **reference)
    add("yes-no-not-given", "The manager thinks a small rise in visits would prove the value of permanent funding.", choice(["Yes", "No", "Not Given"], 1), "The manager explicitly warns against that conclusion.", passageId=passage["id"], passageRevision=1, evidenceParagraphIds=["paragraph:view"])
    for kind in ["matching-headings", "matching-information", "matching-features", "matching-sentence-endings"]:
        content = {
            "matching-headings": ("Paragraph 1", "A limited trial", "A permanent service"),
            "matching-information": ("The length of the trial", "Paragraph 1", "Paragraph 2"),
            "matching-features": ("Warns against drawing a firm conclusion", "The manager", "The volunteers"),
            "matching-sentence-endings": ("The library can offer extra hours if", "volunteers are available.", "the trial has ended.")
        }[kind]
        add(kind, "Match the item to the best option.", {"kind": "matching", "prompts": [{"id": "item:a", "text": content[0]}], "options": [{"id": "match:a", "text": content[1]}, {"id": "match:b", "text": content[2]}], "pairs": [{"promptId": "item:a", "optionId": "match:a"}], "reuseOptions": False}, "The correct match follows the stated plan or the manager's stated view.", passageId=passage["id"], passageRevision=1, evidenceParagraphIds=["paragraph:trial", "paragraph:view"])
    for kind in ["summary-completion", "note-completion", "table-completion", "flowchart-completion", "short-answer"]:
        q = add(kind, "What will the manager count before deciding whether to continue?", text("The manager will count {{field:answer}}.", "evening visits"), "The passage says the manager will count evening visits.", **reference)
        if kind == "table-completion": q["layout"] = {"kind": "table", "rows": [["Decision input", "{{field:answer}}"]]}
        if kind == "flowchart-completion": q["layout"] = {"kind": "flowchart", "steps": ["Start trial", "Count {{field:answer}}", "Decide whether to continue"]}
    add("diagram-labelling", "Label the shaded square with the word square.", text("Shape", "square", 1), "The image contains one square.", layout={"kind": "diagram", "imageDataUri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "altText": "A single shaded square.", "labels": [{"fieldId": "field:answer", "x": 0.5, "y": 0.5}]})
    add("multiple-choice-cloze", "The extension is contingent ___ volunteer support.", choice(["on", "at", "by", "from"]), "The usual phrase is contingent on.", senseIds=["example:contingent-dependent"])
    add("open-cloze", "The trial will proceed only {{field:answer}} volunteers are available.", text("Missing word", "if", 1), "Only if introduces a necessary condition.")
    add("word-formation", "Use APPROVE: The plan still needs final {{field:answer}}.", text("Form of APPROVE", "approval", 1), "Approval is the noun needed after final.")
    add("key-word-transformation", "Use DEPENDS: The plan is contingent on support. The plan {{field:answer}} support.", text("Two words including DEPENDS", "depends on"), "Depends on expresses the same condition.")
    add("dialogue", "Can we call the trial a proven success before it begins?", choice(["No; we need results first.", "Yes; a plan proves the outcome."]), "A planned trial has not yet provided evidence of success.")
    add("scenario", "Volunteer availability is not yet known. Which announcement is accurate?", choice(["Extra hours depend on volunteer availability.", "Extra hours are guaranteed permanently."]), "The first announcement preserves the condition.", **reference)
    base = {"schemaVersion": 1, "packId": "example:base", "packVersion": 1, "createdAt": NOW,
            "requires": [], "sources": [source], "vocabulary": [word], "passages": [passage], "questions": questions}
    delta = {"schemaVersion": 1, "packId": "example:increment", "packVersion": 1, "createdAt": NOW,
             "requires": [{"packId": "example:base", "minVersion": 1}], "sources": [],
             "questions": [copy.deepcopy(questions[0])]}
    delta["questions"][0]["id"] = "example:comprehension-extra"
    output = ROOT / "examples"
    output.mkdir(exist_ok=True)
    target = {"kind": "question", "id": "example:comprehension", "revision": 1}
    user = {"schemaVersion": 1,
            "notes": [{"id": "note:conditions", "title": "Conditions", "body": "Check whether a promise depends on something else.", "tags": ["conditions"], "target": target, "createdAt": NOW, "updatedAt": NOW},
                      {"id": "note:freewriting", "title": "My own sentences", "body": "The trip is contingent on good weather.", "tags": ["writing"], "createdAt": NOW, "updatedAt": NOW}],
            "attempts": [{"id": "attempt:example", "kind": "question", "target": target, "answer": ["option:1"], "score": 0, "maxScore": 1, "createdAt": NOW}],
            "mistakes": [{"target": target, "attemptIds": ["attempt:example"], "mastered": False, "updatedAt": NOW}],
            "reviews": [], "settings": {"dailyNewLimit": 10, "selectedTags": []}}
    for name, value in [("base.pack.json", base), ("increment.pack.json", delta), ("notebook.user.json", user)]:
        (output / name).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
