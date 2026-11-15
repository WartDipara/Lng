"""Build the original, self-contained learning course shipped with the offline app."""
import base64
import json
import re
import struct
import zlib
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOW = "2026-11-15T00:00:00Z"
AUTHOR = "course:original"

# headword | POS | plain-English meaning | two examples | near synonym | distinction | collocation
WORDS = """
contingent|adjective|Only possible if another thing happens first.|The grant is contingent on final approval.|Our trip is contingent on the weather.|dependent|Contingent on usually introduces a condition; dependent on can also describe a continuing need.|contingent on approval
equivocal|adjective|Not clear enough to show one definite meaning or opinion.|Her equivocal reply left both teams unsure.|The results were equivocal, so we ran another test.|unclear|Equivocal often suggests two possible readings; unclear can simply mean hard to understand.|equivocal evidence
mitigate|verb|To make something harmful less serious.|Trees can mitigate the heat in a crowded street.|The extra checks helped mitigate the risk.|reduce|Mitigate usually concerns harm or risk; reduce can concern any amount.|mitigate a risk
corroborate|verb|To give further evidence that a statement is true.|The receipts corroborate her account of the journey.|Two witnesses corroborate the driver's description.|support|Corroborate specifically means supporting a claim with evidence.|corroborate an account
substantiate|verb|To provide evidence that shows a claim has a sound basis.|The company could not substantiate its promise.|We need data to substantiate the conclusion.|support|Substantiate stresses providing a basis; corroborate adds evidence to an existing account.|substantiate a claim
undermine|verb|To make something weaker or less trusted.|Repeated delays undermine trust in the service.|The missing records undermine the report's conclusion.|weaken|Undermine often describes a gradual or indirect weakening.|undermine confidence
exacerbate|verb|To make an existing problem worse.|A lack of sleep can exacerbate stress.|The sudden closure may exacerbate traffic problems.|worsen|Exacerbate normally takes a problem or harmful condition as its object.|exacerbate a problem
preclude|verb|To prevent something or make it impossible.|The narrow doorway may preclude wheelchair access.|These findings do not preclude other explanations.|prevent|Preclude often means that a condition rules out a possibility.|preclude an option
supplant|verb|To take the place of something that was used before.|Digital tickets may supplant paper passes.|The new method did not supplant every older technique.|replace|Supplant suggests taking over an established role.|supplant an older method
complement|verb|To add something useful that makes another thing work better.|The diagrams complement the written guide.|Practical lessons complement the theory classes.|supplement|Complement stresses a good fit; supplement stresses adding extra material.|complement an explanation
conflate|verb|To treat different things as if they were the same.|Do not conflate low cost with good value.|The article appears to conflate income and wealth.|confuse|Conflate specifically means combining distinct ideas or categories.|conflate two issues
reconcile|verb|To find a way for apparently different ideas or needs to fit together.|We must reconcile the two accounts of the event.|The plan tries to reconcile lower costs with better care.|harmonise|Reconcile often starts with a conflict; harmonise may simply mean bringing things into agreement.|reconcile competing demands
scrutinise|verb|To examine something very carefully.|Please scrutinise the figures before signing.|The panel will scrutinise every expense claim.|examine|Scrutinise implies close attention to detail, not just looking at something.|scrutinise the evidence
elucidate|verb|To make something easier to understand by explaining it.|A simple diagram can elucidate the process.|The speaker used an example to elucidate the rule.|clarify|Elucidate is formal and usually means explaining an idea in more detail.|elucidate a point
qualify|verb|To limit a statement so that it is more exact.|I should qualify my earlier claim: the result applies only to adults.|The authors qualify their conclusion by noting the small sample.|limit|In this sense, qualify adds a condition or limit to a claim; it does not mean passing a test.|qualify a claim
concede|verb|To admit that something is true, often after resisting it.|She had to concede that the old route was faster.|The manager will concede that the service needs work.|admit|Concede often involves accepting an unwelcome point in a disagreement.|concede a point
infer|verb|To reach an idea from the information available.|We cannot infer a cause from this pattern alone.|Readers may infer that the narrator is worried.|deduce|Infer is broad; deduce often suggests a more formal chain of reasoning.|infer from evidence
attribute|verb|To say that something is caused by a particular thing.|The team cannot attribute the rise to one factor.|She chose to attribute the error to a misunderstanding.|ascribe|Attribute and ascribe both link a result to a cause; attribute is more common.|attribute a change to
discern|verb|To notice or recognise something that is not obvious.|It was hard to discern a pattern in the data.|With practice, you can discern small differences in tone.|detect|Discern often involves understanding a difference, while detect can mean simply noticing a presence.|discern a pattern
tentative|adjective|Not yet certain or finally agreed.|We made a tentative plan for Friday.|The report offers only a tentative explanation.|provisional|Tentative stresses uncertainty; provisional stresses waiting for a final version.|tentative conclusion
provisional|adjective|Used for now but likely to be reviewed or changed.|The team announced a provisional timetable.|Her acceptance is provisional until the documents arrive.|temporary|Provisional usually anticipates confirmation or revision; temporary only says something will not last.|provisional approval
plausible|adjective|Seeming reasonable or possibly true.|That is a plausible explanation for the delay.|The story sounds plausible, but we need evidence.|credible|Plausible means a claim could be true; credible may imply stronger reasons to trust it.|plausible explanation
tenable|adjective|Able to be defended with good reasons.|That position is no longer tenable after the new evidence.|Is the assumption tenable in a small town?|defensible|Tenable normally describes a claim or position that can withstand criticism.|tenable argument
salient|adjective|Especially important or easy to notice in the situation.|The summary should include the salient points.|Cost was the most salient concern in the discussion.|prominent|Salient stresses relevance or importance; prominent can simply mean highly visible.|salient feature
germane|adjective|Directly related to the matter being discussed.|Please raise questions that are germane to the proposal.|Her experience is germane to this debate.|relevant|Germane is a formal way to say directly relevant to the current subject.|germane to the issue
disparate|adjective|So different that they do not naturally form one group.|The project brings together disparate sources of data.|The committee must balance disparate interests.|diverse|Disparate stresses a lack of similarity; diverse may simply mean varied.|disparate groups
inadvertent|adjective|Done by accident rather than on purpose.|The omission was inadvertent, and we corrected it.|An inadvertent click closed the form.|accidental|Inadvertent often describes an action caused by a lack of attention.|inadvertent omission
negligible|adjective|So small that it has little practical effect.|The difference in travel time was negligible.|The change had a negligible effect on total costs.|tiny|Negligible means too small to matter in context, not merely small in size.|negligible effect
substantial|adjective|Large enough in amount or importance to matter.|The repair will require substantial funding.|The two versions contain substantial differences.|considerable|Substantial often suggests practical importance as well as size.|substantial change
commensurate|adjective|Matching something in size, amount or degree.|Pay should be commensurate with responsibility.|The response was not commensurate with the scale of the problem.|proportionate|Commensurate with compares levels; proportionate to often judges whether a response is suitably sized.|commensurate with experience
inherent|adjective|Existing as a basic part of something.|There are risks inherent in any new project.|The method has an inherent limit: it cannot show cause.|intrinsic|Both mean built into something; inherent often describes a quality or risk.|inherent limitation
ubiquitous|adjective|Found almost everywhere in a particular setting.|Mobile payment signs have become ubiquitous in the city.|The phrase is ubiquitous in business reports.|widespread|Ubiquitous suggests almost everywhere; widespread only means many places.|ubiquitous technology
resilient|adjective|Able to recover after difficulty or change.|A resilient system can keep working after one part fails.|The community proved resilient after the flood.|robust|Resilient stresses recovery; robust stresses strength or resistance to failure.|resilient community
stringent|adjective|Very strict and carefully enforced.|The laboratory follows stringent safety rules.|Applicants face stringent checks before approval.|strict|Stringent often describes demanding rules or standards.|stringent requirements
arbitrary|adjective|Based on no clear reason, rule or fair method.|The cut-off date seemed arbitrary.|We need consistent criteria rather than arbitrary choices.|random|Arbitrary lacks a defensible reason; random may follow a deliberate chance-based method.|arbitrary decision
ambivalent|adjective|Having both positive and negative feelings about something.|She felt ambivalent about leaving her job.|Residents remain ambivalent about the new development.|uncertain|Ambivalent means mixed feelings, not simply a lack of information.|ambivalent about change
impartial|adjective|Not favouring one side unfairly.|An impartial reviewer should assess the complaint.|The chair must remain impartial during the vote.|unbiased|Both reject unfair preference; impartial often concerns fair treatment of opposing sides.|impartial assessment
pragmatic|adjective|Focused on what can work in practice.|We need a pragmatic response to the shortage.|The team took a pragmatic approach and tested a smaller version.|practical|Pragmatic often suggests accepting workable compromises instead of insisting on an ideal.|pragmatic approach
cogent|adjective|Clear, well supported and likely to persuade.|She presented a cogent argument for the change.|The report gives a cogent explanation of the failure.|convincing|Cogent especially describes reasoning that is clear and logically strong.|cogent argument
ostensible|adjective|Stated or appearing to be the reason, though the real one may differ.|The ostensible purpose of the meeting was to discuss costs.|He visited for the ostensible reason of returning a book.|apparent|Ostensible often raises doubt about whether the stated purpose is genuine.|ostensible purpose
""".strip()


def source(id, title, url, usage="original", license="Original project content; usage controlled by project owner"):
    return {"id": id, "revision": 1, "title": title, "url": url, "license": license, "usage": usage, "retrievedAt": NOW}


def main():
    sources = [source(AUTHOR, "EngDictionary original learning course", "urn:engdictionary:original-course"),
        source("course:iea-2026", "IEA: Energy security and renewables, 6 November 2026", "https://www.iea.org/news/energy-security-concerns-spur-faster-renewables-growth-across-a-widening-constellation-of-countries", "reference-only", "Reference for a short original factual summary; article text not reproduced"),
        source("course:unesco-2026", "UNESCO: Education and AI, 9 September 2026", "https://www.unesco.org/en/articles/education-ministers-call-education-remain-common-good-age-ai-unescos-digital-learning-week", "reference-only", "Reference for a short original factual summary; article text not reproduced")]
    words = []
    for line in WORDS.splitlines():
        word, pos, definition, e1, e2, synonym, distinction, collocation = line.split('|')
        words.append({"id": "course:word-" + word, "revision": 1, "sourceIds": [AUTHOR], "headword": word, "variants": ["scrutinize"] if word == "scrutinise" else [],
            "tags": ["Core course", "Advanced usage"], "cefr": None, "status": "ready",
            "senses": [{"id": "course:sense-" + word, "partOfSpeech": pos, "sourceIds": [AUTHOR], "definition": definition, "simpleDefinition": definition,
                        "examples": [e1, e2], "synonyms": [synonym], "synonymNote": distinction, "collocations": [collocation], "status": "ready"}]})

    passages = []
    def passage(key, title, paragraphs, source_ids=None, published=None):
        item = {"id": "course:passage-" + key, "revision": 1, "sourceIds": source_ids or [AUTHOR], "title": title,
                "paragraphs": [{"id": f"course:{key}-p{i+1}", "text": p} for i, p in enumerate(paragraphs)]}
        if published: item.update({"publishedAt": published + "T00:00:00Z", "verifiedAt": NOW})
        passages.append(item)
        return item

    grid = passage("grid", "Renewables need connections", [
        "In November 2026, the IEA reported that energy security was encouraging more countries to expand renewables. Yet adding generating equipment was not enough: electricity networks also needed investment. Projects awaiting connection illustrated this constraint.",
        "The agency also highlighted storage and flexible demand. Moving some electricity use to periods of plentiful renewable supply could help systems use available generation more effectively. These measures support expansion; they do not make networks unnecessary."
    ], [AUTHOR, "course:iea-2026"], "2026-11-06")
    ai = passage("ai", "Learning remains a human concern", [
        "At UNESCO's Digital Learning Week in September 2026, education representatives called for AI to support human judgement rather than replace it. They linked potential benefits to preparation and governance, not simply to access to a tool.",
        "Their statement also stressed teacher participation in adoption decisions. This treats teachers as contributors to policy, not merely recipients of a finished product. The position permits carefully governed use without endorsing unrestricted adoption."
    ], [AUTHOR, "course:unesco-2026"], "2026-09-09")
    trial = passage("trial", "When a pilot looks successful", [
        "Fictional case study. A city tested later library opening hours at two branches for eight weeks. Evening visits rose by 18 per cent compared with the previous eight weeks. The period also included university examinations. The evaluation team therefore described the increase as encouraging but could not attribute it solely to the new hours.",
        "Maya, the service manager, wanted to extend the trial before committing to permanent staffing costs. Arun, the finance officer, asked for the cost per additional visit and warned that high attendance alone would not establish value for money. Leila, a community organiser, requested a survey of people who had not attended; current visitors could not represent everyone who might need the service.",
        "The next phase will add two comparison branches that retain their normal hours. Both groups will record visits using the same method. The team will publish the results after twelve weeks. A decision on permanent opening hours is contingent on that review; no permanent change has yet been approved."
    ])
    repair = passage("repair", "A repair service changes its rules", [
        "Fictional case study. A community workshop accepts small household devices for assessment. Customers first submit a description of the fault. A technician then inspects the item and provides a written estimate. Repairs begin only after the customer approves that estimate. If parts cannot be obtained, the workshop returns the item without carrying out a repair.",
        "A proposed notice says, 'Every device will be fixed within seven days.' The coordinator rejects it because neither parts nor successful repair can be guaranteed. She instead proposes, 'We aim to assess each item within seven days and will contact you before any chargeable repair.' The deadline concerns assessment, not completion.",
        "The service charges a five-pound assessment fee, payable even if repair is not possible. That fee is deducted from the final bill when a repair goes ahead. A volunteer suggests hiding the fee in small print to make the notice shorter. The coordinator objects: brevity should not obscure a condition that affects a customer's decision."
    ])
    questions = []
    def add(key, kind, prompt, interaction, explanation, p=None, evidence=None, senses=None, **extra):
        item = {"id": "course:q-" + key, "revision": 1, "sourceIds": [AUTHOR], "type": kind, "origin": "original",
                "title": key.replace('-', ' ').capitalize(), "instructions": "Use the supplied text. Choose the best-supported answer." if interaction['kind'] == 'choice' else "Complete the task using the supplied information.",
                "prompt": prompt, "interaction": interaction, "explanation": explanation, "evidenceParagraphIds": [], "senseIds": senses or [], "tags": ["Core course", kind], **extra}
        if p: item.update({"passageId": p['id'], "passageRevision": 1, "evidenceParagraphIds": [p['paragraphs'][i]['id'] for i in (evidence or [0])]})
        questions.append(item)
        return item
    def choice(options, correct=0, multiple=False):
        answers = correct if isinstance(correct, list) else [correct]
        return {"kind": "choice", "options": [{"id": f"course:option-{i}", "text": text} for i, text in enumerate(options)], "correctIds": [f"course:option-{i}" for i in answers], "multiple": multiple}
    def text(fields):
        return {"kind": "text", "fields": [{"id": "course:field-" + key, "prompt": prompt, "accepted": accepted if isinstance(accepted, list) else [accepted], "caseSensitive": False, "maxWords": limit} for key, prompt, accepted, limit in fields]}
    def match(prompts, options, pairs, reuse=False):
        return {"kind": "matching", "prompts": [{"id": f"course:item-{i}", "text": t} for i,t in enumerate(prompts)], "options": [{"id": f"course:match-{i}", "text": t} for i,t in enumerate(options)], "pairs": [{"promptId": f"course:item-{i}", "optionId": f"course:match-{answer}"} for i,answer in enumerate(pairs)], "reuseOptions": reuse}

    add("grid-main-point", "comprehension", "What is the main point?", choice(["Expansion also needs supporting systems.", "Networks are no longer needed.", "Renewables remove every constraint.", "Storage prevents new construction."]), "Generating capacity alone does not solve the connection constraint.", grid, [0,1])
    add("grid-short-answer", "short-answer", "Which measure, besides storage, can improve use of available generation? Use TWO WORDS.", text([("a", "Measure", "flexible demand", 2)]), "The second paragraph names flexible demand.", grid, [1])
    add("ai-main-point", "comprehension", "Which description fits the position?", choice(["Conditional support", "A complete ban", "Unrestricted adoption", "Teacher exclusion"]), "Benefits are linked to preparation and governance.", ai, [0,1])
    add("ai-participation", "sentence-completion", "Teachers should participate in {{course:field-a}} decisions. Use ONE WORD from the text.", text([("a", "Type of decision", "adoption", 1)]), "The second paragraph specifies adoption decisions.", ai, [1])
    add("trial-cause", "comprehension", "Why can the rise in visits not be attributed solely to the new hours?", choice(["The comparison period had more branches.", "Examinations also occurred during the trial.", "Visits were never counted.", "The branches had already closed."], 1), "Examinations are another possible explanation. The text does not establish their exact effect, so a single cause cannot be isolated.", trial)
    add("trial-multiple", "comprehension", "Choose TWO features of the next phase.", choice(["Comparison branches", "Guaranteed permanent funding", "A shared recording method", "A survey limited to managers"], [0,2], True), "Paragraph 3 explicitly adds comparison branches and a common recording method. Permanent change is not approved.", trial, [2])
    add("trial-fact", "true-false-not-given", "The first trial lasted twelve weeks.", choice(["True", "False", "Not Given"], 1), "The first trial lasted eight weeks; twelve weeks refers to the next phase.", trial, [0,2])
    add("trial-unknown", "true-false-not-given", "Most evening visitors were university students.", choice(["True", "False", "Not Given"], 2), "Examinations are mentioned, but the visitors' identities and proportions are not stated.", trial)
    add("repair-view", "yes-no-not-given", "The coordinator believes that a shorter notice is always better, even if a fee is less clear.", choice(["Yes", "No", "Not Given"], 1), "She objects to hiding the fee: clear conditions matter more than brevity in that case.", repair, [2])
    add("repair-unknown-view", "yes-no-not-given", "The coordinator believes that the assessment fee should be increased next year.", choice(["Yes", "No", "Not Given"], 2), "Her view about communicating the fee is stated; her view about changing its amount is not.", repair, [2])
    add("trial-headings", "matching-headings", "Match each paragraph to its best heading.", match(["Paragraph 1", "Paragraph 2", "Paragraph 3"], ["Questions from different perspectives", "A stronger follow-up design", "An increase with an uncertain cause", "An unconditional promise"], [2,0,1]), "Paragraph 1 qualifies the increase, paragraph 2 presents three perspectives, and paragraph 3 sets out the next phase.", trial, [0,1,2])
    add("repair-information", "matching-information", "Where is each piece of information found? You may use a paragraph more than once.", match(["A payment that applies even without repair", "The point at which permission is needed", "A distinction between assessment and completion"], ["Paragraph 1", "Paragraph 2", "Paragraph 3"], [2,0,1], True), "The fee appears in paragraph 3, customer approval in paragraph 1, and the deadline distinction in paragraph 2.", repair, [0,1,2])
    add("trial-people", "matching-features", "Match each concern to its speaker.", match(["Costs relative to extra visits", "People missing from the current visitor group", "Avoiding an early permanent commitment"], ["Maya", "Arun", "Leila"], [1,2,0]), "Arun asks about cost per visit, Leila about non-attenders, and Maya about extending the trial before committing.", trial, [1])
    add("repair-endings", "matching-sentence-endings", "Complete each sentence with the correct ending.", match(["Repairs can begin when", "The item is returned without repair if", "The assessment fee is deducted when"], ["the customer approves the estimate.", "parts cannot be obtained.", "a repair goes ahead.", "a volunteer shortens the notice."], [0,1,2]), "Each ending preserves an explicit condition in the workshop's process.", repair, [0,2])
    add("trial-summary", "summary-completion", "Complete the summary using ONE WORD per gap: The increase was encouraging, but {{course:field-a}} may also have affected visits. Permanent changes remain contingent on a {{course:field-b}}.", text([("a", "Possible outside factor", "examinations", 1), ("b", "Required next step", "review", 1)]), "Examinations occurred during the trial, and the final paragraph makes permanent change conditional on review.", trial, [0,2])
    add("repair-notes", "note-completion", "Complete the notes using NO MORE THAN TWO WORDS per gap: Before inspection, submit a description of the {{course:field-a}}. Before repair, approve the written {{course:field-b}}.", text([("a", "Description concerns", "fault", 2), ("b", "Document to approve", "estimate", 2)]), "The process starts with a description of the fault and requires approval of the estimate before work begins.", repair)
    add("trial-table", "table-completion", "Complete the table with ONE NUMBER or ONE WORD in each gap.", text([("a", "First trial duration", ["eight", "8"], 1), ("b", "Next phase duration", ["twelve", "12"], 1)]), "The original trial lasts eight weeks; the next phase lasts twelve.", trial, [0,2], layout={"kind":"table","rows":[["Phase","Duration in weeks"],["First trial","{{course:field-a}}"],["Next phase","{{course:field-b}}"]]})
    add("repair-flow", "flowchart-completion", "Complete the process using ONE WORD in each gap.", text([("a", "Technician's document", "estimate", 1), ("b", "Person who gives permission", "customer", 1)]), "The technician supplies the estimate. The customer must approve it before repair starts.", repair, layout={"kind":"flowchart","steps":["Submit fault description","Receive written {{course:field-a}}","Obtain approval from the {{course:field-b}}","Begin repair"]})

    # Original three-box process diagram, generated with stdlib PNG writing.
    width, height = 600, 160
    pixels = bytearray([255] * (width * height * 3))
    for left in [20,220,420]:
        for y in range(35,125):
            for x in range(left,left+160):
                offset=(y*width+x)*3
                pixels[offset:offset+3]=bytes((221,237,241) if 3 < x-left < 157 and 38 < y < 122 else (24,62,79))
    for left in [180,380]:
        for y in range(77,83):
            for x in range(left,left+40):
                pixels[(y*width+x)*3:(y*width+x)*3+3]=bytes((24,62,79))
    raw=b''.join(b'\0'+pixels[y*width*3:(y+1)*width*3] for y in range(height))
    def chunk(t,d): return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
    add("repair-diagram", "diagram-labelling", "The three boxes show what happens after the initial fault description. Label them from left to right with ONE WORD each: the technician's inspection, the customer's approval, then the repair.", text([("a","Left box","inspection",1),("b","Middle box","approval",1),("c","Right box","repair",1)]), "Inspection comes first, customer approval follows the estimate, and repair can then begin.", repair, layout={"kind":"diagram","imageDataUri":"data:image/png;base64,"+base64.b64encode(png).decode(),"altText":"Three empty boxes connected from left to right.","labels":[{"fieldId":"course:field-a","x":.167,"y":.5},{"fieldId":"course:field-b","x":.5,"y":.5},{"fieldId":"course:field-c","x":.833,"y":.5}]})
    add("trial-short", "short-answer", "What measure did Arun request? Use NO MORE THAN FOUR WORDS from the passage.", text([("a", "Requested cost measure", "cost per additional visit", 4)]), "Arun requests cost per additional visit rather than attendance alone.", trial, [1])
    add("agreement-error", "error-identification", "Select the erroneous segment: Each of the estimates / have been checked / by a second reviewer.", choice(["Each of the estimates", "have been checked", "by a second reviewer"],1), "Each is singular, so the verb should be has been checked. Of the estimates does not make the subject plural.")
    add("inversion-error", "error-identification", "Select the erroneous segment: Not until the audit ended / the committee released / its findings.", choice(["Not until the audit ended", "the committee released", "its findings"],1), "After an initial negative time phrase, use inversion in the main clause: did the committee release.")
    add("paragraph-precision", "paragraph-improvement", "Replace this overstatement: 'Visits rose during the trial. Therefore, the longer hours caused the entire rise.'", choice(["Visits rose during the trial, but the available comparison does not isolate the effect of longer hours.", "Visits rose, proving that every library needs longer hours.", "Visits rose, so examinations had no effect.", "Visits rose; therefore, the data are worthless."]), "The first revision preserves the observed increase while limiting the causal claim. The other versions add unsupported conclusions.", trial)
    add("paragraph-order", "paragraph-improvement", "Arrange the sentences into a coherent paragraph.", {"kind":"ordering","items":[{"id":"course:sentence-a","text":"The workshop received several complaints about unclear charges."},{"id":"course:sentence-b","text":"To investigate them, the coordinator reviewed the notice."},{"id":"course:sentence-c","text":"She found that the assessment fee appeared only in small print."},{"id":"course:sentence-d","text":"She therefore moved that condition beside the booking instructions."}],"correctOrder":["course:sentence-a","course:sentence-b","course:sentence-c","course:sentence-d"]}, "The complaints establish the problem, the review investigates it, the finding identifies the cause, and the final sentence gives the response.")
    add("condition-cloze", "multiple-choice-cloze", "The extension is contingent ___ an independent review.", choice(["at", "by", "on", "from"],2), "The fixed pattern is contingent on, meaning dependent on a condition.", senses=["course:sense-contingent"])
    add("open-cloze", "open-cloze", "Complete with ONE WORD: No sooner had the report appeared {{course:field-a}} questions arose about its methods.", text([("a","Missing conjunction","than",1)]), "No sooner is paired with than. The first clause already contains the required inversion.")
    add("word-formation", "word-formation", "Use RELY: The committee questioned the {{course:field-a}} of the figures.", text([("a","Noun from RELY","reliability",1)]), "The noun reliability fits after the and before of. Reliable is an adjective and cannot fill this noun position.")
    add("key-word-change", "key-word-transformation", "Use ACCOUNT without changing it. 'The panel ignored the cost.' Complete: The panel failed to {{course:field-a}}. Use FIVE WORDS.", text([("a","Missing phrase","take the cost into account",5)]), "Take something into account means consider it. Failed to preserves the meaning that the cost was ignored.")
    add("dialogue-evidence", "dialogue", "A colleague asks, 'May I call this result conclusive?' The study has only ten participants. Choose the most careful reply.", choice(["Certainly; a small study proves every case.", "I would qualify that claim until we have stronger evidence.", "The claim is irrelevant because no small study has value.", "No further evidence could ever help."],1), "Qualifying the claim acknowledges the limitation without dismissing the study or ruling out later evidence.", senses=["course:sense-qualify"])
    add("scenario-notice", "scenario", "You must publish the workshop's service notice. Which wording is consistent with its rules?", choice(["Every item is repaired free within seven days.", "Assessment normally precedes a written estimate; repair requires your approval.", "Approval is assumed once an item arrives.", "The assessment fee applies only to successful repairs."],1), "The second option preserves the process. The others invent guarantees, remove consent or misstate the fee.", repair, [0,1,2])

    # Contextual vocabulary retrieval, one unique authored item for each course sense.
    for index, word in enumerate(words):
        sense = word['senses'][0]
        same_pos = [w for w in words if w['senses'][0]['partOfSpeech'] == sense['partOfSpeech'] and w['id'] != word['id']]
        wrong = [same_pos[(index+j*3) % len(same_pos)]['headword'] for j in range(3)]
        # The definition, rather than a loose synonym, makes the intended sense explicit.
        options = wrong[:]
        answer_index = index % 4
        options.insert(answer_index, word['headword'])
        sentence = re.sub(r'\b'+re.escape(word['headword'])+r'\b', '____', sense['examples'][0], flags=re.IGNORECASE)
        assert sentence != sense['examples'][0], word['headword']
        q = add('vocab-'+word['headword'], 'multiple-choice-cloze', sentence+'\n\nMeaning required: '+sense['simpleDefinition'], choice(options,answer_index), word['headword'].capitalize()+' fits this meaning. '+sense['synonymNote'], senses=[sense['id']])
        q['title'] = word['headword'].capitalize()+' in use'
        q['instructions'] = 'Complete the sentence. Use the meaning clue to select the precise word.'
    pack = {"schemaVersion":1,"packId":"course:starter","packVersion":1,"createdAt":NOW,"requires":[],"sources":sources,"vocabulary":words,"passages":passages,"questions":questions}
    (ROOT/'data/starter.pack.json').write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({"words":len(words),"questions":len(questions),"passages":len(passages),"types":dict(Counter(q['type'] for q in questions))}))


if __name__=='__main__': main()

