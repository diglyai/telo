# Extract the first argument (example name) and remaining arguments (flags)
EXAMPLE_NAME := $(word 1,$(filter-out example example-debug test,$(MAKECMDGOALS)))
EXTRA_ARGS := $(wordlist 2,$(words $(filter-out example example-debug test,$(MAKECMDGOALS))),$(filter-out example example-debug test,$(MAKECMDGOALS)))

example:
	pnpm run --filter='*' build && bun runtime/nodejs/bin/voke.cjs $(EXTRA_ARGS) examples/$(EXAMPLE_NAME)

test:
	pnpm run --filter='*' build && bun runtime/nodejs/bin/voke.cjs $(EXTRA_ARGS) tests/$(EXAMPLE_NAME)

%:
	@:

	