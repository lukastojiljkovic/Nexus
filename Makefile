# Nexus — build entry points.
#
# This file is a thin, DISCOVERABLE wrapper over the repo's real scripts. It
# adds nothing the scripts do not do; what it adds is ORDER and REFUSAL, which
# is where the Linux build actually goes wrong:
#
#   * `pnpm build` before `dist` is not optional in a fresh tree, and skipping
#     it fails inside Vite with „failed to resolve entry for package" and no
#     hint that a workspace package simply was not built yet. Here it is a
#     prerequisite, so it cannot be skipped by accident.
#   * `dist` builds for the HOST platform only. Cross-building a Linux artifact
#     from Windows produces an archive carrying a Windows `.node`, which dies at
#     the first database query with an error about the native module rather than
#     about the build. `make linux` refuses non-Linux hosts up front, with the
#     reason, instead of letting you find out later.
#
# `make` on its own prints the target list. Full Linux guide, including the
# AppImage's FUSE/sandbox behaviour and the Gentoo overlay:
# apps/desktop/build/gentoo/README.md
#
# Requires GNU make and a POSIX shell — the recipes use `case`, `[` and
# `command -v`. That is every Linux box; on Windows it means Git Bash or WSL,
# not cmd.exe. Nothing here is required: every target is one documented pnpm
# script, and `pnpm --filter @nexus/desktop dist` remains the direct route.

SHELL := /bin/sh
.DEFAULT_GOAL := help

# Every recipe here is a single serial pnpm command that fans out over the
# workspace itself, so `-j` buys nothing — and it would cost two things: the
# host guards are prerequisites, and under `-j` they are no longer ordered
# before the work they guard; and `install` and `build` would race over the
# same node_modules. Refuse the flag rather than honour it badly.
.NOTPARALLEL:

DESKTOP     := @nexus/desktop
RELEASE_DIR := apps/desktop/release
HOST_OS     := $(shell uname -s 2>/dev/null || echo unknown)

# Read from the manifest rather than written here, so this file can never name
# a version the build does not produce. Simply-expanded, so node runs once.
VERSION     := $(shell node -p "require('./apps/desktop/package.json').version" 2>/dev/null || echo "?")

# Every gate CI runs as its own step. Kept as a list rather than a loop over
# `package.json` so a gate that is renamed breaks here loudly instead of
# silently dropping out of `make gates` — a gate that stops running is exactly
# the failure the gate set exists to prevent.
GATES := colours contrast css strings tokens invisibles risk pro-math pro-flags \
         licences egress rls

.PHONY: help install build linux windows dist verify gates test typecheck lint \
        smoke artifacts gentoo-manifest clean require-node require-linux \
        require-windows

help:
	@echo "Nexus $(VERSION) — make targets"
	@echo
	@echo "  Linux build"
	@echo "    make linux             AppImage + tar.gz into $(RELEASE_DIR)/ (must run ON Linux)"
	@echo "    make gentoo-manifest   Re-hash the ebuild Manifest after rebuilding the tarball"
	@echo
	@echo "  Windows build"
	@echo "    make windows           NSIS installer into $(RELEASE_DIR)/ (must run ON Windows)"
	@echo
	@echo "  Everyday"
	@echo "    make install           pnpm install --frozen-lockfile"
	@echo "    make build             Build every workspace package (required before dist)"
	@echo "    make verify            The full gate set: typecheck, lint, test, build, gates"
	@echo "    make gates             The twelve static gates only"
	@echo "    make test / typecheck / lint / smoke"
	@echo "    make artifacts         List what is currently in $(RELEASE_DIR)/"
	@echo "    make clean             Remove build output ($(RELEASE_DIR)/, out/, dist/)"
	@echo
	@echo "  Host: $(HOST_OS).  Full Linux guide: apps/desktop/build/gentoo/README.md"

# --- preflight ---------------------------------------------------------------

require-node:
	@command -v node >/dev/null 2>&1 || { \
	  echo "make: node not found. Nexus needs Node >= 24."; exit 1; }
	@command -v pnpm >/dev/null 2>&1 || { \
	  echo "make: pnpm not found. Nexus pins pnpm 11 through package.json's"; \
	  echo "      \"packageManager\" field — 'corepack enable' is enough."; exit 1; }
	@node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || { \
	  echo "make: Node $$(node -p process.versions.node) is too old; Nexus needs >= 24."; exit 1; }

# The refusal that saves an afternoon. electron-builder would happily emit a
# Linux target from another host; the native SQLite module would not, because
# it is fetched per `process.platform`.
require-linux:
	@[ "$(HOST_OS)" = "Linux" ] || { \
	  echo "make linux: this must run ON Linux — host is $(HOST_OS)."; \
	  echo; \
	  echo "  The packaged app carries a platform-specific build of"; \
	  echo "  better-sqlite3-multiple-ciphers. Cross-built from here it would"; \
	  echo "  ship the wrong .node and fail at the first query, with an error"; \
	  echo "  about the module rather than about the build."; \
	  echo; \
	  echo "  WSL is enough — it is a real Linux userspace and what it produces"; \
	  echo "  are ordinary Linux artifacts. No Docker, no VM."; \
	  exit 1; }

# Same shape as require-linux, and a prerequisite for the same reason: a host
# check written inside the recipe would only run after `install` and `build`
# had already been made, so the refusal would arrive after the slow part.
require-windows:
	@case "$(HOST_OS)" in MINGW*|MSYS*|CYGWIN*|Windows*) ;; *) \
	  echo "make windows: this must run ON Windows — host is $(HOST_OS)."; \
	  echo "  Same reason as make linux: the native SQLite module is fetched"; \
	  echo "  for the building host's platform, not for the target's."; \
	  exit 1 ;; esac

# --- the builds --------------------------------------------------------------

install: require-node
	pnpm install --frozen-lockfile

# Workspace packages resolve through their built `dist/`, and `dist.mjs` calls
# electron-vite directly rather than going through turbo — so nothing else
# builds them for you.
build: require-node
	pnpm build

linux: require-linux install build
	pnpm --filter $(DESKTOP) dist
	@echo
	@echo "Built into $(RELEASE_DIR)/:"
	@echo "  Nexus-$(VERSION)-x86_64.AppImage   any glibc desktop, no packaging"
	@echo "  nexus-$(VERSION)-linux-x64.tar.gz  the payload the Gentoo ebuild installs"
	@echo
	@echo "Install notes — AppImage sandbox, keyring requirement, the overlay:"
	@echo "  apps/desktop/build/gentoo/README.md"

windows: require-windows install build
	pnpm --filter $(DESKTOP) dist
	@echo
	@echo "Built $(RELEASE_DIR)/Nexus-Setup-$(VERSION).exe"

# Whatever the host is. `dist.mjs` decides the target and refuses a host it
# cannot package for, before it touches the native module.
dist: install build
	pnpm --filter $(DESKTOP) dist

# `SRC_URI` names a release tarball; portage matches it against the Manifest
# beside the ebuild. Rebuild the tarball and the hashes change, so portage will
# correctly refuse it until this is re-run — on the Gentoo host, as root.
gentoo-manifest:
	@echo "Run this on the Gentoo host, in the overlay copy portage reads:"
	@echo "  cd /var/db/repos/nexus/app-office/nexus-bin"
	@echo "  sudo ebuild nexus-bin-$(VERSION).ebuild manifest"
	@echo
	@echo "The tarball must already be in /var/cache/distfiles/ and owned by portage."
	@echo "See apps/desktop/build/gentoo/README.md §3.3."

# --- verification ------------------------------------------------------------

# The set that must be green before anything is committed. `smoke` is
# deliberately not in here: it flips the native module to the Electron ABI and
# back, so it must never run beside the test suites.
verify: typecheck lint test build gates
	@echo
	@echo "verify: typecheck, lint, tests, build and all $(words $(GATES)) static gates are green."

typecheck: require-node
	pnpm typecheck

lint: require-node
	pnpm lint

test: require-node
	pnpm test

gates: require-node
	@for gate in $(GATES); do \
	  printf '%-12s ' "$$gate"; \
	  if pnpm -w run "check:$$gate" >/dev/null 2>&1; then echo OK; \
	  else echo FAIL; fail=1; fi; \
	done; \
	[ -z "$$fail" ] || { echo; echo "gates: at least one gate failed — re-run it alone for the message."; exit 1; }

# Flips the native module to the Electron ABI and restores Node's on the way
# out. Never run while a test suite is running.
smoke: require-node
	pnpm --filter $(DESKTOP) smoke

# --- housekeeping ------------------------------------------------------------

# One logical line on purpose. make runs each recipe LINE in its own shell, so
# an early `exit 0` on the first line would end that shell and make would then
# run the next one anyway — printing „nothing built yet" and an ls error
# together. Continuations keep the guard and the thing it guards in one shell.
artifacts:
	@if [ ! -d "$(RELEASE_DIR)" ]; then \
	  echo "Nothing built yet — $(RELEASE_DIR)/ does not exist."; \
	else \
	  ls -lh "$(RELEASE_DIR)" | grep -Ev '^total|blockmap|\.yml$$' \
	    || echo "No artifacts in $(RELEASE_DIR)/."; \
	fi

clean:
	rm -rf $(RELEASE_DIR) out apps/*/out apps/*/dist packages/*/dist packages/tokens/gen
	@echo "Removed build output. node_modules/ is untouched — 'make install' if in doubt."
