#!/bin/sh
# Reload udev rules so /dev/uinput becomes accessible for the paste feature.
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --name-match=uinput 2>/dev/null || true
