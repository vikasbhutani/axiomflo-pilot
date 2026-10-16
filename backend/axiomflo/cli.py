"""Local command line for the AxiomFlo Agent (sample data only).

Examples:
  # Ask the agent a question (needs the Gemini settings in README "Try one live question")
  python -m axiomflo.cli ask --persona maya "What did each team spend this month?"

  # Call one tool directly, no AI model and no cost
  python -m axiomflo.cli tool get_cost_summary --persona noah --arg period=2026-09
  python -m axiomflo.cli tools
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

from .agent.service import AgentService
from .config import Settings
from .personas import PERSONAS, persona_context
from .reporting.dataset import load_fixture_workspace

BANNER = "*** MOCK DATA: AxiomFlo demo workspace. Figures are sample data, not real spend. ***"


def _service_and_context(persona: str, channel: str = "cli"):
    settings = Settings.from_env()
    if settings.data_source != "fixtures":
        sys.exit("The local CLI only runs with AXIOMFLO_DATA_SOURCE=fixtures in Milestone 1.")
    workspace = load_fixture_workspace(settings.fixtures_dir)
    return AgentService(settings), persona_context(settings, workspace, persona, channel)


def _parse_args(pairs: list[str]) -> dict:
    out = {}
    for pair in pairs:
        key, _, value = pair.partition("=")
        out[key] = int(value) if value.isdigit() and key == "limit" else value
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m axiomflo.cli", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    ask = sub.add_parser("ask", help="Ask the agent a question (uses Gemini on Vertex AI)")
    ask.add_argument("question")
    ask.add_argument("--persona", default="maya", help=f"Demo persona: {', '.join(PERSONAS)}")

    tool = sub.add_parser("tool", help="Call one read-only tool directly (no AI model)")
    tool.add_argument("name")
    tool.add_argument("--persona", default="maya")
    tool.add_argument("--arg", action="append", default=[], help="key=value, e.g. period=2026-09")

    sub.add_parser("tools", help="List the tools")

    args = parser.parse_args(argv)
    print(BANNER, file=sys.stderr)

    if args.command == "tools":
        service, _ = _service_and_context("maya")
        for name, fn in service.tools.items():
            print(f"{name}: {(fn.__doc__ or '').strip().splitlines()[0]}")
        return 0

    if args.command == "tool":
        service, ctx = _service_and_context(args.persona)
        print(json.dumps(service.call_tool(ctx, args.name, **_parse_args(args.arg)), indent=2))
        return 0

    service, ctx = _service_and_context(args.persona)
    answer = asyncio.run(service.ask(ctx, args.question))
    print(answer.text)
    print(f"\n[status: {answer.status}] [tools: {', '.join(answer.tools_called) or 'none'}]", file=sys.stderr)
    if answer.assistant_usage and answer.assistant_usage.get("model_calls"):
        u = answer.assistant_usage
        print(f"[assistant usage: {u['model_calls']} model call(s), {u['total_tokens']} tokens, workload '{u['workload']}']", file=sys.stderr)
    return 0 if answer.status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
