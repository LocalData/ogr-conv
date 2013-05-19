MOCHA = "./node_modules/.bin/mocha"

test:
	@ENVIRONMENT=local S3_KEY="blah" S3_SECRET="blah" S3_BUCKET="blah" $(MOCHA) --ui tdd --reporter spec -t 10000

.PHONY: test
