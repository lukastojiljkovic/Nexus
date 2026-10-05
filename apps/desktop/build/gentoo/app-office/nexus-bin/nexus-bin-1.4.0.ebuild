# Copyright 2026 Luka Stojiljković
# Distributed under the terms of the GNU General Public License v2

EAPI=8

inherit desktop xdg

MY_PN="${PN%-bin}"
MY_P="${MY_PN}-${PV}-linux-x64"
# Must equal `appId` in electron-builder.yml and `desktopName` in the app's
# package.json: Electron derives its X11/Wayland app_id from the latter, and a
# StartupWMClass that does not match it leaves the running window unattached to
# this launcher.
DESKTOP_ID="rs.stojiljkovic.nexus"

# DESCRIPTION is portage metadata (`emerge -s`, packages.gentoo.org) and stays
# English by convention. The menu comment speaks the app's two languages:
# English by default, Serbian for any sr* locale — Latin script under both keys,
# because that is the Serbian the app itself shows, whatever the script.
DESCRIPTION="Offline-first workspace for tasks, calendar, notes, study and finance"
DESKTOP_COMMENT="Tasks, calendar, notes, study and finance in one place, local and encrypted."
DESKTOP_COMMENT_SR="Zadaci, kalendar, beleške, učenje i finansije na jednom mestu, lokalno i šifrovano."
HOMEPAGE="https://github.com/lukastojiljkovic/Nexus"
# Releases live in the source repository once it is public; the separate
# `nexus-releases` repository was never created. Same asset name, so the
# Manifest digest is unaffected by the move.
SRC_URI="https://github.com/lukastojiljkovic/Nexus/releases/download/v${PV}/${MY_P}.tar.gz"
S="${WORKDIR}/${MY_P}"

# Apache-2.0, and it is a FREE licence: the default profile accepts it, so
# there is no ACCEPT_LICENSE step any more. This said "all-rights-reserved"
# with a note about the EULA group until 2026-10-02, when Nexus became open
# source (ADR-087). An ebuild that keeps demanding a proprietary licence for a
# free package makes portage refuse a package it should simply install.
LICENSE="Apache-2.0"
SLOT="0"
KEYWORDS="-* ~amd64"

# strip: the tree is prebuilt Chromium; stripping it breaks the crash handler
#   and gains nothing that upstream has not already done.
# mirror/bindist: not ours to redistribute.
RESTRICT="bindist mirror strip"

# Read off the shipped binary, not copied from another Electron ebuild: one
# atom per DT_NEEDED entry of opt/nexus/nexus that glibc and gcc do not already
# provide. at-spi2-core:2 covers libatk-1.0, libatk-bridge-2.0 and libatspi,
# which Gentoo merged into it. Two entries are not DT_NEEDED and are here on
# purpose: libsecret is dlopened by Electron's safeStorage and the app refuses
# to run without a working keystore, and xdg-utils is what shell.openExternal
# execs to open a link. Chromium's optional dlopens (libpulse, libva,
# libdbusmenu) are deliberately absent — it degrades cleanly without them.
RDEPEND="
	app-accessibility/at-spi2-core:2
	app-crypt/libsecret
	dev-libs/expat
	dev-libs/glib:2
	dev-libs/nspr
	dev-libs/nss
	media-libs/alsa-lib
	media-libs/mesa
	net-print/cups
	sys-apps/dbus
	virtual/libudev
	x11-libs/cairo
	x11-libs/gtk+:3
	x11-libs/libX11
	x11-libs/libXcomposite
	x11-libs/libXdamage
	x11-libs/libXext
	x11-libs/libXfixes
	x11-libs/libXrandr
	x11-libs/libxcb
	x11-libs/libxkbcommon
	x11-libs/pango
	x11-misc/xdg-utils
"

QA_PREBUILT="opt/${MY_PN}/*"

src_install() {
	local destdir="/opt/${MY_PN}"

	# cp -a rather than `doins -r`: the tarball already carries the right modes
	# (the Electron binary, the SUID helper and the .so files are executable)
	# and doins would flatten every one of them to 0644.
	dodir "${destdir}"
	cp -a "${S}"/. "${ED}${destdir}"/ || die "failed to stage ${destdir}"
	rm "${ED}${destdir}/icon.png" || die

	# The Chromium SUID sandbox helper. On a kernel with unprivileged user
	# namespaces — Gentoo's dist-kernel and any sane config — Electron uses the
	# namespace sandbox and never runs this file. Where CONFIG_USER_NS is off it
	# is the only sandbox left, and Chromium refuses to start rather than run a
	# renderer unconfined. 4711 is the mode the helper is written for.
	fowners root:root "${destdir}/chrome-sandbox"
	fperms 4711 "${destdir}/chrome-sandbox"

	dosym -r "${destdir}/${MY_PN}" "/usr/bin/${MY_PN}"

	# electron-builder generates the .desktop entry and the hicolor icons only
	# for targets that install something (AppImage, deb, rpm). A tar.gz is just
	# the directory, so both are produced here, from the icon the build placed
	# beside the executable for exactly this purpose.
	newicon -s 512 "${S}/icon.png" "${MY_PN}.png"

	cat > "${T}/${DESKTOP_ID}.desktop" <<-EOF || die
		[Desktop Entry]
		Type=Application
		Version=1.0
		Name=Nexus
		Comment=${DESKTOP_COMMENT}
		Comment[sr]=${DESKTOP_COMMENT_SR}
		Comment[sr@latin]=${DESKTOP_COMMENT_SR}
		Exec=${destdir}/${MY_PN}
		Icon=${MY_PN}
		Terminal=false
		Categories=Utility;
		StartupNotify=true
		StartupWMClass=${DESKTOP_ID}
	EOF
	domenu "${T}/${DESKTOP_ID}.desktop"
}

pkg_postinst() {
	xdg_pkg_postinst

	elog "Nexus stores everything locally, in an encrypted SQLite database under"
	elog "  ~/.config/Nexus"
	elog
	elog "The device half of the key chain goes through Electron's safeStorage,"
	elog "which on Linux needs a running Secret Service provider (gnome-keyring,"
	elog "KWallet, KeePassXC with Secret Service enabled). Without one Nexus"
	elog "refuses to create or unlock an account instead of silently weakening"
	elog "the key chain — that refusal is the design, not a bug."
	elog
	elog "Cloud sync is off by default and this build makes no network calls"
	elog "until it is explicitly turned on."
}
