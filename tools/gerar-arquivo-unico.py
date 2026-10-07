#!/usr/bin/env python3
"""Gera dist/Repertorio-Louvor.html: o app inteiro num arquivo só, que abre com dois cliques
(sem servidor). Precisa do bun (https://bun.sh) para juntar os módulos JavaScript.
Uso: python3 tools/gerar-arquivo-unico.py
"""
import base64, os, subprocess, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
dist = root / 'dist'; dist.mkdir(exist_ok=True)
js_out = dist / '_app.js'
subprocess.run(['bun', 'build', str(root / 'js/main.js'), '--outfile', str(js_out), '--format=iife', '--minify-syntax'], check=True)
js = js_out.read_text(encoding='utf-8').replace('</script', '<\\/script')
css = (root / 'css/app.css').read_text(encoding='utf-8')
icon = base64.b64encode((root / 'icons/icon.svg').read_bytes()).decode()
html = f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Repertório Louvor</title>
<link rel="icon" href="data:image/svg+xml;base64,{icon}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>{css}</style>
</head>
<body>
<div id="app"><p class="boot">Carregando repertório…</p></div>
<script>window.__NO_SW__ = true;</script>
<script>{js}</script>
</body>
</html>
"""
(dist / 'Repertorio-Louvor.html').write_text(html, encoding='utf-8')
js_out.unlink()
print('gerado:', dist / 'Repertorio-Louvor.html', round(len(html) / 1024), 'KB')
