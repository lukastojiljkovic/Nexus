# Nexus on Linux — AppImage and the Gentoo overlay

Gentoo has no installer file. Its native unit of installation is an *ebuild* in
a *repository* (an overlay), and for a prebuilt Electron application the correct
shape is a `-bin` ebuild that unpacks a release tarball into `/opt` — portage is
not going to rebuild Chromium out of this repo. So the Linux side of Nexus ships
as three things, produced by one build:

| Artifact | What it is for |
| --- | --- |
| `Nexus-<version>-x86_64.AppImage` | Runs on any glibc desktop with no packaging at all. Mark executable, double-click. |
| `nexus-<version>-linux-x64.tar.gz` | The payload the ebuild installs. Also a fine manual install: unpack anywhere, run `./nexus`. |
| `app-office/nexus-bin/nexus-bin-<version>.ebuild` | The real Gentoo installation — `emerge nexus-bin`, with a menu entry, an icon and a `/usr/bin/nexus` symlink. |

---

## 1. Building the artifacts

The build runs **on Linux**, and only on Linux. `scripts/dist.mjs` refuses any
other host on purpose — an AppImage wants Linux tooling, and nothing here has
ever produced or opened a cross-built artifact. This used to be a statement
about the SQLite native module, which was fetched per platform and would have
landed in the archive as a Windows `.node`. Since 13.0.3 the npm package
carries all eight platform binaries and `electron-builder.yml` keeps the
TARGET's, so that half of the reason is gone and the refusal now rests on the
packaging toolchain alone.

WSL is enough — it is a real Linux userspace and the artifacts it produces are
ordinary Linux artifacts. No Docker, no VM.

```sh
# In a Linux shell with Node >= 24 and pnpm 11 (a home-directory tarball
# install of Node is fine; nothing here needs root):
pnpm install --frozen-lockfile
pnpm build                          # required in a fresh tree — see below
pnpm --filter @nexus/desktop dist
```

`pnpm build` is not optional the first time: the `@nexus/*` workspace packages
resolve through their built `dist/`, and `dist.mjs` calls electron-vite directly
rather than going through turbo, so it does not build them for you. Skipping it
fails with a Vite „failed to resolve entry for package" and no other clue.

The repo root has a `Makefile` that runs exactly those three commands in that
order, and refuses a non-Linux host up front with the reason above rather than
letting you find out at the first query:

```sh
make linux
```

It is a convenience, not a requirement — it wraps the same pnpm scripts, and
needs GNU make and a POSIX shell.

Both artifacts land in `apps/desktop/release/`.

Nothing has to be installed system-wide to build the AppImage: electron-builder
downloads its own AppImage toolchain into `~/.cache/electron-builder`. It does
need network access on the first run.

---

## 2. The AppImage

```sh
chmod +x Nexus-1.2.0-x86_64.AppImage
./Nexus-1.2.0-x86_64.AppImage
```

**No FUSE required.** The build pins electron-builder's static AppImage runtime
(`toolsets.appimage`), not the default FUSE2 one. The default produces an image
that cannot start without `libfuse.so.2`, which Ubuntu 22.04+, Fedora 38+ and
Gentoo no longer install — it fails with `dlopen(): error loading libfuse.so.2`
before any application code runs.

**The Chromium sandbox is left ON.** The FUSE2 toolset passes `--no-sandbox` by
default, and `appImage.executableArgs` in `electron-builder.yml` states the empty
list explicitly so the guarantee does not depend on which toolset is selected.
Nexus renders documents and attachments the user supplied, which is precisely the
case an OS-level renderer sandbox exists for; turning it off to avoid a startup
error would be trading the wrong thing.

The cost is that a host with unprivileged user namespaces disabled refuses to
start rather than starting unprotected:

> `The SUID sandbox helper binary was found, but is not configured correctly.`

Two hosts hit this in practice:

* **Ubuntu 23.10+**, which restricts unprivileged `CLONE_NEWUSER` through
  AppArmor. Either install an AppArmor profile for the AppImage, or run
  `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0`.
* **A kernel built without `CONFIG_USER_NS`.** Use the ebuild instead — it
  installs the SUID sandbox helper, which is the supported fallback.

Gentoo's own kernels enable user namespaces, so the AppImage runs there as-is.

---

## 3. The Gentoo overlay

### 3.1 Add the repository

The overlay is the `gentoo/` directory itself — `metadata/layout.conf`,
`profiles/` and `app-office/nexus-bin/`. Point portage at a copy of it:

```sh
sudo mkdir -p /var/db/repos/nexus
sudo cp -a apps/desktop/build/gentoo/. /var/db/repos/nexus/
sudo chown -R portage:portage /var/db/repos/nexus
```

```sh
# /etc/portage/repos.conf/nexus.conf
[nexus]
location = /var/db/repos/nexus
masters = gentoo
auto-sync = no
```

### 3.2 Accept the licence

Nexus is commercial software, so its licence is in the `EULA` group that the
default profile does not accept:

```sh
# /etc/portage/package.license/nexus
app-office/nexus-bin all-rights-reserved
```

The package is `~amd64`, so it also needs an accept-keywords entry:

```sh
# /etc/portage/package.accept_keywords/nexus
app-office/nexus-bin ~amd64
```

### 3.3 Give portage the tarball

`SRC_URI` names a GitHub release. Until that release exists, hand portage the
tarball directly:

```sh
sudo cp nexus-1.2.0-linux-x64.tar.gz /var/cache/distfiles/
sudo chown portage:portage /var/cache/distfiles/nexus-1.2.0-linux-x64.tar.gz
```

**There is no `Manifest` committed beside the ebuild, and that is deliberate.**
A Manifest is the digest of one exact tarball, and the tarball is produced by
`pnpm --filter @nexus/desktop dist` **on Linux** — `dist.mjs` refuses to emit a
Linux target from a Windows host, because the native SQLite module underneath it
is built for the host it runs on. One was committed for 1.1.0 and survived the
bump to 1.2.0 as a digest of a file the ebuild would never fetch again: a hash
that authenticates nothing while reading as though it authenticates something.
It is generated where the tarball is:

```sh
cd /var/db/repos/nexus/app-office/nexus-bin
sudo ebuild nexus-bin-1.2.0.ebuild manifest
```

### 3.4 Install

```sh
sudo emerge --ask app-office/nexus-bin
```

You get `/opt/nexus`, a `/usr/bin/nexus` symlink, an icon in the hicolor theme
and `rs.stojiljkovic.nexus.desktop` in the application menu. That desktop-file
name is not cosmetic: Electron derives its Wayland/X11 `app_id` from
`desktopName` in the app's `package.json`, and the entry's `StartupWMClass` has
to match it or the running window shows up as a second, nameless icon in the
dock instead of attaching to its launcher.

---

## 4. What Nexus needs from the desktop

**A Secret Service provider is required** — gnome-keyring, KWallet, or KeePassXC
with Secret Service enabled. The device-bound half of the key chain goes through
Electron's `safeStorage`, and on Linux that is libsecret. Without a provider,
`safeStorage.isEncryptionAvailable()` is false and Nexus **refuses** to create or
unlock an account. That refusal is the design (ADR-018: no silent PIN-only
downgrade), not a defect — but it does mean a bare window manager with no
keyring daemon gives you an app you cannot log into.

Everything else is ordinary Chromium runtime: GTK 3, NSS, ALSA, dbus, mesa. The
ebuild's `RDEPEND` lists them; the AppImage assumes they are already there,
which on a desktop system they are.

User data lives in `~/.config/Nexus` — an SQLCipher-encrypted database plus the
key-chain files. Cloud sync is off by default and the local-only path makes no
network calls at all.

---

## 5. What has and has not been proved

**Proved by running it**, on Ubuntu 24.04 under WSLg with no `libfuse2` present:
the AppImage launches, stays up, and creates `~/.config/Nexus`. The packaged tree
was also started directly on a host that began with no desktop libraries at all,
after installing exactly the Debian equivalents of the ebuild's `RDEPEND` — which
is what makes that list complete rather than plausible.

**Not proved:** the ebuild has not been run through portage, because there is no
Gentoo machine here. It is written against EAPI 8 and the `desktop`/`xdg`
eclasses, and every path in it corresponds to a file verified present in the
tarball, but `emerge` has not executed it. The first real install is the test.
