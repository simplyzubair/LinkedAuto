#!/bin/sh
# Virtual screen for a real (headed) Chrome, shared over noVNC so you can
# log in to LinkedIn and clear security checks by hand.
set -e
: "${VNC_PASSWORD:?VNC_PASSWORD must be set}"
rm -f /tmp/.X99-lock
# A crash can leave Chrome's profile lock behind, which blocks the next start.
rm -f /data/profile/SingletonLock /data/profile/SingletonSocket /data/profile/SingletonCookie 2>/dev/null || true
# Chrome can't start without write access to its profile. Say why plainly and
# wait before exiting, so Docker's restarts don't spin.
if ! touch /data/profile/.write-test 2>/dev/null; then
  echo "ERROR: the browser profile folder is not writable by uid $(id -u)." >&2
  echo "Fix it on the NAS (no sudo needed), then restart the runner:" >&2
  echo "  docker run --rm --user root --entrypoint sh -v /volume1/docker/linkedauto/browser-profile:/p linkedauto-runner -c 'chown -R 1000:1000 /p'" >&2
  sleep 300
  exit 1
fi
rm -f /data/profile/.write-test
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp &
export DISPLAY=:99
mkdir -p "$HOME/.vnc"
x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null
x11vnc -display :99 -rfbauth "$HOME/.vnc/passwd" -forever -shared -localhost -quiet &
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
exec node src/runner.js
