// sync.js
// Holt die veröffentlichte Webflow-Seite,
// liest daraus automatisch die aktuelle Webflow-CSS-URL,
// lädt das CSS, extrahiert definierte Komponenten-Klassen
// und schreibt components.json + latest.css

const fs = require("fs");

const PAGE_URL = process.env.PAGE_URL; // 👉 deine Webflow Seiten-URL
const COMPONENT_CLASSES = (process.env.COMPONENT_CLASSES || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

if (!PAGE_URL) {
  console.error("Missing PAGE_URL env var.");
  process.exit(1);
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

// 🔍 Findet die aktuelle Webflow CSS Datei im HTML
function findWebflowCSSUrl(html) {
  const match = html.match(/https:\/\/cdn\.prod\.website-files\.com[^"]+\.css/);
  if (!match) throw new Error("Webflow CSS link not found in page HTML");
  return match[0];
}

// 🔧 CSS-Regeln für gewünschte Klassen extrahieren
function extractRelevantCSS(cssText, classes) {
  if (!classes.length) return { components: {} };

  const components = {};
  classes.forEach(c => (components[c] = []));

  const ruleRegex = /([^{@}][^{]*?)\{([^}]*)\}/g;
  let m;

  while ((m = ruleRegex.exec(cssText)) !== null) {
    const selector = m[1].trim();
    const body = m[2].trim();
    if (!selector || !body) continue;

    for (const c of classes) {
      // Robuster Match (auch .btn-primary.w-button etc.)
      if (selector.includes("." + c)) {
        components[c].push(`${selector} {\n${body}\n}`);
      }
    }
  }

  return { components };
}

(async () => {
  try {
    console.log("🌍 Fetching page:", PAGE_URL);
    const html = await fetchText(PAGE_URL);

    console.log("🔎 Finding Webflow CSS URL...");
    const cssUrl = findWebflowCSSUrl(html);
    console.log("🎨 CSS URL:", cssUrl);

    const css = await fetchText(cssUrl);

    // Snapshot der kompletten CSS-Datei
    fs.writeFileSync("latest.css", css, "utf8");

    // Komponenten extrahieren
    const { components } = extractRelevantCSS(css, COMPONENT_CLASSES);
    fs.writeFileSync("components.json", JSON.stringify(components, null, 2), "utf8");

    console.log("✔ Updated latest.css and components.json");
    console.log("✔ Classes:", COMPONENT_CLASSES.join(", ") || "(none)");

  } catch (err) {
    console.error("❌ Sync failed:", err.message);
    process.exit(1);
  }
})();
