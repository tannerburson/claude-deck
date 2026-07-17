#!/usr/bin/env bash

streamdeck unlink pro.clever.claudedeck || true
streamdeck link pro.clever.claudedeck.sdPlugin
streamdeck restart pro.clever.claudedeck