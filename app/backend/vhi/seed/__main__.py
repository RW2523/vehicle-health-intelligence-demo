import argparse
import logging

from . import reset_runtime, run

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
ap = argparse.ArgumentParser(description="Seed the VHI demo database from data/curated")
ap.add_argument("--force", action="store_true", help="rebuild even if already seeded")
ap.add_argument("--reset-runtime", action="store_true",
                help="clear lane inspections, reports, evidence, bookings, chats and self-checks (keeps the seeded world)")
args = ap.parse_args()
if args.reset_runtime:
    print("cleared:", reset_runtime())
else:
    print("seeded" if run(force=args.force) else "already seeded (use --force to rebuild)")
