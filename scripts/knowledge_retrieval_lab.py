"""Offline learning lab: compare exact lookup and sparse character-bigram cosine."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "server/src/main/resources/knowledge/bp-basics.json"
EVAL = ROOT / "docs/knowledge-eval.json"


def normalize(text):
    return unicodedata.normalize("NFKC", text).strip().rstrip("?。.!！").strip()


def vector(text):
    chars = "".join(ch for ch in normalize(text) if ch.isalnum())
    return Counter(chars[i:i + 2] for i in range(len(chars) - 1))


def cosine(a, b):
    norm = math.sqrt(sum(x * x for x in a.values()) * sum(y * y for y in b.values()))
    return sum(x * b.get(term, 0) for term, x in a.items()) / norm if norm else 0.0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("question", nargs="?", help="Use only a fictional or general question.")
    parser.add_argument("--threshold", type=float, default=0.35, help="Experiment threshold in [0,1].")
    args = parser.parse_args()
    if not 0 <= args.threshold <= 1:
        parser.error("--threshold must be in [0,1]")
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    entries = [e for e in corpus["entries"] if e["status"] == "SOURCE_CHECKED"]
    aliases = [(entry["id"], normalize(q)) for entry in entries for q in [entry["title"], *entry["aliases"]]]
    exact = {q: key for key, q in aliases}
    encoded = [(key, vector(q)) for key, q in aliases]

    def compare(question):
        query = vector(question)
        scores = {entry["id"]: 0.0 for entry in entries}
        for key, known in encoded:
            scores[key] = max(scores[key], cosine(query, known))
        ranked = sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))
        best = ranked[0][0] if ranked and ranked[0][1] > 0 and ranked[0][1] >= args.threshold else None
        return exact.get(normalize(question)), best, ranked

    if args.question:
        exact_id, vector_id, ranked = compare(args.question)
        print(f"exact={exact_id or 'ABSTAIN'} vector={vector_id or 'ABSTAIN'} threshold={args.threshold:.2f}")
        print("scores:", ", ".join(f"{key}={score:.3f}" for key, score in ranked))
        return
    cases = json.loads(EVAL.read_text(encoding="utf-8"))
    exact_correct = vector_correct = exact_false = vector_false = 0
    print(f"{corpus['version']} | threshold={args.threshold:.2f} | n={len(cases)}")
    for i, case in enumerate(cases, start=1):
        exact_id, vector_id, ranked = compare(case["question"])
        expected = case["expected"]
        exact_correct += exact_id == expected
        vector_correct += vector_id == expected
        exact_false += expected is None and exact_id is not None
        vector_false += expected is None and vector_id is not None
        print(f"{i:02} expected={expected or '-'} exact={exact_id or '-'} vector={vector_id or '-'} top={ranked[0][1]:.3f}")
    print(f"correct exact={exact_correct}/{len(cases)} vector={vector_correct}/{len(cases)}")
    print(f"false answers on unsupported prompts exact={exact_false} vector={vector_false}")


if __name__ == "__main__":
    main()
