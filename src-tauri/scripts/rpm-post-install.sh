#!/bin/bash
# Reload udev rules so the new rule takes effect immediately after install.
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=input 2>/dev/null || true
