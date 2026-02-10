# Extract the first argument (example name) and remaining arguments (flags)
EXAMPLE_NAME := $(word 1,$(filter-out example example-debug,$(MAKECMDGOALS)))
EXTRA_ARGS := $(wordlist 2,$(words $(filter-out example example-debug,$(MAKECMDGOALS))),$(filter-out example example-debug,$(MAKECMDGOALS)))

example:
	pnpm run --filter='*' build && bun runtime/nodejs/bin/digly.mjs $(EXTRA_ARGS) examples/$(EXAMPLE_NAME)

%:
	@:

	