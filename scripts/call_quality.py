#!/usr/bin/env python3
"""Call-quality review for the Voice Commerce agent (test-listen-iterate loop).

Reads pino JSONL server logs (voice_turn entries), and reports the same
signals a reviewer would listen for: fallback rate, slow stages, failing
intents/tools, and worst-turn samples to replay.

Usage:
    python3 scripts/call_quality.py /tmp/voice.log
    LOG_LEVEL=info npm run dev --workspace=server 2>&1 | python3 scripts/call_quality.py

Only the standard library is used.
"""
import json
import statistics
import sys


def pct(values, p):
    if not values:
        return 0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(len(ordered) * p / 100)))
    return ordered[idx]


def main(path=None):
    stream = open(path) if path else sys.stdin
    turns = []
    for line in stream:
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("msg") != "voice_turn":
            continue
        turns.append(entry)

    print(f"voice turns analyzed: {len(turns)}")
    if not turns:
        return

    fallbacks = [t for t in turns if "fallback" in str(t.get("llm", ""))]
    errors = [t for t in turns if not t.get("success", True)]
    print(f"llm fallback rate:    {100 * len(fallbacks) / len(turns):.1f}% ({len(fallbacks)})")
    print(f"failed turns:         {len(errors)}")
    print()
    print("stage latency ms (avg / p50 / p95):")
    for stage in ("llm_latency_ms", "tool_latency_ms", "tts_latency_ms", "total_latency_ms"):
        vals = [t.get(stage, 0) or 0 for t in turns]
        avg = sum(vals) / len(vals)
        print(f"  {stage:<16} {avg:8.1f} / {pct(vals, 50):6.0f} / {pct(vals, 95):6.0f}")
    print()

    for field in ("intent", "tool_called"):
        counts: dict = {}
        for t in turns:
            counts[t.get(field, "?")] = counts.get(t.get(field, "?"), 0) + 1
        top = sorted(counts.items(), key=lambda kv: -kv[1])[:5]
        print(f"top {field}: " + ", ".join(f"{k}={v}" for k, v in top))

    slow = sorted(turns, key=lambda t: t.get("total_latency_ms", 0) or 0, reverse=True)[:3]
    print("\nslowest turns to replay (conversation_id / intent / tool / total_ms):")
    for t in slow:
        print(f"  {t.get('conversation_id')} / {t.get('intent')} / {t.get('tool_called')} / {t.get('total_latency_ms')}")

    if errors:
        print("\nfailed turns (conversation_id / intent / tool):")
        for t in errors[:5]:
            print(f"  {t.get('conversation_id')} / {t.get('intent')} / {t.get('tool_called')}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
