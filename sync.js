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

/* --------------------------------------------------
   1️⃣ Webflow CSS URL finden
-------------------------------------------------- */
function findWebflowCSSUrl(html) {
  const matches = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)]
    .map(m => m[1]);

  if (!matches.length) {
    throw new Error("No CSS links found in page");
  }

  const filtered = matches.filter(url =>
    !url.includes("google") &&
    !url.includes("gstatic")
  );

  return filtered.sort((a, b) => b.length - a.length)[0];
}

/* --------------------------------------------------
   2️⃣ CSS Variablen extrahieren
-------------------------------------------------- */
function extractCSSVariables(cssText) {
  const vars = {};
  const rootMatch = cssText.match(/:root\s*\{([\s\S]*?)\}/);

  if (!rootMatch) return vars;

  const varMatches = [...rootMatch[1].matchAll(/--([^:]+):\s*([^;]+);/g)];

  varMatches.forEach(m => {
    vars[`--${m[1].trim()}`] = m[2].trim();
  });

  return vars;
}

/* --------------------------------------------------
   3️⃣ Klassen + Combo-Klassen extrahieren
-------------------------------------------------- */
function extractSelectors(cssText) {

  // Erfasst:
  // .button
  // .button.is-small
  // .button.is-secondary.is-small
  const matches = [...cssText.matchAll(/\.([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/g)]
    .map(m => m[1]);

  return [...new Set(matches)];
}

/* --------------------------------------------------
   4️⃣ CSS Regeln extrahieren (exaktes Matching)
-------------------------------------------------- */
function extractRelevantCSS(cssText, selectors) {

  const components = {};
  selectors.forEach(s => (components[s] = []));

  const ruleRegex = /([^{@}][^{]*?)\{([^}]*)\}/g;

  function selectorMatches(fullSelector, target) {

    const escaped = target.replace(/\./g, "\\.");
    const regex = new RegExp(`(^|\\s|,)\\.${escaped}(?=[\\s:{]|$)`);
    return regex.test(fullSelector);
  }

  let m;

  /* ---------- Normale Regeln ---------- */
  while ((m = ruleRegex.exec(cssText)) !== null) {

    const selector = m[1].trim();
    const body = m[2].trim();
    if (!selector || !body) continue;

    selectors.forEach(sel => {
      if (selectorMatches(selector, sel)) {
        components[sel].push(`${selector} {\n${body}\n}`);
      }
    });
  }

  /* ---------- Media Queries splitten ---------- */
  const mediaOuter = /@media[^{]+\{([\s\S]+?)\}\s*\}/g;
  let mm;

  while ((mm = mediaOuter.exec(cssText)) !== null) {

    const condition = mm[0].match(/@media[^{]+/)[0];
    const innerCSS = mm[1];

    const innerRules = [...innerCSS.matchAll(/([^{]+)\{([^}]+)\}/g)];

    innerRules.forEach(r => {

      const sel = r[1].trim();
      const body = r[2].trim();

      selectors.forEach(target => {
        if (selectorMatches(sel, target)) {
          components[target].push(
`${condition} {
${sel} {
${body}
}
}`
          );
        }
      });
    });
  }

  return components;
}

/* --------------------------------------------------
   5️⃣ CSS Variablen auflösen
-------------------------------------------------- */
function resolveVariables(components, variables) {

  Object.keys(components).forEach(key => {
    components[key] = components[key].map(rule => {

      Object.keys(variables).forEach(v => {
        rule = rule.replace(
          new RegExp(`var\\(${v}\\)`, "g"),
          variables[v]
        );
      });

      return rule;
    });
  });

  return components;
}

/* --------------------------------------------------
   6️⃣ Doppelte Regeln entfernen
-------------------------------------------------- */
function dedupeComponents(components) {

  Object.keys(components).forEach(key => {
    components[key] = [...new Set(components[key])];
  });

  return components;
}

/* --------------------------------------------------
   7️⃣ Hauptprozess
-------------------------------------------------- */
(async () => {
  try {

    console.log("🌍 Fetching page:", PAGE_URL);
    const html = await fetchText(PAGE_URL);

    const cssUrl = findWebflowCSSUrl(html);
    console.log("🎨 CSS URL:", cssUrl);

    const css = await fetchText(cssUrl);
    fs.writeFileSync("latest.css", css, "utf8");

    const variables = extractCSSVariables(css);
    console.log(`🎛 ${Object.keys(variables).length} CSS variables found`);

    const selectors = extractSelectors(css);
    console.log(`📦 ${selectors.length} selectors found`);

    let components = extractRelevantCSS(css, selectors);

    components = resolveVariables(components, variables);
    components = dedupeComponents(components);

    fs.writeFileSync(
      "components.json",
      JSON.stringify(components, null, 2),
      "utf8"
    );

    console.log("✔ Updated components.json");

  } catch (err) {
    console.error("❌ Sync failed:", err.message);
    process.exit(1);
  }
})();
