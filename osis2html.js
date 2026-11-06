// Converts LBCF1689FIN.xml (OSIS) into a static HTML site under html/.
// Each <div type="chapter"> becomes its own page; index.html holds the table of contents.
// Visual identity follows https://reba.fi (fonts and illustrations in html/assets/).

import pkg from "jsdom";
const { JSDOM } = pkg;
import fs from "fs";
import path from "path";

const OUT_DIR = "html";
const BOOK_TITLE = "1689 Lontoon baptistien uskontunnustus ja baptistikatekismus vuodelta 1693";
const EDITORS = "Toim. Eelis Halmemies, Juhana Lalli, Mikko Sivonen";

// Chapters (by osisID) that are prayers/hymns whose source line breaks are meaningful.
const VERSE_CHAPTERS = new Set([
    "Katekismus ISÄ MEIDÄN RUKOUS",
    "Katekismus APOSTOLINEN USKONTUNNUSTUS",
    "Katekismus YHTEINEN SYNNINTUNNUSTUS I",
    "Katekismus YHTEINEN SYNNINTUNNUSTUS II",
    "Katekismus HERRAA HYVÄÄ KIITTÄKÄÄ",
]);
const APPENDIX_CHAPTERS = new Set([...VERSE_CHAPTERS, "Katekismus KYMMENEN KÄSKYÄ"]);

const SECTIONS = {
    intro: { title: "Alkusanat" },
    confession: { title: "1689 Lontoon baptistien uskontunnustus", eyebrow: "Uskontunnustus" },
    catechism: { title: "Englantilainen baptistikatekismus", subtitle: "Vuodelta 1693", eyebrow: "Baptistikatekismus 1693" },
    appendix: { title: "Liitteet", eyebrow: "Liitteet" },
};

const toLink = ref => `https://www.stepbible.org/?q=version=FinPR|reference=${ref}`;

const escapeHtml = s => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function sectionOf(osisID) {
    if (osisID.startsWith("Luku ")) return "confession";
    if (APPENDIX_CHAPTERS.has(osisID)) return "appendix";
    if (osisID.startsWith("Katekismus ")) return "catechism";
    return "intro";
}

function fileNameOf(osisID) {
    return `${osisID.replace(/[ äöÄÖ]/g, "_")}.html`;
}

// Replace element `el` with a new element `tag`, moving all children over.
function rename(doc, el, tag, className) {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    while (el.firstChild) n.appendChild(el.firstChild);
    el.parentNode.replaceChild(n, el);
    return n;
}

// Convert OSIS markup inside an (HTML-document-owned) chapter element into plain HTML.
function convertMarkup(doc, root) {
    for (const r of Array.from(root.querySelectorAll("reference"))) {
        const a = rename(doc, r, "a");
        a.setAttribute("href", toLink(r.getAttribute("osisRef")));
    }
    for (const hi of Array.from(root.querySelectorAll("hi"))) {
        rename(doc, hi, "span", hi.getAttribute("type"));
    }
    for (const l of Array.from(root.querySelectorAll("list"))) rename(doc, l, "ul");
    for (const itm of Array.from(root.querySelectorAll("item"))) rename(doc, itm, "li");
    for (const n of Array.from(root.querySelectorAll("note"))) {
        const span = rename(doc, n, "span", `note note-${n.getAttribute("type")}`);
        if (span.classList.contains("note-crossReference")) {
            span.setAttribute("aria-label", "Raamatunviitteet");
        }
    }
    for (const d of Array.from(root.querySelectorAll("divineName"))) rename(doc, d, "span", "divineName");

    // Tidy whitespace left over from the source indentation:
    // "Jes. 44:6</a> ." -> "Jes. 44:6</a>." and no padding inside reference notes.
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const t of texts) {
        if (t.previousSibling && t.previousSibling.nodeType === 1) {
            t.nodeValue = t.nodeValue.replace(/^\s+(?=[.,;:)])/, "");
        }
        const parent = t.parentNode;
        if (parent.classList && parent.classList.contains("note-crossReference")) {
            if (t === parent.firstChild) t.nodeValue = t.nodeValue.replace(/^\s+/, "");
            if (t === parent.lastChild) t.nodeValue = t.nodeValue.replace(/\s+$/, "");
        }
    }

    // A <ul> may not live inside <p> in HTML; turn such paragraphs into divs.
    for (const p of Array.from(root.querySelectorAll("p"))) {
        if (p.querySelector("ul")) rename(doc, p, "div", "p");
    }
}

// Pull the page heading(s) out of the chapter and turn the remaining titles into <h2>.
function extractHeading(doc, chap) {
    const titles = Array.from(chap.querySelectorAll("title"));
    const first = titles[0];
    const text = first.textContent.trim();
    first.remove();

    let eyebrow = null;
    let heading = text;
    let tocLabel = text;

    // A second title right at the start (possibly after one short line, possibly wrapped in <p>):
    // the first title is a superscription, the second the actual heading.
    const second = titles[1];
    if (second) {
        let block = second;
        while (block.parentNode !== chap) block = block.parentNode;
        const idx = Array.from(chap.children).indexOf(block);
        if (idx <= 1) {
            const extra = Array.from(chap.children).slice(0, idx).map(e => e.textContent.trim().toLowerCase());
            eyebrow = [text, ...extra].join(", ");
            heading = second.textContent.trim();
            tocLabel = heading;
            for (const e of Array.from(chap.children).slice(0, idx)) e.remove();
            block.remove();
        }
    }

    const m = /^Luku (\d+):\s*(.*)$/.exec(text);
    if (m) {
        eyebrow = `Luku ${m[1]}`;
        heading = m[2];
    }

    for (const t of Array.from(chap.querySelectorAll("title"))) {
        const parent = t.parentNode;
        const h2 = rename(doc, t, "h2");
        // <p><title/></p> -> <h2/>
        if (parent.tagName.toLowerCase() === "p" && parent.textContent.trim() === h2.textContent.trim()) {
            parent.parentNode.replaceChild(h2, parent);
        }
    }
    return { eyebrow, heading, tocLabel, number: m ? Number(m[1]) : null };
}

// Mark the leading "1." paragraph numbers in confession chapters.
function markParagraphNumbers(doc, chap) {
    for (const p of chap.querySelectorAll(":scope > p")) {
        const t = p.firstChild;
        if (!t || t.nodeType !== 3) continue;
        const m = /^(\s*)(\d+)\.\s+/.exec(t.nodeValue);
        if (!m) continue;
        t.nodeValue = t.nodeValue.slice(m[0].length);
        const num = doc.createElement("span");
        num.className = "para-num";
        num.textContent = m[2];
        p.insertBefore(num, t);
        p.classList.add("numbered");
    }
}

const QA_KINDS = [
    [/^\d+\.\s*KYSYMYS$/, "question"],
    [/^VASTAUS$/, "answer"],
    [/^RAAMATTU$/, "scripture"],
    [/^KTS\. MYÖS$/, "see-also"],
    [/^KOMMENTTI$/, "comment"],
];

// Group catechism paragraphs (KYSYMYS / VASTAUS / RAAMATTU / KTS. MYÖS / KOMMENTTI) into cards.
function groupCatechism(doc, chap) {
    let card = null;
    let lastKind = null;
    for (const el of Array.from(chap.children)) {
        const tag = el.tagName.toLowerCase();
        if (tag !== "p") {
            card = null;
            continue;
        }
        const label = el.querySelector(":scope > span.bold:first-child");
        const labelText = label ? label.textContent.trim() : "";
        const kind = (QA_KINDS.find(([re]) => re.test(labelText)) || [])[1];

        if (kind === "question") {
            card = doc.createElement("section");
            card.className = "qa";
            const num = /^(\d+)/.exec(labelText)[1];
            card.id = `k${num}`;
            el.parentNode.insertBefore(card, el);
        }
        if (!card) continue;

        if (kind) {
            el.classList.add(`qa-${kind}`);
            label.className = "qa-label";
            if (kind === "question") {
                const num = /^(\d+)/.exec(labelText)[1];
                label.innerHTML = `<span class="qa-num">${num}</span><span class="qa-word">Kysymys</span>`;
            } else {
                label.textContent = labelText.charAt(0) + labelText.slice(1).toLowerCase();
            }
            // Drop the ": " separator that follows the label.
            const next = label.nextSibling;
            if (next && next.nodeType === 3) next.nodeValue = next.nodeValue.replace(/^\s*:\s*/, "");
            lastKind = kind;
        } else if (lastKind === "comment") {
            el.classList.add("qa-comment", "qa-comment-cont");
        }
        card.appendChild(el);
    }
}

const ICON_ARROW_L = `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_ARROW_R = `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_TOC = `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function head(title, description) {
    return `<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="assets/img/reba-logo.png">
<link rel="preload" href="assets/fonts/bitter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/montserrat-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="style.css">
<script>try{if(localStorage.getItem("hideRefs")==="1")document.documentElement.classList.add("hide-refs")}catch(e){}</script>
</head>`;
}

function topBar({ showRefToggle }) {
    return `<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="https://reba.fi" title="Jyväskylän reformoitu baptistiseurakunta">
      <img src="assets/img/reba-logo.png" alt="Reba" width="44" height="44">
    </a>
    <a class="topbar-title" href="index.html">${ICON_TOC}<span>Sisällys</span></a>
    ${showRefToggle ? `<button class="ref-toggle" type="button" aria-pressed="true" title="Näytä tai piilota Raamatunviitteet">Viitteet</button>` : `<span></span>`}
  </div>
</header>`;
}

function hero(variant) {
    return `<div class="hero hero-${variant}" aria-hidden="true">
  <picture>
    <source media="(min-width: 769px)" srcset="assets/img/hero-puu.webp">
    <source media="(min-width: 481px)" srcset="assets/img/hero-768.webp">
    <img src="assets/img/hero-480.webp" alt="" width="1600" height="530">
  </picture>
</div>`;
}

function footer() {
    return `<footer class="site-footer">
  <a class="footer-art" href="https://reba.fi" title="Jyväskylän reformoitu baptistiseurakunta"><img src="assets/img/reba-logo-white.png" alt="Reba" width="400" height="235" loading="lazy"></a>
  <div class="footer-body">
    <p>© 2021 Agricola teologinen instituutti ja tekijät</p>
    <p>Kirja saatavilla paperiversiona kirjakaupoista, esim. <a href="https://www.adlibris.com/fi/kirja/1689-lontoon-baptistien-uskontunnustus-ja-baptistikatekismus-vuodelta-1693-9789526976709">Adlibris</a>.</p>
    <p>Voit lukea kirjaa kätevästi myös Android-laitteellasi <a href="https://play.google.com/store/apps/details?id=net.bible.android.activity">AndBible-sovelluksella</a>.</p>
    <p>Lähdekoodit ja jakelulupatiedot <a href="https://github.com/AndBible/LBCF1689FIN">GitHubissa</a>.</p>
    <p class="footer-reba"><a href="https://reba.fi">Jyväskylän reformoitu baptistiseurakunta</a></p>
  </div>
</footer>`;
}

const SCRIPT = `<script>
(function(){
  var root=document.documentElement, btn=document.querySelector(".ref-toggle");
  function sync(){ if(btn) btn.setAttribute("aria-pressed", root.classList.contains("hide-refs")?"false":"true"); }
  if(btn){ sync(); btn.addEventListener("click", function(){
    root.classList.toggle("hide-refs");
    try{ localStorage.setItem("hideRefs", root.classList.contains("hide-refs")?"1":"0"); }catch(e){}
    sync();
  }); }
  document.addEventListener("keydown", function(e){
    if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey) return;
    var t=e.target; if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var a = e.key==="ArrowLeft" ? document.querySelector("a[rel=prev]") : e.key==="ArrowRight" ? document.querySelector("a[rel=next]") : null;
    if(a) location.href=a.href;
  });
})();
</script>`;

function pager(prev, next) {
    const prevLink = prev
        ? `<a class="pager-link pager-prev" rel="prev" href="${prev.filename}">${ICON_ARROW_L}<span><small>Edellinen</small>${escapeHtml(prev.navLabel)}</span></a>`
        : `<a class="pager-link pager-prev" rel="prev" href="index.html">${ICON_ARROW_L}<span><small>Edellinen</small>Sisällys</span></a>`;
    const nextLink = next
        ? `<a class="pager-link pager-next" rel="next" href="${next.filename}"><span><small>Seuraava</small>${escapeHtml(next.navLabel)}</span>${ICON_ARROW_R}</a>`
        : `<a class="pager-link pager-next" rel="next" href="index.html"><span><small>Seuraava</small>Sisällys</span>${ICON_ARROW_R}</a>`;
    return `<nav class="pager" aria-label="Sivunavigointi">${prevLink}${nextLink}</nav>`;
}

function chapterPage(page, prev, next) {
    const section = SECTIONS[page.section];
    const eyebrow = page.eyebrow || section.eyebrow || "";
    const hasRefs = page.html.includes("note-crossReference");
    return `${head(`${page.titleText} – ${BOOK_TITLE}`, `${page.titleText}. ${BOOK_TITLE}.`)}
<body class="page-chapter section-${page.section}${page.verse ? " verse" : ""}">
${topBar({ showRefToggle: hasRefs })}
${hero("slim")}
<main class="sheet">
  <article class="chapter">
    <header class="chapter-head">
      ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ""}
      <h1>${escapeHtml(page.heading)}</h1>
      <div class="ornament" aria-hidden="true"></div>
    </header>
    <div class="chapter-body">
${page.html}
    </div>
  </article>
  ${pager(prev, next)}
</main>
${footer()}
${SCRIPT}
</body>
</html>
`;
}

function indexPage(pages) {
    const bySection = s => pages.filter(p => p.section === s);
    const item = (p, extra = "") => `<li${extra}><a href="${p.filename}">${p.number != null ? `<span class="toc-num">${p.number}</span>` : ""}<span class="toc-label">${escapeHtml(p.navLabel)}</span></a></li>`;
    const group = (key, cls) => {
        const s = SECTIONS[key];
        return `<section class="toc-group toc-${key}">
      <h2>${escapeHtml(s.title)}${s.subtitle ? ` <small>${escapeHtml(s.subtitle)}</small>` : ""}</h2>
      <ol class="${cls}">
        ${bySection(key).map(p => item(p)).join("\n        ")}
      </ol>
    </section>`;
    };
    return `${head(BOOK_TITLE, `${BOOK_TITLE}. ${EDITORS}.`)}
<body class="page-index">
${topBar({ showRefToggle: false })}
${hero("full")}
<main class="sheet">
  <header class="book-head">
    <p class="eyebrow">Suomennos</p>
    <h1>1689 Lontoon baptistien uskontunnustus <span>ja baptistikatekismus vuodelta 1693</span></h1>
    <div class="ornament" aria-hidden="true"></div>
    <p class="editors">${escapeHtml(EDITORS)}</p>
  </header>
  <nav class="toc" aria-label="Sisällys">
    ${group("intro", "toc-list")}
    ${group("confession", "toc-list toc-numbered")}
    ${group("catechism", "toc-list toc-caps")}
    ${group("appendix", "toc-list toc-caps")}
  </nav>
</main>
${footer()}
</body>
</html>
`;
}

function convert() {
    const file = fs.readFileSync("LBCF1689FIN.xml", "utf8");
    const xml = new JSDOM(file, { contentType: "text/xml" }).window.document;
    const doc = new JSDOM("<!DOCTYPE html><html><body></body></html>").window.document;

    const pages = [];
    for (const src of Array.from(xml.querySelectorAll('div[type="chapter"]'))) {
        const osisID = src.getAttribute("osisID");
        const chap = doc.importNode(src, true);
        doc.body.appendChild(chap);

        const { eyebrow, heading, tocLabel, number } = extractHeading(doc, chap);
        convertMarkup(doc, chap);
        const section = sectionOf(osisID);
        if (section === "confession") markParagraphNumbers(doc, chap);
        if (section === "catechism") groupCatechism(doc, chap);

        const titleText = number != null ? `Luku ${number}: ${heading}` : heading;
        pages.push({
            osisID,
            filename: fileNameOf(osisID),
            section,
            verse: VERSE_CHAPTERS.has(osisID),
            eyebrow,
            heading,
            number,
            titleText,
            navLabel: number != null ? heading : tocLabel,
            html: chap.innerHTML,
        });
        chap.remove();
    }

    // Remove previously generated pages so renamed/removed chapters do not linger.
    for (const f of fs.readdirSync(OUT_DIR)) {
        if (f.endsWith(".html")) fs.unlinkSync(path.join(OUT_DIR, f));
    }

    pages.forEach((page, i) => {
        fs.writeFileSync(path.join(OUT_DIR, page.filename), chapterPage(page, pages[i - 1], pages[i + 1]));
    });
    fs.writeFileSync(path.join(OUT_DIR, "index.html"), indexPage(pages));
    console.log(`Wrote ${pages.length} chapters + index.html to ${OUT_DIR}/`);
}

convert();
