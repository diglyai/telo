example:
	(cd runtime/nodejs && npm run build) && bun runtime/nodejs/bin/digly.js --verbose examples/$(filter-out $@,$(MAKECMDGOALS))

%:
	@: