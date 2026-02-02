// sync.js
// Lädt Webflow-CSS, extrahiert Regeln für definierte "Komponenten-Klassen"
// und schreibt components.json + latest.css

const fs = require("fs");

const CSS_URL = process.env.CSS_URL;

// Welche Klassen sollen als "Komponenten" dokumentiert werden?
// -> trage hier deine System-Klassen ein (z.B. btn-primary, input, card, etc.)
const COMPONENT_CLASSES = (process.env.COMPONENT_CLASSES || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

if (!CSS_URL) {
  console.error("Missing CSS_URL env var.");
  process.exit(1);
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

// Hilfsfunktion: alle CSS-Blöcke (inkl. @media/@supports) grob erfassen
function extractRelevantCSS(cssText, classes) {
  // Wenn keine Klassen angegeben sind: wir speichern nur das komplette CSS als latest.css
  if (!classes.length) return { components: {}, snippets: [] };

  const components = {};
  classes.forEach(c => (components[c] = []));

  // Sehr pragmatischer Ansatz:
  // Wir suchen alle Vorkommen von ".class" in Regeln (auch :hover etc.),
  // und nehmen den gesamten Regelblock auf.
  //
  // Das ist NICHT ein vollständiger CSS-Parser, aber in der Praxis für Webflow-Output
  // oft ausreichend, solange du klare "System-Klassen" hast.
  const ruleRegex = /([^{@}][^{]*?)\{([^}]*)\}/g; // einfache STYLE_RULE Blöcke
  let m;

  while ((m = ruleRegex.exec(cssText)) !== null) {
    const selector = m[1].trim();
    const body = m[2].trim();
    if (!selector || !body) continue;

    for (const c of classes) {
      // Match .class als "Wort"
      const classHit = new RegExp(`\\.${c}(?![\\w-])`).test(selector);
      if (classHit) {
        components[c].push(`${selector} {\n${body}\n}`);
      }
    }
  }

  return { components };
}

(async () => {
  try {
    const css = await fetchText(CSS_URL);

    // 1) Immer die komplette CSS-Datei spiegeln (hilfreich fürs Debugging)
    fs.writeFileSync("latest.css", css, "utf8");

    // 2) Komponenten extrahieren
    const { components } = extractRelevantCSS(css, COMPONENT_CLASSES);
    fs.writeFileSync("components.json", JSON.stringify(components, null, 2), "utf8");

    console.log("✔ Updated latest.css and components.json");
    console.log("✔ Classes:", COMPONENT_CLASSES.join(", ") || "(none)");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
