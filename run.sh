#!/bin/bash
cd ~/medieval-sim
PYTHONPATH="$(pwd -W)" /c/Users/tkang/AppData/Local/Programs/Python/Python313/python.exe -E -s "$@" 2>&1 | grep -v "__del__\|Traceback (most\|_delete\|Exception ignored\|site-packages"
