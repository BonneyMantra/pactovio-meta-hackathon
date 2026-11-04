# Architecture decision records

Short records of decisions that shape the code, each with the alternative we rejected and its cost.

| ADR | Decision |
|---|---|
| [0001](0001-meta-lanes.md) | Models are chosen by role through `LANE_*` config, every lane is on Meta, contributor models are refused |
| [0002](0002-lexical-retrieval-plus-spark-ranking.md) | Lexical retrieval narrows the field; Muse Spark reads and ranks; no embeddings |
| [0003](0003-rubric-scored-in-code.md) | Models read and judge; code computes every number, score and verdict |
| [0004](0004-wonder-orchestrates-idempotent-tools.md) | Muse Wonder orchestrates nine idempotent tools; Spark and a code sweep are the fallbacks |
| [0005](0005-sam-shapes-spark-names.md) | SAM 3.1 finds shapes, Spark names them, code places devices |
| [0006](0006-spend-cap-in-fetch.md) | The spend cap and kill switch live inside the model client's fetch |
