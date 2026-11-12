#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p public
cp index.html game.js phaser.min.js public/
npx --yes wrangler deploy
