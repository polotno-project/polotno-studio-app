#!/bin/bash
# Installs the rpm or pacman package inside a stock distro container, checks
# what it registers, renders a template with the `polotno` CLI as a normal
# user and removes the package again. Used by CI (build.yml); run it locally
# from the repo root after `electron-builder --linux rpm pacman --x64`:
#
#   docker run --rm --platform linux/amd64 --security-opt seccomp=unconfined \
#     -v "$PWD":/w -w /w fedora:latest scripts/linux-package-smoke.sh fedora
#
# seccomp=unconfined: Docker's default profile blocks the user namespaces
# Chromium's sandbox needs (and pacman's own sandbox under emulation).
set -euo pipefail
distro="$1"
cd /w

case "$distro" in
  fedora)
    dnf install -y -q ./dist/polotno-app-*.x86_64.rpm xorg-x11-server-Xvfb xorg-x11-xauth \
      desktop-file-utils
    ;;
  opensuse)
    zypper --non-interactive -q install --allow-unsigned-rpm ./dist/polotno-app-*.x86_64.rpm \
      xvfb-run desktop-file-utils
    ;;
  arch)
    sed -i 's/^\[options\]/[options]\nDisableSandbox/' /etc/pacman.conf
    pacman -Syu --noconfirm --needed xorg-server-xvfb xorg-xauth desktop-file-utils
    pacman -U --noconfirm ./dist/polotno-app-*.pacman
    ;;
  *)
    echo "usage: $0 fedora|opensuse|arch" >&2
    exit 2
    ;;
esac

set -x
test "$(readlink -f /usr/bin/polotno)" = /opt/Polotno/polotno
if ldd /opt/Polotno/polotno | grep 'not found'; then exit 1; fi
grep -q 'application/x-polotno:\*\.polotno' /usr/share/mime/globs2
grep -q '^application/x-polotno=polotno-app.desktop' /usr/share/applications/mimeinfo.cache
test -e /usr/share/icons/hicolor/512x512/apps/polotno.png
# electron-updater picks RpmUpdater / PacmanUpdater from this file.
expected_type=rpm; [ "$distro" = arch ] && expected_type=pacman
test "$(cat /opt/Polotno/resources/package-type)" = "$expected_type"

useradd -m smoke
su smoke -c 'cd /tmp && xvfb-run -a polotno render /w/src/renderer/src/templates/social-media-post.json -o /tmp/smoke.png --pixel-ratio 1'
test -s /tmp/smoke.png
set +e; su smoke -c 'cd /tmp && xvfb-run -a polotno render'; code=$?; set -e
test "$code" -eq 2

case "$distro" in
  fedora) dnf remove -y -q polotno-app ;;
  opensuse) zypper --non-interactive -q remove polotno-app ;;
  arch) pacman -R --noconfirm polotno-app ;;
esac
test ! -e /usr/bin/polotno
test ! -e /opt/Polotno
