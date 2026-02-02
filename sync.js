const fs = require("fs");

const PAGE_URL = process.env.PAGE_URL;

if (!PAGE_URL) {
  console.error("Missing PAGE_URL env var.");
  process.exit(1);
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return await res.text();
}

// 🔍 CSS URL aus Webflow HTML holen
function findWebflowCSSUrl(html) {
  const links = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)]
    .map(m => m[1]);

  const wfCss = links.find(url => url.includes("webflow"));
  if (!wfCss) throw new Error("Webflow CSS link not found");
  return wfCss;
}

// 🧠 Klassen aus markierten Elementen lesen
function extractComponentClasses(html) {
  const matches = [...html.matchAll(/css-dok="true"[^>]*class="([^"]+)"/g)];
  const classes = new Set();

  matches.forEach(m => {
    m[1].split(/\s+/).forEach(c => classes.add(c));
  });

  return [...classes];
}

// 🎨 CSS Regeln extrahieren
function extractRelevantCSS(cssText, classes) {
  const components = {};
  classes.forEach(c => (components[c] = []));

  const ruleRegex = /([^{@}][^{]*?)\{([^}]*)\}/g;
  let m;

  while ((m = ruleRegex.exec(cssText)) !== null) {
    const selector = m[1].trim();
    const body = m[2].trim();
    if (!selector || !body) continue;

    for (const c of classes) {
      if (selector.includes("." + c)) {
        components[c].push(`${selector} {\n${body}\n}`);
      }
    }
  }

  return components;
}

(async () => {
  try {
    console.log("🌍 Fetching page:", PAGE_URL);
    const html = await fetchText(PAGE_URL);

    const cssUrl = findWebflowCSSUrl(html);
    console.log("🎨 CSS URL:", cssUrl);

    const css = await fetchText(cssUrl);
    fs.writeFileSync("latest.css", css, "utf8");

    const classes = extractComponentClasses(html);
    console.log("📦 Components found:", classes);

    const components = extractRelevantCSS(css, classes);
    fs.writeFileSync("components.json", JSON.stringify(components, null, 2), "utf8");

    console.log("✔ Updated components.json");

  } catch (err) {
    console.error("❌ Sync failed:", err.message);
    process.exit(1);
  }
})();
