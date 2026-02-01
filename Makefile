example:
	(cd runtime/nodejs && npm run build) && bun runtime/nodejs/bin/digly.js examples/$(filter-out $@,$(MAKECMDGOALS))

%:
	@: