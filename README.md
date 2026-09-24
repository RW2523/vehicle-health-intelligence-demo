# PUSPAKOM Vehicle Health Intelligence — Demo Data

A concept-demo dataset and data pipeline for an AI-assisted vehicle inspection platform. It covers sight, smell, sound, OBD/particle-number emissions, EV battery health, insurance history and predictive analytics. The pipeline is built to run locally on an NVIDIA DGX Spark.

**Independent concept work. Not an official PUSPAKOM product or dataset.**

- `data/curated/README.md`: what's inside and how to rebuild it
- `data/curated/CATALOG.md`: every folder, its counts and the known gaps
- `data/curated/PATTERNS.md`: vehicle age × insurance × flood × damage × inspection findings
- `data/curated/LICENSES.md`: the source and licence of every third-party file. Several sources declare no licence; if you need to use them beyond research, check with the original authors.

Everything in `data/curated/synthetic/` and `data/curated/sessions/` is fictional. The demo plates use the prefix `DMO`.
