BUILD_DIR=dist

all: clean build

clean:
	@echo "Cleaning..."
	@rm -rf "${BUILD_DIR}"

build:
	@echo "Building..."
	npx esbuild "src/index.js" --bundle --minify --platform=node --format=cjs --outfile="${BUILD_DIR}/index.js"
