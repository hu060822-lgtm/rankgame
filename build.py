#!/usr/bin/env python3
"""Inline src/prompts.txt into src/game.html and write index.html (standalone) + dist/artifact.html (fragment)."""
import os, json
root = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(root, 'src/game.html'), encoding='utf-8').read()
prompts = open(os.path.join(root, 'src/prompts.txt'), encoding='utf-8').read().strip()
assert '`' not in prompts and '${' not in prompts
frag = src.replace('__PROMPTS__', prompts)
os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
open(os.path.join(root, 'dist/artifact.html'), 'w', encoding='utf-8').write(frag)
full = ('<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n'
        + frag + '\n</body>\n</html>\n')
open(os.path.join(root, 'index.html'), 'w', encoding='utf-8').write(full)
print('ok', len(full))
