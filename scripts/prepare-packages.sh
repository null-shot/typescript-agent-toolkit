#!/bin/bash

# Script to prepare all packages in the monorepo for changesets
# Usage: ./scripts/prepare-packages.sh

set -e

# Find all package directories
PACKAGES=$(find packages -type f -name "package.json" -not -path "*/node_modules/*" | grep -o 'packages/[^/]*' | sort | uniq)

# Process each package
for PKG in $PACKAGES; do
	echo "Processing $PKG..."
	cd "$PKG" || exit 1

	# Check if private is set to true and if so, skip
	if grep -q '"private": true' package.json; then
		echo "  Skipping private package"
		cd - >/dev/null || exit 1
		continue
	fi

	# Check for main, types, and files fields
	if ! grep -q '"main":' package.json || ! grep -q '"types":' package.json; then
		echo "  Updating main and types fields"
		jq '.main = "dist/index.js" | .types = "dist/index.d.ts"' package.json >package.json.tmp
		mv package.json.tmp package.json
	fi

	if ! grep -q '"files":' package.json; then
		echo "  Adding files field"
		jq '.files = ["dist", "README.md", "LICENSE"]' package.json >package.json.tmp
		mv package.json.tmp package.json
	fi

	# Add publishConfig for public access if not present
	if ! grep -q '"publishConfig":' package.json; then
		echo "  Adding publishConfig for public access"
		jq '.publishConfig = {"access": "public"}' package.json >package.json.tmp
		mv package.json.tmp package.json
	fi

	# Check for build script
	if ! grep -q '"build":' package.json; then
		echo "  Adding build script"
		jq '.scripts.build = "tsc"' package.json >package.json.tmp
		mv package.json.tmp package.json
	fi

	# Ensure license file exists
	if [ ! -f LICENSE ]; then
		echo "  Copying LICENSE file"
		cp ../../LICENSE ./LICENSE 2>/dev/null || echo "  WARNING: Could not find root LICENSE file"
	fi

	# Check if tsconfig.json has right output settings
	if [ -f tsconfig.json ]; then
		if ! grep -q '"declaration": true' tsconfig.json || ! grep -q '"outDir": "./dist"' tsconfig.json; then
			echo "  WARNING: Please update tsconfig.json for proper build output"
			echo "  Example: set declaration: true, outDir: ./dist, noEmit: false"
		fi
	else
		echo "  WARNING: No tsconfig.json found, must be created for proper builds"
	fi

	# Ensure we have a README.md
	if [ ! -f README.md ]; then
		echo "  Creating a basic README.md"
		echo "# ${PKG##*/}" >README.md
		echo "" >>README.md
		echo "Part of the TypeScript Agent framework." >>README.md
	fi

	cd - >/dev/null || exit 1
done

# Ensure changesets is installed in the root package
if ! grep -q '"@changesets/cli"' package.json; then
	echo "Adding @changesets/cli to root package.json"
	pnpm add --dev @changesets/cli
fi

# Make sure we have a changeset release script in the root
if ! grep -q '"release":' package.json; then
	echo "Adding release script to root package.json"
	jq '.scripts.release = "changeset publish"' package.json >package.json.tmp
	mv package.json.tmp package.json
fi

echo "All packages processed! Review the changes before committing."
