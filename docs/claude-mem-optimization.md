# Claude-mem Context Optimization

Date: 2026-11-13

## Environment
- OpenCode 2.2.7
- Claude-mem 15.18.1
- Runtime: worker
- Worker port: 37700

## Configuration
File: ~/.claude-mem/settings.json

Added:
- CLAUDE_MEM_CONTEXT_OBSERVATIONS=20
- CLAUDE_MEM_CONTEXT_SESSION_COUNT=5

Other context settings remain at defaults.

## Results

LendLoop context injection:

Before:
- 9,558 bytes
- 1,481 words

After:
- 5,738 bytes
- 887 words

Reduction:
- 39.9%
- 3,820 bytes
- 594 words

## Recommendations
- Keep the current settings.
- Test with a fresh OpenCode session.
- Do not restart 9Router.
- Restart OpenCode only if a fresh session still receives stale context.
- Monitor memory retrieval quality before reducing limits further.

## Outstanding
- Verify historical decisions remain retrievable.
- Verify current work state is preserved.
- Investigate other OpenCode plugin context overhead separately.
