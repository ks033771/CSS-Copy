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

// 🔍 Webflow CSS URL aus veröffentlichter Seite holen
function findWebflowCSSUrl(html) {
  const matches = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)]
    .map(m => m[1]);

  if (!matches.length) {
    throw new Error("No CSS links found in page");
  }

  // Entferne bekannte externe CSS wie Google Fonts
  const filtered = matches.filter(url =>
    !url.includes("google") &&
    !url.includes("gstatic")
  );

  if (!filtered.length) {
    throw new Error("No suitable CSS file found");
  }

  // Nimm die längste URL (meist Webflow Main CSS)
  const sorted = filtered.sort((a, b) => b.length - a.length);

  return sorted[0];
}


// 🧠 Alle Klassen aus CSS sammeln
function extractAllClassesFromCSS(cssText) {
  const matches = [...cssText.matchAll(/\.([a-zA-Z0-9_-]+)[\s\.\:\{]/g)];
  return [...new Set(matches.map(m => m[1]))];
}

// 🎨 CSS Regeln je Klasse speichern
function extractRelevantCSS(cssText, classes) {
  const components = {};
  classes.forEach(c => (components[c] = []));

  // 🔹 1. Normale (nicht verschachtelte) Regeln
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

  // 🔹 2. Media Queries komplett erfassen
  const mediaRegex = /@media[^{]+\{([\s\S]*?\})\s*\}/g;
  let mediaMatch;

  while ((mediaMatch = mediaRegex.exec(cssText)) !== null) {
    const mediaBlock = mediaMatch[0];

    for (const c of classes) {
      if (mediaBlock.includes("." + c)) {
        components[c].push(mediaBlock.trim());
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

    const classes = extractAllClassesFromCSS(css);
    console.log(`📦 ${classes.length} CSS classes found`);

    const components = extractRelevantCSS(css, classes);
    fs.writeFileSync("components.json", JSON.stringify(components, null, 2), "utf8");

    console.log("✔ Updated components.json");

  } catch (err) {
    console.error("❌ Sync failed:", err.message);
    process.exit(1);
  }
})();
