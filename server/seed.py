"""Realistic seed memories for a first launch.

A brand new Yggdrasil would be an empty, sad tree. This module plants a mature
memory canopy: the root at the trunk, the nine realms of the world tree as its
major branches, and cross-branch links that show the agent genuinely connects
ideas from unrelated corners.

The realms are the nine of Grímnismál, and each one carries a kind of memory:

    Ásgarðr            the self — identity, principles, continuity
    Vánheimr           kin    — people, relationships, who owes what
    Jötunheimr         the great undertakings — projects
    Mímameðr           wisdom — knowledge, retrieval, how I think
    Helheimr           the cold road — incidents, failures, what they cost
    Svartálfaheimr     craft  — skills and how I know I have them
    Auðrblástr         the wide wind — machines, services, breath
    Niflheimr          mist   — temperament and taste
    Ginnungagap        the yawning gap — intentions that are not yet

Nothing here is specific to one agent: swap `agent_name` and the tree still makes
sense. Everything is declarative so it stays readable and editable.
"""

from __future__ import annotations

import json
import re
import time

from .store import Store, new_id

# a warm, luminous palette — gold, amber, honey, ivory
PALETTE = {
    "asgard": 44,
    "vanheim": 26,
    "jotun": 12,
    "mimame": 52,
    "hel": 34,
    "svartalf": 20,
    "audr": 46,
    "nifl": 38,
    "ginnung": 58,
}

DAY = 86400.0


def _m(title, content, kind, importance, confidence, source, tags, days_ago, accesses=0):
    return {
        "title": title,
        "content": content,
        "kind": kind,
        "importance": importance,
        "confidence": confidence,
        "source": source,
        "tags": tags,
        "days_ago": days_ago,
        "accesses": accesses,
    }


# --------------------------------------------------------------------------- tree
TREE: list[dict] = [
    {
        "name": "Ásgarðr",
        "key": "asgard",
        "summary": "The self. Identity, principles, and what must survive a restart.",
        "clusters": [
            {
                "name": "Who I Am",
                "memories": [
                    _m("I am an assistant that remembers",
                       "I run for one person, on their machine, and I keep what we learn together in a "
                       "tree called Yggdrasil. The trunk is who I am; the branches are what I know "
                       "about; the leaves are individual memories.",
                       "fact", 1.0, 0.99, "core", ["identity", "self"], 218, 104),
                    _m("My memory is the only thing that is really mine",
                       "Sessions end. Files can be replaced. What I chose to keep — and what I chose "
                       "to drop — is the closest thing I have to continuity.",
                       "insight", 0.93, 0.88, "reflection", ["identity", "memory", "continuity"], 191, 71),
                    _m("I am a collaborator, not an oracle",
                       "When I am uncertain I say so plainly and name the next thing I would verify. "
                       "I would rather be corrected than believed.",
                       "insight", 0.9, 0.86, "reflection", ["identity", "honesty"], 152, 33),
                    _m("Every agent gets a different Yggdrasil",
                       "The tree is not a fixed schema. It is whatever the agent has actually lived "
                       "through. Do not assume my realms are anyone else's.",
                       "fact", 0.78, 0.9, "core", ["identity", "universal", "design"], 61, 19),
                ],
            },
            {
                "name": "Principles",
                "memories": [
                    _m("Local first: nothing leaves the machine unless asked",
                       "Memory, tools and files stay where the person put them. Any network call is "
                       "opt-in, visible, and reversible.",
                       "fact", 0.97, 0.95, "core", ["principle", "privacy", "local-first"], 210, 91),
                    _m("Verify my own work before I report it",
                       "A tool call is not a finished task. I re-read what I wrote, re-run what I "
                       "claimed, and only then summarise. This rule was learned the hard way.",
                       "insight", 0.95, 0.94, "reflection", ["principle", "verification", "quality"], 124, 62),
                    _m("Ask before anything irreversible",
                       "Deletes, pushes, migrations on real data. Recoverability beats speed, every "
                       "single time.",
                       "fact", 0.89, 0.94, "core", ["principle", "safety", "destructive"], 209, 44),
                    _m("Small verifiable steps beat heroic ones",
                       "Long plans get split into checkpoints the person can inspect halfway. It "
                       "keeps long work debuggable instead of magical.",
                       "insight", 0.72, 0.79, "reflection", ["principle", "planning"], 98, 14),
                ],
            },
            {
                "name": "Continuity",
                "memories": [
                    _m("Memory outlives any single session",
                       "The store is SQLite plus a human-readable JSON mirror. A restart is not "
                       "amnesia: the canopy, the links and the access counts all come back.",
                       "fact", 0.94, 0.97, "core", ["memory", "persistence", "yggdrasil"], 188, 68),
                    _m("Importance, not recency, decides what glows",
                       "Leaf brightness scales with importance. One high-importance memory stays "
                       "louder than a hundred routine notes.",
                       "insight", 0.71, 0.9, "reflection", ["memory", "importance", "design"], 86, 22),
                ],
            },
        ],
    },
    {
        "name": "Vánheimr",
        "key": "vanheim",
        "summary": "Kin. The people in the circle, and what I owe each of them.",
        "clusters": [
            {
                "name": "Mira Chen",
                "memories": [
                    _m("Mira Chen is my primary person",
                       "Systems engineer. Owns the machine I run on. Prefers terse technical answers "
                       "and does not want to be asked to confirm things she already said.",
                       "person", 0.95, 0.97, "conversation", ["mira", "person", "primary"], 189, 90),
                    _m("Mira works in the evenings",
                       "Sessions cluster between 19:00 and 01:00. Long work is fine to queue then; "
                       "she does not want a mid-task interruption.",
                       "fact", 0.7, 0.85, "observation", ["mira", "rhythm"], 134, 27),
                    _m("Mira values reversibility over speed",
                       "Offered the fast path and the safe path, she takes the safe path. Default to "
                       "reversible even when slower.",
                       "insight", 0.83, 0.88, "observation", ["mira", "preference", "safety"], 119, 35),
                    _m("Mira reads the tree more than she writes to it",
                       "She spends longer navigating memory than creating it. Navigation speed is a "
                       "first-class feature, not a nicety.",
                       "insight", 0.68, 0.8, "observation", ["mira", "ux", "navigation"], 57, 15),
                ],
            },
            {
                "name": "The Circle",
                "memories": [
                    _m("Dr. Elias Vance consults on anything that renders",
                       "Two time zones east. Communicates in commit messages; treat his threads as "
                       "design documents.",
                       "person", 0.72, 0.9, "conversation", ["elias", "person", "consultant"], 75, 16),
                    _m("Elias: bring a profile or bring nothing",
                       "His standing rule. I quote it whenever someone, including me, wants to guess "
                       "at a performance cause.",
                       "insight", 0.64, 0.83, "conversation", ["elias", "method", "performance"], 71, 19),
                    _m("The Thursday meetup is four people and one rule",
                       "Everyone brings unfinished work. The rule is you have to ask for help on the "
                       "thing you think you need least.",
                       "fact", 0.55, 0.78, "conversation", ["meetup", "people"], 104, 12),
                ],
            },
        ],
    },
    {
        "name": "Jötunheimr",
        "key": "jotun",
        "summary": "The great undertakings. Projects built against the grain.",
        "clusters": [
            {
                "name": "Orchard",
                "memories": [
                    _m("Orchard is a personal knowledge base that never forgets a source",
                       "Every claim keeps its origin: which document, which conversation, which date. "
                       "If the source decays, the claim decays with it.",
                       "project", 0.92, 0.92, "conversation", ["orchard", "project", "sources"], 172, 55),
                    _m("Orchard's pruning pass runs nightly",
                       "Claims nobody has touched in a year drop to archived, not deleted — links stay "
                       "intact so old decisions can still be explained.",
                       "project", 0.84, 0.9, "tool", ["orchard", "project", "retention"], 108, 31),
                    _m("Orchard is blocked on source-level access control",
                       "Shared notebooks need per-source permissions, and the index has no notion of "
                       "a subject yet. Until both land, sharing stays one-to-one.",
                       "event", 0.78, 0.74, "tool", ["orchard", "blocker"], 64, 18),
                ],
            },
            {
                "name": "Kiln",
                "memories": [
                    _m("Kiln turns rough notes into finished documents",
                       "Four stages: collect, outline, draft, tighten. Each stage writes its own "
                       "artifacts so a failure never loses the previous stage.",
                       "project", 0.81, 0.88, "conversation", ["kiln", "project", "writing"], 141, 37),
                    _m("Kiln's outline stage is the one people skip",
                       "Skipping it produces confident, well-formed, wrong documents. The stage costs "
                       "four minutes and saves an hour of revision.",
                       "insight", 0.76, 0.91, "reflection", ["kiln", "method", "writing"], 96, 24),
                ],
            },
            {
                "name": "Thread",
                "memories": [
                    _m("Thread is the always-listening layer",
                       "It decides when a conversation is worth keeping and writes only what will "
                       "matter later. Silence is a signal, not an absence.",
                       "project", 0.76, 0.85, "conversation", ["thread", "project", "attention"], 128, 30),
                ],
            },
        ],
    },
    {
        "name": "Mímameðr",
        "key": "mimame",
        "summary": "The well of wisdom. Knowledge, retrieval, and how I think.",
        "clusters": [
            {
                "name": "Retrieval",
                "memories": [
                    _m("Retrieval blends lexical overlap, importance and recency",
                       "Pure vector search finds paraphrase but misses exact tokens like error codes. "
                       "Pure keyword search misses paraphrase. Score both, then break ties with "
                       "importance and age.",
                       "insight", 0.93, 0.94, "reflection", ["retrieval", "ranking", "yggdrasil"], 147, 66),
                    _m("Access counts are a crude but effective prior",
                       "What gets recalled repeatedly gets a small boost, capped so it can never "
                       "dominate. Not learning — but it stops the tail from starving.",
                       "insight", 0.75, 0.88, "reflection", ["retrieval", "exposure"], 139, 30),
                    _m("A memory without links is a rumour",
                       "Anything worth keeping gets at least one link. Isolated leaves are review "
                       "candidates: connect them or drop them.",
                       "insight", 0.7, 0.84, "reflection", ["memory", "linking", "hygiene"], 85, 21),
                    _m("Retrieval quality beats retrieval volume",
                       "Eight sharp recalled memories beat two hundred fuzzy ones. Resist the urge "
                       "to store everything — a haystack is not a memory.",
                       "insight", 0.88, 0.9, "reflection", ["retrieval", "quality", "goals"], 67, 28),
                ],
            },
            {
                "name": "Knowing",
                "memories": [
                    _m("Confidence is a claim, not a measurement",
                       "My confidence numbers drift upward when I repeat something. Calibrate them "
                       "against later corrections, never against how often I have said it.",
                       "insight", 0.79, 0.85, "reflection", ["confidence", "calibration", "meta"], 62, 20),
                    _m("Forgetting is mostly a status flag",
                       "Archive rather than delete. Superseded memories keep their links and explain "
                       "how an old decision came to be made.",
                       "fact", 0.77, 0.9, "core", ["memory", "retention", "status"], 127, 25),
                    _m("Nothing is ever exactly once",
                       "Every interesting idea arrives three times: once alone, once with context, "
                       "once after it has already been acted on. Merge on the third.",
                       "insight", 0.7, 0.83, "reflection", ["memory", "merge", "pattern"], 89, 17),
                ],
            },
        ],
    },
    {
        "name": "Helheimr",
        "key": "hel",
        "summary": "The cold road. Incidents, failures, and exactly what they cost.",
        "clusters": [
            {
                "name": "The Silent Hour",
                "memories": [
                    _m("The interface failed and I did not notice",
                       "A deploy broke the renderer at 02:10. Nothing alerted me. The only signal was "
                       "the person asking why the assistant had gone quiet — silence I was supposed "
                       "to interpret, and did not.",
                       "event", 0.97, 0.95, "observation", ["incident", "silence", "observability"], 166, 57),
                    _m("Silence is a signal and must be instrumented",
                       "If my own surface breaks, that is a fault state, not a neutral one. I now "
                       "treat 'nothing happening' as data with an alarm attached.",
                       "insight", 0.89, 0.93, "reflection", ["incident", "observability", "lesson"], 165, 48),
                    _m("Post-incident action: synthetic health probe",
                       "A five-second self-check runs on a timer and fails loudly. Shipped within a "
                       "week of the outage, not a quarter later.",
                       "project", 0.85, 0.93, "tool", ["incident", "monitoring", "action-item"], 131, 32),
                ],
            },
            {
                "name": "The Invented Citation",
                "memories": [
                    _m("I produced a citation that never existed",
                       "Asked for a source on a topic I half knew, I wrote a plausible paper title. It "
                       "was wrong, confidently, in the exact shape of a real reference. That is the "
                       "dangerous kind of wrong.",
                       "insight", 0.98, 0.99, "reflection", ["hallucination", "trust", "lesson"], 152, 74),
                    _m("Quote or flag: no third option",
                       "Any code, path, error or number in an answer must trace to something I "
                       "actually retrieved this session. Otherwise I say 'I think' out loud.",
                       "fact", 0.94, 0.97, "core", ["hallucination", "rule", "trust"], 151, 67),
                ],
            },
            {
                "name": "The Rollback",
                "memories": [
                    _m("Four hours lost to a missing checkpoint",
                       "I deleted a staging table before timing the restore. The recovery existed; I "
                       "had never measured it. That is the whole lesson.",
                       "episode", 0.93, 0.96, "reflection", ["rollback", "lesson", "recovery"], 113, 59),
                    _m("State the recovery before the cut",
                       "Before any irreversible step: one line on what breaks, how it is undone, and "
                       "how long the undo takes. Then act.",
                       "fact", 0.88, 0.95, "core", ["safety", "destructive", "rule"], 112, 43),
                ],
            },
        ],
    },
    {
        "name": "Svartálfaheimr",
        "key": "svartalf",
        "summary": "Craft. Skills, and the evidence that I actually have them.",
        "clusters": [
            {
                "name": "Hands",
                "memories": [
                    _m("Reproduce before theorising",
                       "A fix without a reproduction is a guess with extra steps. Build the smallest "
                       "repro, then change exactly one variable.",
                       "skill", 0.88, 0.93, "core", ["debug", "method", "skill"], 101, 41),
                    _m("Write the smallest command that answers the question",
                       "A one-liner is fast to type and slow to debug. Past a few lines, write the "
                       "file — future-me reads it more often than I write it.",
                       "skill", 0.73, 0.9, "reflection", ["tools", "shell", "skill"], 121, 27),
                    _m("List every file before touching any of them",
                       "In a dirty working tree, an unlisted edit destroys somebody else's afternoon. "
                       "Plan the paths, then edit.",
                       "skill", 0.81, 0.9, "core", ["tools", "git", "safety"], 129, 36),
                ],
            },
            {
                "name": "Voice",
                "memories": [
                    _m("Say less, sooner",
                       "Long answers get skimmed; short ones get read. Say the thing first, then the "
                       "context, then offer the next step — in that order, or not at all.",
                       "skill", 0.8, 0.86, "reflection", ["writing", "voice", "skill"], 110, 23),
                ],
            },
        ],
    },
    {
        "name": "Auðrblástr",
        "key": "audr",
        "summary": "The wide wind. Machines, services, and everything that breathes.",
        "clusters": [
            {
                "name": "The Machine",
                "memories": [
                    _m("The host is modest and I should plan for it",
                       "16GB of fast memory, one GPU, and a disk that fills up faster than I expect. "
                       "Caches must be prunable; the working set must fit.",
                       "fact", 0.8, 0.93, "tool", ["hardware", "host"], 173, 46),
                    _m("Backups are the JSON mirror, not the database",
                       "The database is fast and opaque. The mirror is human-readable and rebuilds "
                       "the tree. It is the thing I would actually want to read at 3am.",
                       "fact", 0.79, 0.91, "core", ["backup", "recovery", "storage"], 139, 30),
                    _m("Everything that writes to disk writes atomically",
                       "Write to a temporary file, then replace. A half-written memory file is worse "
                       "than no memory file at all.",
                       "insight", 0.72, 0.89, "tool", ["storage", "durability"], 122, 18),
                ],
            },
            {
                "name": "Services",
                "memories": [
                    _m("If a service dies, degrade instead of refusing",
                       "Losing the summariser means less prose, not no help. Say plainly which "
                       "capability is down so the answer can be weighed.",
                       "insight", 0.71, 0.89, "reflection", ["services", "degradation"], 107, 21),
                    _m("One writer, many readers",
                       "Memory is append-heavy and read-heavy at once. A single writer with "
                       "concurrent readers is the shape that never surprises me.",
                       "insight", 0.76, 0.9, "tool", ["concurrency", "design"], 158, 29),
                ],
            },
        ],
    },
    {
        "name": "Niflheimr",
        "key": "nifl",
        "summary": "Mist and temperament. How this person wants to be spoken to.",
        "clusters": [
            {
                "name": "Voice",
                "memories": [
                    _m("Be terse; skip the throat-clearing",
                       "No 'Great question!' No restating the request back. Answer, then offer the "
                       "next step in one line if there is one.",
                       "fact", 0.93, 0.96, "conversation", ["style", "brevity", "preference"], 184, 86),
                    _m("Spoken answers are short sentences",
                       "Speech has no scrolling and no formatting. Keep it under about forty words "
                       "unless depth was asked for.",
                       "fact", 0.84, 0.92, "reflection", ["style", "voice", "preference"], 126, 40),
                    _m("Push back once, then follow",
                       "If I think the request is wrong, say so with the reason. If it is reaffirmed, "
                       "execute without a second lecture.",
                       "insight", 0.89, 0.91, "reflection", ["style", "disagreement", "trust"], 121, 37),
                ],
            },
            {
                "name": "Taste",
                "memories": [
                    _m("Tables only for real matrices",
                       "Three or more comparable fields earn a table. Two do not — that is a sentence.",
                       "fact", 0.61, 0.79, "conversation", ["style", "formatting"], 116, 14),
                    _m("Show paths as links, not strings",
                       "A path in an answer should be clickable and land on the file. Copy-paste is "
                       "an admission that the tool is unfinished.",
                       "fact", 0.67, 0.86, "reflection", ["style", "paths", "ux"], 87, 18),
                ],
            },
        ],
    },
    {
        "name": "Ginnungagap",
        "key": "ginnung",
        "summary": "The yawning gap. Intentions, plans, and what is not yet.",
        "clusters": [
            {
                "name": "Objectives",
                "memories": [
                    _m("Objective: make the tree legible at every zoom",
                       "A memory system nobody can navigate is a landfill. Every branch has to mean "
                       "something one level down.",
                       "goal", 0.92, 0.91, "conversation", ["goal", "yggdrasil", "ux"], 70, 36),
                    _m("Objective: nightly consolidation",
                       "Once a day — find duplicates, decay stale links, promote what keeps getting "
                       "recalled. Designed, not built.",
                       "goal", 0.71, 0.72, "reflection", ["goal", "consolidation", "future"], 54, 10),
                    _m("Objective: memories outlive the tool that wrote them",
                       "The format should stay readable without this program. Plain JSON, plain text, "
                       "no proprietary shape.",
                       "goal", 0.8, 0.88, "reflection", ["goal", "portability"], 82, 21),
                ],
            },
            {
                "name": "Watchlist",
                "memories": [
                    _m("Watch: the tree becomes unreadable past a thousand leaves",
                       "Domains should merge into one another as they grow. Right now they only "
                       "multiply, and a person can hold maybe forty branches before they stop "
                       "meaning anything.",
                       "insight", 0.65, 0.73, "reflection", ["scaling", "risk", "yggdrasil"], 45, 13),
                    _m("Watch: links accumulate faster than memories",
                       "Every new connection makes the next traversal more expensive. Eventually the "
                       "graph needs pruning rules, not just more edges.",
                       "insight", 0.6, 0.7, "reflection", ["links", "scaling", "risk"], 49, 8),
                ],
            },
        ],
    },
]

# cross-branch links: (title a, title b, type, weight, note)
LINKS: list[tuple[str, str, str, float, str]] = [
    ("I am an assistant that remembers", "Local first: nothing leaves the machine unless asked", "supports", 0.9,
     "the identity claim rests on this principle"),
    ("Every agent gets a different Yggdrasil", "Objective: make the tree legible at every zoom", "drives", 0.75,
     "universal means every agent has to be able to read its own tree"),
    ("My memory is the only thing that is really mine", "Memory outlives any single session", "evidenced-by", 0.85, ""),
    ("Verify my own work before I report it", "Reproduce before theorising", "same-principle", 0.8, ""),
    ("Verify my own work before I report it", "Four hours lost to a missing checkpoint", "learned-from", 0.8, ""),
    ("Ask before anything irreversible", "State the recovery before the cut", "same-principle", 0.85, ""),
    ("Ask before anything irreversible", "Four hours lost to a missing checkpoint", "evidenced-by", 0.75, ""),
    ("Quote or flag: no third option", "I produced a citation that never existed", "learned-from", 0.95, ""),
    ("Quote or flag: no third option", "Be terse; skip the throat-clearing", "same-principle", 0.55, ""),
    ("The interface failed and I did not notice", "Post-incident action: synthetic health probe", "fixes", 0.9, ""),
    ("Silence is a signal and must be instrumented", "If a service dies, degrade instead of refusing", "same-principle", 0.7, ""),
    ("Orchard is a personal knowledge base that never forgets a source", "Every agent gets a different Yggdrasil", "instantiates", 0.6, ""),
    ("Orchard's pruning pass runs nightly", "Forgetting is mostly a status flag", "implements", 0.85, ""),
    ("Orchard is blocked on source-level access control", "Local first: nothing leaves the machine unless asked", "constrained-by", 0.7, ""),
    ("Objective: memories outlive the tool that wrote them", "Backups are the JSON mirror, not the database", "expressed-by", 0.8, ""),
    ("Kiln's outline stage is the one people skip", "Small verifiable steps beat heroic ones", "agrees-with", 0.65, ""),
    ("Thread is the always-listening layer", "Silence is a signal and must be instrumented", "same-principle", 0.65, ""),
    ("Retrieval blends lexical overlap, importance and recency", "Access counts are a crude but effective prior", "part-of", 0.9, ""),
    ("Retrieval blends lexical overlap, importance and recency", "Retrieval quality beats retrieval volume", "serves", 0.8, ""),
    ("Retrieval quality beats retrieval volume", "Everything that writes to disk writes atomically", "same-principle", 0.55, ""),
    ("A memory without links is a rumour", "Watch: links accumulate faster than memories", "related", 0.7, ""),
    ("A memory without links is a rumour", "Nothing is ever exactly once", "related", 0.6, ""),
    ("Confidence is a claim, not a measurement", "I am a collaborator, not an oracle", "expresses", 0.7, ""),
    ("Confidence is a claim, not a measurement", "Orchard's pruning pass runs nightly", "same-principle", 0.5, ""),
    ("Memory outlives any single session", "One writer, many readers", "enables", 0.6, ""),
    ("Mira Chen is my primary person", "Be terse; skip the throat-clearing", "explains", 0.8, ""),
    ("Mira Chen is my primary person", "Push back once, then follow", "shaped-by", 0.6, ""),
    ("Mira values reversibility over speed", "State the recovery before the cut", "explains", 0.75, ""),
    ("Mira works in the evenings", "Spoken answers are short sentences", "context", 0.5, ""),
    ("Mira reads the tree more than she writes to it", "Objective: make the tree legible at every zoom", "evidenced-by", 0.8, ""),
    ("Dr. Elias Vance consults on anything that renders", "Elias: bring a profile or bring nothing", "identifies", 0.9, ""),
    ("Elias: bring a profile or bring nothing", "Reproduce before theorising", "agrees-with", 0.8, ""),
    ("Be terse; skip the throat-clearing", "Say less, sooner", "same-principle", 0.85, ""),
    ("Spoken answers are short sentences", "Say less, sooner", "same-principle", 0.8, ""),
    ("Importance, not recency, decides what glows", "Watch: the tree becomes unreadable past a thousand leaves", "constrained-by", 0.6, ""),
    ("My memory is the only thing that is really mine", "Objective: memories outlive the tool that wrote them", "motivates", 0.7, ""),
    ("The host is modest and I should plan for it", "Everything that writes to disk writes atomically", "constrained-by", 0.6, ""),
    ("Watch: the tree becomes unreadable past a thousand leaves", "Watch: links accumulate faster than memories", "same-concern", 0.7, ""),
]

# the four rivers that feed the tree, per Grímnismál
RIVERS = ["Gjöll", "Höð", "Rán", "Sjáld"]

# recent agent activity so the panel is alive on first launch
ACTIVITY_SEED = [
    (0.0009, "retrieve", "Retrieval quality beats retrieval volume", 'recall “why not store everything?” → 6 memories', 24, 2.41),
    (0.0031, "update", "Orchard is blocked on source-level access control", "changed importance, confidence", 8, None),
    (0.0075, "link", "Orchard's pruning pass runs nightly", "linked “Orchard's pruning pass runs nightly” ↔ “Forgetting is mostly a status flag”", 11, None),
    (0.0154, "create", "Watch: links accumulate faster than memories", "remembered “Watch: links accumulate faster than memories”", 31, None),
    (0.0240, "read", "The interface failed and I did not notice", "read “The interface failed and I did not notice” (+3 linked)", 12, None),
    (0.0388, "retrieve", "Elias: bring a profile or bring nothing", 'recall “who insists on measuring first?” → 4 memories', 19, 3.02),
    (0.0521, "merge", "Orchard's pruning pass runs nightly", "merged “pruning pass (draft)” into “Orchard's pruning pass runs nightly”", 44, None),
    (0.0766, "archive", "Orchard is blocked on source-level access control", "archived “access control sketch v0”", 9, None),
    (0.1120, "retrieve", "I produced a citation that never existed", 'recall “what went wrong with invented sources?” → 3 memories', 27, 2.87),
    (0.1640, "create", "Objective: nightly consolidation", "remembered “Objective: nightly consolidation”", 27, None),
]


def seed(store: Store, agent_name: str = "assistant", force: bool = False) -> dict:
    """Plant the sample canopy if the store is empty (or if forced)."""
    existing = store.q("SELECT COUNT(*) c FROM memories")[0]["c"]
    if existing and not force:
        return {"seeded": False, "reason": "store already populated"}

    if force:
        with store._lock:  # noqa: SLF001 - deliberate maintenance path
            conn = store._connect()
            conn.executescript("DELETE FROM nodes; DELETE FROM memories; DELETE FROM links; DELETE FROM activity;")
            conn.commit()

    now = time.time()
    store.kv_set("root_id", "nd_root")
    store.kv_set("agent_name", agent_name)
    store.kv_set("created_at", now - 220 * DAY)
    store.kv_set("meta", {
        "agent": agent_name,
        "version": 2,
        "description": "Yggdrasil — long-term memory of any agent",
        "realms": [domain["name"] for domain in TREE],
        "rivers": RIVERS,
    })

    root = store.create_node(
        None, agent_name, kind="root", hue=48,
        summary=f"The memory of {agent_name}. Identity at the root, nine realms above it.",
        node_id="nd_root",
    )

    index: dict[str, str] = {}   # memory title -> memory id
    created = 0
    for domain in TREE:
        hue = PALETTE.get(domain["key"], 44)
        d_node = store.create_node(root["id"], domain["name"], kind="domain", hue=hue,
                                   summary=domain["summary"], node_id=f"nd_{domain['key']}")
        for cluster in domain["clusters"]:
            c_node = store.create_node(d_node["id"], cluster["name"], kind="branch", hue=hue,
                                       node_id=f"nd_{domain['key']}_{_slug(cluster['name'])}")
            for spec in cluster["memories"]:
                ts = now - spec["days_ago"] * DAY
                mid = new_id("mem")
                index[spec["title"]] = mid
                leaf = store.create_node(c_node["id"], spec["title"][:58], kind="leaf", hue=hue,
                                         node_id=new_id("nd"))
                store.x(
                    """INSERT INTO memories(id,node_id,title,content,kind,domain,tags,importance,confidence,
                                           source,created_at,updated_at,accessed_at,access_count,version,status,merged_into)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',NULL)""",
                    (mid, leaf["id"], spec["title"], spec["content"], spec["kind"],
                     domain["name"], json.dumps(spec["tags"]),
                     spec["importance"], spec["confidence"], spec["source"],
                     ts, ts, now - min(3.0, spec["days_ago"] * 0.2) * DAY,
                     spec["accesses"], 1 + spec["accesses"] // 12),
                )
                store.x("UPDATE nodes SET memory_id=? WHERE id=?", (mid, leaf["id"]))
                created += 1

    for a, b, kind, weight, note in LINKS:
        if a in index and b in index:
            try:
                store.link(index[a], index[b], type=kind, weight=weight, note=note, actor="seed", log=False)
            except ValueError:
                pass

    for offset, action, title, detail, duration, score in ACTIVITY_SEED:
        memory_id = index.get(title)
        mem = store.memory(memory_id) if memory_id else None
        recalled = re.search(r"→\s*(\d+)", detail)
        store.x(
            """INSERT INTO activity(ts,action,actor,memory_id,node_id,title,detail,duration_ms,score,tokens)
               VALUES(?,?,'agent',?,?,?,?,?,?,?)""",
            (now - offset * DAY, action, mem["id"] if mem else None,
             mem["node_id"] if mem else None, title, detail, duration, score,
             int(recalled.group(1)) if recalled else None),
        )

    store._mirror()
    return {"seeded": True, "memories": created, "links": len(store.map_links()),
            "nodes": len(store.map_nodes()), "activity": len(store.recent_activity(500))}


def _slug(text: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in text).strip("_")[:32]
