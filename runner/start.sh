#!/bin/sh
# Virtual screen for a real (headed) Chrome, shared over noVNC so you can
# log in to LinkedIn and clear security checks by hand.
set -e
: "${VNC_PASSWORD:?VNC_PASSWORD must be set}"
rm -f /tmp/.X99-lock
# A crash can leave Chrome's profile lock behind, which blocks the next start.
rm -f /data/profile/SingletonLock /data/profile/SingletonSocket /data/profile/SingletonCookie
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp &
export DISPLAY=:99
mkdir -p "$HOME/.vnc"
x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null
x11vnc -display :99 -rfbauth "$HOME/.vnc/passwd" -forever -shared -localhost -quiet &
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
exec node src/runner.js
