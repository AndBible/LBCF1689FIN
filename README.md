# 1689 Lontoon baptistien uskontunnustus ja baptistikatekismus vuodelta 1693

OSIS XML source & Sword module

## Available via [AndBible](https://play.google.com/store/apps/details?id=net.bible.android.activity). Read book in browser [here](https://andbible.github.io/LBCF1689FIN/html/)!

## Building:

Sword module:

`bash ./build.sh`

HTML:
- install dependencies first `npm install`
- then `node osis2html.js` (regenerates every page in `html/`)

The page layout and styles follow the visual identity of [reba.fi](https://reba.fi)
(Jyväskylän reformoitu baptistiseurakunta); fonts and illustrations are in `html/assets/`.
Preview locally e.g. with `python3 -m http.server -d html 8080`.

## License

This work has been licenced under conditions of CC BY-NC-ND 4.0
See https://creativecommons.org/licenses/by-nc-nd/4.0/
