#!/usr/bin/env python3
"""Portable launcher: `python yggdrasil/run.py [--port 8420] [--open]`.

Works from any working directory and needs no packages beyond the standard
library.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from server.app import main  # noqa: E402

if __name__ == "__main__":
    main()
